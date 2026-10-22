import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BuildJob, ProgramRequest, ProgramSession } from "@iotedu/contracts";
import {
  buildWritePlan,
  flashProgressPercent,
  isAllowedSerialPort,
  listSerialPorts,
  packageProgrammingBlock,
  redactSerialLog,
  runSerialMonitor,
  probeChip,
  runUsbWrite,
  startupChecks,
  type FlashArguments,
  type FlashPlan,
  type UsbRunnerResult,
  type UsbRunnerSpec,
} from "@iotedu/firmware-builder/programmer";
import { loadReferenceLayout, type BoardProfile } from "@iotedu/firmware-builder";
import type { BuildRepository } from "./store.js";
import { JsonJobRepository } from "./store.js";

export class ProgrammerError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export type UsbRunner = (spec: UsbRunnerSpec) => Promise<UsbRunnerResult>;
export type MonitorRunner = typeof runSerialMonitor;
export type PortLister = () => Promise<string[]>;
export type ChipProbe = typeof probeChip;

const REQUIRED = ["bootloader.bin", "sensors.bin", "partition-table.bin", "ota_data_initial.bin", "usb-image.bin", "flasher_args.json"];

function clip(text: string): string {
  if (text.length <= 20_000) return text;
  return `${text.slice(0, 4_000)}\nnote: earlier monitor text clipped\n${text.slice(-16_000)}`;
}

export class LocalProgrammerService {
  private readonly sessions: JsonJobRepository<ProgramSession>;
  private readonly running = new Map<string, AbortController>();
  private readonly monitors = new Map<string, AbortController>();
  private readonly ports = new Map<string, string>();
  private saveChain: Promise<void> = Promise.resolve();
  private logChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly builds: BuildRepository,
    private readonly dataDir: string,
    private readonly repoRoot: string,
    private readonly profile: BoardProfile,
    private readonly nativeAvailable: boolean,
    private readonly runWrite: UsbRunner = runUsbWrite,
    private readonly runMonitor: MonitorRunner = runSerialMonitor,
    private readonly listPorts: PortLister = listSerialPorts,
    private readonly identifyChip: ChipProbe = probeChip,
  ) {
    this.sessions = new JsonJobRepository(path.join(dataDir, "programmer-sessions.json"));
  }

  async recoverInterrupted(): Promise<void> {
    for (const session of await this.sessions.list()) {
      if (session.status !== "running") continue;
      session.status = "interrupted";
      session.stage = "idle";
      session.nvsPreserved = true;
      session.eraseAll = false;
      session.hardwareVerified = false;
      session.message = "The write was interrupted because the application restarted. Device contents are unknown. The package files were not deleted.";
      session.logs = [...session.logs, session.message];
      session.checks = startupChecks({
        writeLog: session.logs.join("\n"),
        monitorLog: session.monitorLog,
        versionString: session.softwareVersionString,
        writeStatus: session.status,
      });
      session.updatedAt = new Date().toISOString();
      await this.sessions.save(session);
    }
  }

  list(): Promise<ProgramSession[]> {
    return this.sessions.list();
  }

  get(id: string): Promise<ProgramSession | null> {
    return this.sessions.get(id);
  }

  portsAvailable(): Promise<string[]> {
    return this.listPorts();
  }

  async probe(port: string): Promise<{ port: string; accepted: boolean; detail: string }> {
    if (!isAllowedSerialPort(port)) {
      throw new ProgrammerError("Choose a local macOS USB serial device.", 400, "port_rejected");
    }
    const available = await this.listPorts();
    if (!available.includes(port)) {
      throw new ProgrammerError("That serial port is not currently connected.", 400, "port_missing");
    }
    if (!this.nativeAvailable) {
      throw new ProgrammerError("A chip probe needs the configured ESP-IDF v5.4.1 environment.", 400, "toolchain_not_configured");
    }
    if (this.ports.has(port)) {
      throw new ProgrammerError("This device already has a write or monitor in progress.", 409, "port_busy");
    }
    this.ports.set(port, "probe");
    try {
      const result = await this.identifyChip({ repoRoot: this.repoRoot, port });
      const detail = result.text || (result.accepted
        ? "ESP32-H2 responded."
        : "The connected chip is not an ESP32-H2.");
      return { port, accepted: result.accepted, detail };
    } finally {
      this.ports.delete(port);
    }
  }

  async describeWrite(buildId: string, port: string): Promise<{
    buildId: string;
    softwareVersion: number;
    softwareVersionString: string;
    regions: Array<{ offset: string; artifact: string; bytes: number }>;
    preserved: string[];
  }> {
    await this.rejectUnusablePackage(buildId);
    if (!isAllowedSerialPort(port)) {
      throw new ProgrammerError("Choose a local macOS USB serial device.", 400, "port_rejected");
    }
    const available = await this.listPorts();
    if (!available.includes(port)) {
      throw new ProgrammerError("That serial port is not currently connected.", 400, "port_missing");
    }
    const { job, plan } = await this.preparePlan(buildId, port);
    if (!plan.ok) {
      throw new ProgrammerError(plan.issues[0]?.message ?? "The package is not safe to write.", 400, plan.issues[0]?.code ?? "layout_rejected");
    }
    return {
      buildId: job.id,
      softwareVersion: job.request.softwareVersion,
      softwareVersionString: job.request.softwareVersionString,
      regions: plan.regions,
      preserved: ["nvs", "nvs_keys", "fctry", "esp_secure_cert", "phy_init"],
    };
  }

  async start(input: ProgramRequest): Promise<ProgramSession> {
    await this.rejectUnusablePackage(input.buildId);
    if (input.intent === "commissioned_maintenance" && input.acknowledgeCommissioned !== true) {
      throw new ProgrammerError(
        "Updating a commissioned node over USB needs an extra confirmation. This is not a Matter OTA update.",
        400,
        "confirmation_required",
      );
    }
    if (!isAllowedSerialPort(input.port)) {
      throw new ProgrammerError("Choose a local macOS USB serial device.", 400, "port_rejected");
    }
    const available = await this.listPorts();
    if (!available.includes(input.port)) {
      throw new ProgrammerError("That serial port is not currently connected.", 400, "port_missing");
    }
    if (!this.nativeAvailable) {
      throw new ProgrammerError("USB writing needs the configured ESP-IDF v5.4.1 environment.", 400, "toolchain_not_configured");
    }
    if (this.ports.has(input.port)) {
      throw new ProgrammerError("This device already has a write or monitor in progress.", 409, "port_busy");
    }
    const { job, plan } = await this.preparePlan(input.buildId, input.port);
    if (!plan.ok) {
      throw new ProgrammerError(plan.issues[0]?.message ?? "The package is not safe to write.", 400, plan.issues[0]?.code ?? "layout_rejected");
    }

    const now = new Date().toISOString();
    const session: ProgramSession = {
      id: randomUUID(),
      buildId: job.id,
      port: input.port,
      intent: input.intent,
      status: "running",
      stage: "writing",
      progressPercent: 0,
      logs: [
        `Writing ${job.request.softwareVersionString} to ${input.port}.`,
        "NVS, factory data, and the secure-cert partition are not erased. Full-chip erase is not available.",
      ],
      monitorLog: "",
      checks: [],
      message: "Writing the compiled image.",
      eraseAll: false,
      nvsPreserved: true,
      hardwareVerified: false,
      softwareVersionString: job.request.softwareVersionString,
      createdAt: now,
      updatedAt: now,
    };
    session.checks = this.checksFor(session);
    this.ports.set(input.port, session.id);
    await this.sessions.save(session);
    void this.execute(session, plan.args);
    return session;
  }

  async cancel(id: string): Promise<ProgramSession | null> {
    const session = await this.sessions.get(id);
    if (!session) return null;
    this.running.get(id)?.abort();
    this.monitors.get(id)?.abort();
    if (session.stage === "monitoring") {
      session.stage = "idle";
      session.monitorLog = clip(`${session.monitorLog}\nnote: serial monitor closed`);
      session.checks = this.checksFor(session);
      session.updatedAt = new Date().toISOString();
      await this.persist(session);
    }
    return session;
  }

  async readLog(id: string): Promise<{ status: ProgramSession["status"]; tail: string; progressPercent: number | null } | null> {
    const session = await this.sessions.get(id);
    if (!session) return null;
    const file = path.join(this.dataDir, "programmer", id, "write.log");
    let tail = session.logs.join("\n");
    try {
      const text = await readFile(file, "utf8");
      tail = text.split(/\r?\n/).slice(-200).join("\n");
    } catch {
      // The session record is enough until the log file exists.
    }
    return { status: session.status, tail: redactSerialLog(tail), progressPercent: session.progressPercent };
  }

  async monitor(id: string): Promise<ProgramSession> {
    const session = await this.sessions.get(id);
    if (!session) throw new ProgrammerError("Programming session not found.", 404, "not_found");
    if (session.status !== "succeeded") {
      throw new ProgrammerError("Open the serial monitor after a write that finished.", 409, "monitor_not_ready");
    }
    if (this.ports.has(session.port) || this.monitors.has(id)) {
      throw new ProgrammerError("This device already has a write or monitor in progress.", 409, "port_busy");
    }
    const controller = new AbortController();
    this.monitors.set(id, controller);
    this.ports.set(session.port, id);
    session.stage = "monitoring";
    session.monitorLog = clip(`${session.monitorLog}\nnote: serial monitor opened at 115200`);
    session.message = "Serial monitor is open. Startup checks stay unknown until the log shows them.";
    session.checks = this.checksFor(session);
    session.updatedAt = new Date().toISOString();
    await this.persist(session);
    void this.captureMonitor(session, controller);
    return session;
  }

  async saveLog(id: string): Promise<{ bytes: number }> {
    const session = await this.sessions.get(id);
    if (!session) throw new ProgrammerError("Programming session not found.", 404, "not_found");
    const redacted = redactSerialLog(session.monitorLog);
    if (!redacted.trim()) throw new ProgrammerError("There is no serial log to save.", 409, "log_empty");
    const file = path.join(this.dataDir, "programmer", id, "serial-redacted.log");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, redacted.endsWith("\n") ? redacted : `${redacted}\n`, "utf8");
    return { bytes: Buffer.byteLength(redacted) };
  }

  async savedLog(id: string): Promise<string | null> {
    const session = await this.sessions.get(id);
    if (!session) return null;
    try {
      return await readFile(path.join(this.dataDir, "programmer", id, "serial-redacted.log"), "utf8");
    } catch {
      return null;
    }
  }

  private async rejectUnusablePackage(buildId: string): Promise<BuildJob> {
    const job = await this.builds.get(buildId);
    if (!job) throw new ProgrammerError("Build not found.", 404, "not_found");
    const blocked = packageProgrammingBlock(job);
    if (blocked) throw new ProgrammerError(blocked.message, blocked.code === "simulated_package" ? 409 : 400, blocked.code);
    return job;
  }

  private async preparePlan(buildId: string, port: string): Promise<{ job: BuildJob; plan: FlashPlan }> {
    const job = await this.rejectUnusablePackage(buildId);
    const artifactDir = this.artifactDirectory(job);
    const files: Record<string, Buffer> = {};
    for (const name of REQUIRED) {
      if (name === "flasher_args.json") continue;
      files[name] = await readFile(path.join(artifactDir, name));
    }
    const flasher = JSON.parse(await readFile(path.join(artifactDir, "flasher_args.json"), "utf8")) as FlashArguments;
    const layout = await loadReferenceLayout(this.repoRoot, this.profile);
    const plan = buildWritePlan({
      flasher,
      artifactDir,
      port,
      partitions: layout.partitions,
      bootloaderOffset: this.profile.bootloaderOffset,
      partitionTableOffset: this.profile.partitionTableOffset,
      flashSizeBytes: this.profile.flashSizeBytes,
      files,
    });
    return { job, plan };
  }

  private artifactDirectory(job: BuildJob): string {
    const root = path.resolve(this.dataDir);
    const paths = REQUIRED.map((name) => {
      const artifact = job.artifacts.find((item) => item.name === name);
      if (!artifact) throw new ProgrammerError(`The package is missing ${name}.`, 400, "artifact_missing");
      const absolute = path.resolve(root, artifact.relativePath);
      if (!absolute.startsWith(`${root}${path.sep}`)) {
        throw new ProgrammerError("Artifact path is outside the data directory.", 400, "rejected_path");
      }
      return absolute;
    });
    const directory = path.dirname(paths[0] ?? "");
    if (paths.some((file) => path.dirname(file) !== directory)) {
      throw new ProgrammerError("Package files are not in one directory.", 400, "rejected_path");
    }
    return directory;
  }

  private checksFor(session: ProgramSession) {
    return startupChecks({
      writeLog: session.logs.join("\n"),
      monitorLog: session.monitorLog,
      versionString: session.softwareVersionString,
      writeStatus: session.status,
    });
  }

  private persist(session: ProgramSession): Promise<void> {
    session.eraseAll = false;
    session.nvsPreserved = true;
    session.hardwareVerified = false;
    this.saveChain = this.saveChain.then(() => this.sessions.save(session));
    return this.saveChain;
  }

  private note(session: ProgramSession, line: string): void {
    const next = [...session.logs, line];
    session.logs = next.length > 48 ? [...next.slice(0, 8), ...next.slice(-40)] : next;
    const percent = flashProgressPercent(line);
    if (percent !== null) session.progressPercent = percent;
    session.checks = this.checksFor(session);
    session.updatedAt = new Date().toISOString();
    this.logChain = this.logChain.then(async () => {
      const file = path.join(this.dataDir, "programmer", session.id, "write.log");
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, `${redactSerialLog(line)}\n`);
      await this.persist(session);
    });
  }

  private async execute(session: ProgramSession, args: string[]): Promise<void> {
    const controller = new AbortController();
    this.running.set(session.id, controller);
    try {
      const result = await this.runWrite({
        repoRoot: this.repoRoot,
        port: session.port,
        writeArgs: args,
        signal: controller.signal,
        onLog: (line) => this.note(session, line),
      });
      await this.logChain;
      if (result.cancelled || controller.signal.aborted) {
        session.status = "interrupted";
        session.message = "The write was cancelled. It is not recorded as a success.";
        this.note(session, session.message);
      } else if (result.ok) {
        session.status = "succeeded";
        session.progressPercent = 100;
        session.message = "The image was written. Startup has not been verified. Open the serial monitor. This is not Matter commissioning, and NVS was not erased.";
        this.note(session, session.message);
      } else {
        session.status = "failed";
        session.message = result.diagnostic ?? "The write failed.";
        this.note(session, session.message);
      }
      session.stage = "idle";
      session.checks = this.checksFor(session);
      session.updatedAt = new Date().toISOString();
      await this.persist(session);
    } catch (error) {
      session.status = "failed";
      session.stage = "idle";
      session.message = error instanceof Error ? error.message : "The write failed.";
      session.checks = this.checksFor(session);
      session.updatedAt = new Date().toISOString();
      await this.persist(session);
    } finally {
      this.running.delete(session.id);
      if (this.ports.get(session.port) === session.id) this.ports.delete(session.port);
    }
  }

  private async captureMonitor(session: ProgramSession, controller: AbortController): Promise<void> {
    try {
      await this.runMonitor({
        repoRoot: this.repoRoot,
        port: session.port,
        signal: controller.signal,
        onLog: (line) => {
          session.monitorLog = clip(`${session.monitorLog}\n${redactSerialLog(line)}`);
          session.checks = this.checksFor(session);
          session.updatedAt = new Date().toISOString();
          void this.persist(session);
        },
      });
      if (!controller.signal.aborted) {
        session.monitorLog = clip(`${session.monitorLog}\nnote: serial port closed`);
      }
    } finally {
      session.stage = "idle";
      session.checks = this.checksFor(session);
      session.updatedAt = new Date().toISOString();
      await this.persist(session);
      this.monitors.delete(session.id);
      if (this.ports.get(session.port) === session.id) this.ports.delete(session.port);
    }
  }
}
