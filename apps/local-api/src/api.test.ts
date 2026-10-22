import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildJob, FirmwareBuildRequest, ProgramSession } from "@iotedu/contracts";
import type { NativeBuildResult, NativeBuildSpec } from "@iotedu/firmware-builder/native";
import type { UsbRunnerResult, UsbRunnerSpec } from "@iotedu/firmware-builder/programmer";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, readBoardProfile } from "./app.js";
import type { MonitorRunner, PortLister, UsbRunner } from "./programmer-service.js";
import type { NativeRunner } from "./services.js";
import { JsonNodeRepository } from "./store.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function createApp(options: {
  nativeAvailable?: boolean;
  runNative?: NativeRunner;
  dataDir?: string;
  runProgram?: UsbRunner;
  runMonitor?: MonitorRunner;
  listPorts?: PortLister;
} = {}) {
  const dataDir = options.dataDir ?? await mkdtemp(path.join(tmpdir(), "iotedu-"));
  const profile = await readBoardProfile(repoRoot);
  const app = await buildApp({
    dataDir,
    repoRoot,
    catalogDir: path.join(repoRoot, "catalog/manifests"),
    profile,
    nativeAvailable: options.nativeAvailable,
    runNative: options.runNative,
    runProgram: options.runProgram,
    runMonitor: options.runMonitor,
    listPorts: options.listPorts,
  });
  return { app, dataDir };
}

async function waitForBuild(app: { inject(options: { method: "GET"; url: string }): Promise<{ json(): { job: BuildJob } }> }, id: string): Promise<BuildJob> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/builds/${id}` });
    const job = response.json().job;
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("build did not finish");
}

const compiled = async (spec: NativeBuildSpec): Promise<NativeBuildResult> => {
  await mkdir(spec.artifactDir, { recursive: true });
  const body = Buffer.from(`compiled ${spec.softwareVersion} ${spec.softwareVersionString}`);
  await writeFile(path.join(spec.artifactDir, "sensors.ota"), body);
  spec.onLog(`compiled ${spec.softwareVersionString}`);
  return {
    ok: true,
    cancelled: false,
    durationMs: 15,
    partitionLayoutId: "layout",
    issues: [],
    artifacts: [{ name: "sensors.ota", sha256: "abc", size: body.length, deployable: true }],
    summary: [`Package ${spec.softwareVersionString} is compiled.`],
  };
};

const mockBuild = (overrides: Partial<FirmwareBuildRequest> = {}): FirmwareBuildRequest => ({
  mode: "mock",
  codeSource: "approved",
  nodeId: null,
  hardware: "esp32h2",
  baseFirmwareId: "iotedu-core",
  componentIds: ["iotedu-dht11"],
  pins: [{ componentId: "iotedu-dht11", pinName: "DHT11_DATA", gpio: 4 }],
  softwareVersion: 2,
  softwareVersionString: "1.1",
  uploadId: null,
  confirm: true,
  ...overrides,
});

const programPort = "/dev/cu.usbmodem1101";

function programPayload(overrides: Record<string, unknown> = {}) {
  return {
    buildId: "compiled-package",
    port: programPort,
    intent: "initial_install",
    confirm: true,
    preserveNvs: true,
    ...overrides,
  };
}

async function seedCompiledPackage(dataDir: string): Promise<{ hash: string; dir: string }> {
  const dir = path.join(dataDir, "builds", "compiled-package", "artifacts");
  await mkdir(dir, { recursive: true });
  const bootloader = Buffer.from("boot");
  const table = Buffer.from("table");
  const otadata = Buffer.from("ota");
  const application = Buffer.from("app-image-v1.2.0");
  const merged = Buffer.alloc(0x20000 + application.length, 0xff);
  merged.set(bootloader, 0);
  merged.set(table, 0xc000);
  merged.set(otadata, 0x1d000);
  merged.set(application, 0x20000);
  const flasher = {
    write_flash_args: ["--flash_mode", "dio", "--flash_size", "4MB", "--flash_freq", "48m"],
    flash_files: {
      "0x0": "bootloader/bootloader.bin",
      "0xc000": "partition_table/partition-table.bin",
      "0x1d000": "ota_data_initial.bin",
      "0x20000": "sensors.bin",
    },
    extra_esptool_args: { chip: "esp32h2", before: "default_reset", after: "hard_reset" },
    bootloader: { encrypted: "false" },
    app: { encrypted: "false" },
    "partition-table": { encrypted: "false" },
    otadata: { encrypted: "false" },
  };
  const bodies: Record<string, Buffer | string> = {
    "bootloader.bin": bootloader,
    "partition-table.bin": table,
    "ota_data_initial.bin": otadata,
    "sensors.bin": application,
    "usb-image.bin": merged,
    "flasher_args.json": JSON.stringify(flasher),
  };
  for (const [name, body] of Object.entries(bodies)) {
    await writeFile(path.join(dir, name), body);
  }
  const now = new Date().toISOString();
  const record: BuildJob = {
    id: "compiled-package",
    simulated: false,
    verification: "compiled",
    status: "succeeded",
    request: mockBuild({ mode: "native", softwareVersion: 3, softwareVersionString: "1.2.0" }),
    validation: { ok: true, issues: [] },
    logs: ["compiled"],
    artifacts: Object.keys(bodies).map((name) => ({
      name,
      relativePath: path.join("builds", "compiled-package", "artifacts", name),
      sha256: "abc",
      size: 4,
      simulated: false,
      deployable: false,
    })),
    partitionLayoutId: "layout",
    durationMs: 5,
    createdAt: now,
    updatedAt: now,
  };
  await writeFile(path.join(dataDir, "builds.json"), JSON.stringify([record]));
  return { hash: createHash("sha256").update(application).digest("hex"), dir };
}

async function waitForProgram(
  app: { inject(options: { method: "GET"; url: string }): Promise<{ json(): { session: ProgramSession } }> },
  id: string,
  done: (session: ProgramSession) => boolean,
): Promise<ProgramSession> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/programmer/sessions/${id}` });
    const session = response.json().session;
    if (done(session)) return session;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("programming session did not reach the expected state");
}

describe("local API", () => {
  const closers: Array<{ close(): Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((app) => app.close()));
  });

  it("persists a simulated node across a new repository", async () => {
    const { app, dataDir } = await createApp();
    closers.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/nodes/commission",
      payload: {
        path: "smart_home",
        name: "Lab sensor",
        pairingCode: "3497-011-2332",
        confirm: true,
        acknowledgeSimulation: true,
      },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json();
    expect(body.matterSessionOpened).toBe(false);
    expect(body.node.simulated).toBe(true);
    expect(body.node.matterNodeId).toBeNull();

    const reopened = new JsonNodeRepository(path.join(dataDir, "nodes.json"));
    const stored = await reopened.getById(body.node.id);
    expect(stored?.name).toBe("Lab sensor");

    const audit = await readFile(path.join(dataDir, "audit.jsonl"), "utf8");
    expect(audit).not.toContain("3497-011-2332");
  });

  it("searches the catalogue and refuses a planned driver in a native build", async () => {
    const { app } = await createApp();
    closers.push(app);
    const found = await app.inject({ method: "GET", url: "/api/catalog?q=TemperatureMeasurement" });
    expect(found.json().components.map((item: { id: string }) => item.id)).toEqual(["iotedu-dht11"]);

    const native = await app.inject({
      method: "POST",
      url: "/api/builds",
      payload: mockBuild({ mode: "native", componentIds: ["iotedu-ldr"], pins: [] }),
    });
    expect(native.statusCode).toBe(400);
    const job = native.json().job;
    expect(job.status).toBe("failed");
    expect(job.artifacts).toEqual([]);
    expect(job.logs.join("\n")).toMatch(/planned|not available/i);
  });

  it("labels a mock package as simulated and blocks OTA", async () => {
    const { app } = await createApp();
    closers.push(app);
    const commissioned = await app.inject({
      method: "POST",
      url: "/api/nodes/commission",
      payload: { path: "new_device", name: "Blank", confirm: true, acknowledgeSimulation: true },
    });
    const nodeId = commissioned.json().node.id as string;

    const built = await app.inject({ method: "POST", url: "/api/builds", payload: mockBuild({ nodeId }) });
    expect(built.statusCode).toBe(201);
    const job = built.json().job;
    expect(job.simulated).toBe(true);
    expect(job.status).toBe("simulated");
    expect(job.artifacts[0].deployable).toBe(false);
    expect(job.logs.join("\n")).toMatch(/ESP-IDF was not invoked/);

    const preflight = await app.inject({
      method: "POST",
      url: "/api/ota/preflight",
      payload: {
        nodeId,
        buildId: job.id,
        artifactName: "SIMULATED.txt",
        userApproved: true,
        confirm: true,
      },
    });
    const result = preflight.json();
    expect(result.allowed).toBe(false);
    expect(result.checks.find((check: { id: string }) => check.id === "ota_requestor").status).toBe("unknown");
    expect(result.checks.find((check: { id: string }) => check.id === "artifact_real").status).toBe("failed");

    const deployed = await app.inject({
      method: "POST",
      url: "/api/ota/jobs",
      payload: {
        nodeId,
        buildId: job.id,
        artifactName: "SIMULATED.txt",
        userApproved: true,
        confirm: true,
        nodeIds: [nodeId, "other"],
      },
    });
    expect(deployed.statusCode).toBe(400);

    const single = await app.inject({
      method: "POST",
      url: "/api/ota/jobs",
      payload: {
        nodeId,
        buildId: job.id,
        artifactName: "SIMULATED.txt",
        userApproved: true,
        confirm: true,
      },
    });
    expect(single.statusCode).toBe(409);
    expect(single.json().job.status).toBe("blocked");
    expect(single.json().job.installedVersionConfirmed).toBe(false);
    expect(single.json().job.stages.every((stage: { state: string }) => stage.state === "not_observed")).toBe(true);

    const refreshed = await app.inject({ method: "POST", url: `/api/nodes/${nodeId}/refresh` });
    expect(refreshed.json().liveRead).toBe("unavailable");
    expect(refreshed.json().node.softwareVersion).toBeNull();
  });

  it("warns when a package version is not higher than the installed firmware", async () => {
    const { app, dataDir } = await createApp();
    closers.push(app);
    const commissioned = await app.inject({
      method: "POST",
      url: "/api/nodes/commission",
      payload: { path: "smart_home", name: "Versioned", confirm: true, acknowledgeSimulation: true },
    });
    const nodeId = commissioned.json().node.id as string;
    const nodes = new JsonNodeRepository(path.join(dataDir, "nodes.json"));
    const node = await nodes.getById(nodeId);
    if (!node) throw new Error("missing node");
    await nodes.save({ ...node, softwareVersion: 1, softwareVersionString: "1.0" });

    const higher = await app.inject({
      method: "POST",
      url: "/api/builds/validate",
      payload: mockBuild({ nodeId, softwareVersion: 2, softwareVersionString: "1.1.0" }),
    });
    expect(higher.json().ok).toBe(true);
    expect(higher.json().issues.some((issue: { code: string }) => issue.code === "version_not_higher")).toBe(false);

    const same = await app.inject({
      method: "POST",
      url: "/api/builds/validate",
      payload: mockBuild({ nodeId, softwareVersion: 1, softwareVersionString: "1.0" }),
    });
    expect(same.json().ok).toBe(true);
    expect(same.json().issues.some((issue: { code: string }) => issue.code === "version_not_higher")).toBe(true);
  });

  it("records a compiled package, serves it for download, and keeps it after restart", async () => {
    const { app, dataDir } = await createApp({ nativeAvailable: true, runNative: compiled });
    closers.push(app);
    const started = await app.inject({
      method: "POST",
      url: "/api/builds",
      payload: mockBuild({ mode: "native", softwareVersion: 2, softwareVersionString: "1.1.0" }),
    });
    expect(started.statusCode).toBe(202);
    const job = await waitForBuild(app, started.json().job.id as string);
    expect(job.status).toBe("succeeded");
    expect(job.simulated).toBe(false);
    expect(job.verification).toBe("compiled");
    expect(job.artifacts.some((artifact) => artifact.name === "sensors.ota" && artifact.deployable)).toBe(true);

    const downloaded = await app.inject({ method: "GET", url: `/api/builds/${job.id}/download/sensors.ota` });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.body).toBe("compiled 2 1.1.0");

    const blocked = await app.inject({ method: "POST", url: "/api/builds", payload: mockBuild() });
    const simulated = blocked.json().job as BuildJob;
    const refused = await app.inject({ method: "GET", url: `/api/builds/${simulated.id}/download/SIMULATED.txt` });
    expect(refused.statusCode).toBe(409);

    await app.close();
    closers.splice(closers.indexOf(app), 1);
    const reopened = await createApp({ dataDir, nativeAvailable: true, runNative: compiled });
    closers.push(reopened.app);
    const again = await reopened.app.inject({ method: "GET", url: `/api/builds/${job.id}` });
    expect(again.json().job.status).toBe("succeeded");
    expect(again.json().job.verification).toBe("compiled");
    expect(again.json().job.request.softwareVersionString).toBe("1.1.0");
  });

  it("reports a failed native build without a deployable package", async () => {
    const failed: NativeRunner = async () => ({
      ok: false,
      cancelled: false,
      durationMs: 4,
      partitionLayoutId: null,
      issues: [{ level: "error", code: "compile_failed", message: "compiler failed" }],
      artifacts: [],
      summary: [],
    });
    const { app } = await createApp({ nativeAvailable: true, runNative: failed });
    closers.push(app);
    const started = await app.inject({
      method: "POST",
      url: "/api/builds",
      payload: mockBuild({ mode: "native", softwareVersion: 3, softwareVersionString: "1.2.0" }),
    });
    const job = await waitForBuild(app, started.json().job.id as string);
    expect(job.status).toBe("failed");
    expect(job.verification).toBeNull();
    expect(job.artifacts.every((artifact) => artifact.deployable === false)).toBe(true);
  });

  it("cancels a running native build", async () => {
    const hanging: NativeRunner = (spec) => new Promise((resolve) => {
      const stop = () => resolve({
        ok: false,
        cancelled: true,
        durationMs: 5,
        partitionLayoutId: null,
        issues: [],
        artifacts: [],
        summary: [],
      });
      if (spec.signal.aborted) stop();
      else spec.signal.addEventListener("abort", stop, { once: true });
    });
    const { app } = await createApp({ nativeAvailable: true, runNative: hanging });
    closers.push(app);
    const started = await app.inject({
      method: "POST",
      url: "/api/builds",
      payload: mockBuild({ mode: "native" }),
    });
    const id = started.json().job.id as string;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const cancelled = await app.inject({ method: "POST", url: `/api/builds/${id}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    const job = await waitForBuild(app, id);
    expect(job.status).toBe("interrupted");
    expect(job.artifacts.filter((artifact) => artifact.deployable)).toEqual([]);
  });

  it("marks an orphaned running build interrupted when the API starts", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iotedu-"));
    const now = new Date().toISOString();
    const running: BuildJob = {
      id: "orphan-build",
      simulated: false,
      verification: null,
      status: "running",
      request: mockBuild({ mode: "native" }),
      validation: { ok: true, issues: [] },
      logs: ["started"],
      artifacts: [],
      partitionLayoutId: null,
      durationMs: null,
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(path.join(dataDir, "builds.json"), JSON.stringify([running]));
    const { app } = await createApp({ dataDir, nativeAvailable: true, runNative: compiled });
    closers.push(app);
    const recovered = await app.inject({ method: "GET", url: "/api/builds/orphan-build" });
    expect(recovered.json().job.status).toBe("interrupted");
    expect(recovered.json().job.verification).toBeNull();
  });

  it("reports capability limits and does not create a controller identity", async () => {
    const { app } = await createApp();
    closers.push(app);
    const caps = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(caps.json().bleCommissioning).toBe("unsupported");
    expect(caps.json().firmwareBuild).toBe("mock_only");
    expect(caps.json().ai).toBe("needs_setup");
    const controller = await app.inject({ method: "GET", url: "/api/controller/status" });
    expect(controller.json().identityLoaded).toBe(false);
    const ai = await app.inject({
      method: "POST",
      url: "/api/ai/draft",
      payload: {
        peripheralName: "LDR",
        interfaceName: "ADC",
        gpioNotes: "GPIO1",
        behaviour: "read light",
        matterFunction: "illuminance",
        dependencies: "",
      },
    });
    expect(ai.statusCode).toBe(503);
  });

  it("does not expose a simulated package as a flashable or OTA image", async () => {
    const { app, dataDir } = await createApp();
    closers.push(app);
    const built = await app.inject({ method: "POST", url: "/api/builds", payload: mockBuild() });
    const job = built.json().job;
    const listed = await app.inject({ method: "GET", url: `/api/builds/${job.id}/artifacts` });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["content-type"]).toMatch(/application\/json/);
    expect(listed.json().artifacts).toEqual([
      expect.objectContaining({
        name: "SIMULATED.txt",
        simulated: true,
        deployable: false,
      }),
    ]);
    expect(listed.body).not.toMatch(/sensors\.bin|\.ota\b/);
    const artifact = await readFile(path.join(dataDir, job.artifacts[0].relativePath), "utf8");
    expect(artifact).toMatch(/not an ESP-IDF application binary/);
    expect(artifact).toMatch(/Do not flash/);

    const routes = app.printRoutes();
    expect(routes).toContain("programmer/");
    expect(routes).not.toMatch(/flash|esptool|serial/i);
  });

  it("has no USB tool or compiler invocation in the application source", async () => {
    async function filesUnder(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const found: string[] = [];
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) found.push(...await filesUnder(full));
        else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) found.push(full);
      }
      return found;
    }
    const sources = await filesUnder(path.join(repoRoot, "apps"));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = await readFile(file, "utf8");
      expect(text, file).not.toMatch(/esptool|child_process|ota_image_tool|idf\.py|execFile|spawn\(/);
    }
  });

  it("has no PostgreSQL or GitHub client dependency", async () => {
    const packages = ["package.json", "apps/local-api/package.json", "apps/desktop-ui/package.json"];
    for (const relative of packages) {
      const text = await readFile(path.join(repoRoot, relative), "utf8");
      expect(text).not.toMatch(/postgres|pg\b|prisma|typeorm|octokit|@octokit/i);
    }
    const manifestNames = await readdir(path.join(repoRoot, "catalog/manifests"));
    expect(manifestNames.length).toBeGreaterThan(0);
  });

  it("rejects a simulated package, an erase request, and a busy or disconnected device", async () => {
    const { app } = await createApp({ listPorts: async () => ["/dev/cu.usbmodem1101"] });
    closers.push(app);
    const built = await app.inject({ method: "POST", url: "/api/builds", payload: mockBuild() });
    const refused = await app.inject({
      method: "POST",
      url: "/api/programmer/sessions",
      payload: {
        buildId: built.json().job.id,
        port: "/dev/cu.usbmodem1101",
        intent: "initial_install",
        confirm: true,
        preserveNvs: true,
      },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("simulated_package");

    const erased = await app.inject({
      method: "POST",
      url: "/api/programmer/sessions",
      payload: {
        buildId: built.json().job.id,
        port: "/dev/cu.usbmodem1101",
        intent: "initial_install",
        confirm: true,
        preserveNvs: true,
        eraseAll: true,
      },
    });
    expect(erased.statusCode).toBe(400);

    const missingNvs = await app.inject({
      method: "POST",
      url: "/api/programmer/sessions",
      payload: {
        buildId: built.json().job.id,
        port: "/dev/cu.usbmodem1101",
        intent: "reflash",
        confirm: true,
      },
    });
    expect(missingNvs.statusCode).toBe(400);

    const commissioned = await app.inject({
      method: "POST",
      url: "/api/programmer/sessions",
      payload: {
        buildId: "not-a-package",
        port: "/dev/tty.usbmodem1101",
        intent: "commissioned_maintenance",
        confirm: true,
        preserveNvs: true,
      },
    });
    expect(commissioned.statusCode).toBe(404);
  });

  it("writes a compiled package, reports progress, and leaves the package files unchanged", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iotedu-program-"));
    const seeded = await seedCompiledPackage(dataDir);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: string[][] = [];
    const runProgram: UsbRunner = async (spec) => {
      seen.push(spec.writeArgs);
      spec.onLog("Writing at 0x00020000... (40 %)");
      await gate;
      if (spec.signal.aborted) return { ok: false, cancelled: true, diagnostic: null };
      return { ok: true, cancelled: false, diagnostic: null };
    };
    const { app } = await createApp({
      dataDir,
      nativeAvailable: true,
      runProgram,
      listPorts: async () => ["/dev/cu.usbmodem1101"],
    });
    closers.push(app);

    const blocked = await app.inject({
      method: "POST",
      url: "/api/programmer/sessions",
      payload: programPayload({ intent: "commissioned_maintenance" }),
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error.code).toBe("confirmation_required");

    const started = await app.inject({
      method: "POST",
      url: "/api/programmer/sessions",
      payload: programPayload(),
    });
    expect(started.statusCode).toBe(202);
    const session = started.json().session as ProgramSession;
    expect(session.eraseAll).toBe(false);
    expect(session.nvsPreserved).toBe(true);
    expect(session.hardwareVerified).toBe(false);

    const progress = await waitForProgram(app, session.id, (item) => item.progressPercent === 40 || item.status !== "running");
    expect(progress.progressPercent).toBe(40);
    const busy = await app.inject({
      method: "POST",
      url: "/api/programmer/sessions",
      payload: programPayload({ intent: "reflash" }),
    });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.code).toBe("port_busy");
    release();

    const finished = await waitForProgram(app, session.id, (item) => item.status !== "running");
    expect(finished.status).toBe("succeeded");
    expect(finished.progressPercent).toBe(100);
    expect(finished.hardwareVerified).toBe(false);
    expect(finished.checks.find((item) => item.id === "boot")?.status).toBe("unknown");
    expect(finished.checks.find((item) => item.id === "factory_reset")?.status).toBe("unknown");
    expect(seen[0]?.some((arg) => arg.endsWith("usb-image.bin"))).toBe(false);
    expect(seen[0]?.some((arg) => /erase/i.test(arg))).toBe(false);
    expect(seen[0]).toEqual(expect.arrayContaining(["0x0", "0xc000", "0x1d000", "0x20000"]));
    const hash = createHash("sha256").update(await readFile(path.join(seeded.dir, "sensors.bin"))).digest("hex");
    expect(hash).toBe(seeded.hash);
    const build = await app.inject({ method: "GET", url: "/api/builds/compiled-package" });
    expect(build.json().job.verification).toBe("compiled");

    await app.close();
    closers.splice(closers.indexOf(app), 1);
    const { app: reopened } = await createApp({ dataDir, nativeAvailable: true, listPorts: async () => ["/dev/cu.usbmodem1101"] });
    closers.push(reopened);
    const stored = await reopened.inject({ method: "GET", url: `/api/programmer/sessions/${session.id}` });
    expect(stored.json().session.status).toBe("succeeded");
    expect(stored.json().session.hardwareVerified).toBe(false);
  });

  it("records a failed write and a disconnect without marking the package hardware-verified", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iotedu-program-fail-"));
    const seeded = await seedCompiledPackage(dataDir);
    const runProgram: UsbRunner = async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false, cancelled: false, diagnostic: "The serial port could not be opened." };
      return { ok: true, cancelled: false, diagnostic: null };
    };
    let attempts = 0;
    const runMonitor: MonitorRunner = async (spec) => {
      spec.onLog("could not open port: Device not configured");
      return { cancelled: false, code: 1 };
    };
    const { app } = await createApp({
      dataDir,
      nativeAvailable: true,
      runProgram,
      runMonitor,
      listPorts: async () => ["/dev/cu.usbmodem1101"],
    });
    closers.push(app);
    const started = await app.inject({ method: "POST", url: "/api/programmer/sessions", payload: programPayload() });
    const failed = await waitForProgram(app, started.json().session.id, (item) => item.status !== "running");
    expect(failed.status).toBe("failed");
    expect(failed.hardwareVerified).toBe(false);
    expect(failed.checks.every((item) => item.status !== "passed" || item.id === "connect")).toBe(true);
    expect(createHash("sha256").update(await readFile(path.join(seeded.dir, "sensors.bin"))).digest("hex")).toBe(seeded.hash);

    const again = await app.inject({ method: "POST", url: "/api/programmer/sessions", payload: programPayload() });
    expect([201, 202]).toContain(again.statusCode);
    const written = await waitForProgram(app, again.json().session.id, (item) => item.status !== "running");
    expect(written.status).toBe("succeeded");
    expect(written.hardwareVerified).toBe(false);
    const opened = await app.inject({ method: "POST", url: `/api/programmer/sessions/${written.id}/monitor` });
    expect(opened.statusCode).toBe(200);
    const watched = await waitForProgram(app, written.id, (item) => item.stage !== "monitoring");
    expect(watched.status).toBe("succeeded");
    expect(watched.checks.find((item) => item.id === "serial")?.status).toBe("failed");
    expect(watched.checks.find((item) => item.id === "boot")?.status).toBe("unknown");
    expect(watched.hardwareVerified).toBe(false);
    const build = await app.inject({ method: "GET", url: "/api/builds/compiled-package" });
    expect(build.json().job.verification).toBe("compiled");
  });

  it("cancels a write, captures a redacted monitor log, and recovers an orphaned session", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iotedu-program-cancel-"));
    await seedCompiledPackage(dataDir);
    const runProgram: UsbRunner = (spec) => new Promise<UsbRunnerResult>((resolve) => {
      spec.signal.addEventListener("abort", () => resolve({ ok: false, cancelled: true, diagnostic: null }), { once: true });
    });
    const runMonitor: MonitorRunner = async (spec) => {
      spec.onLog('I boot: App "sensors" version 1.2.0');
      spec.onLog("passcode: 12345678");
      spec.onLog("MT:Y.ABCDEFGH");
      return { cancelled: false, code: 0 };
    };
    const { app } = await createApp({
      dataDir,
      nativeAvailable: true,
      runProgram,
      runMonitor,
      listPorts: async () => ["/dev/cu.usbmodem1101"],
    });
    closers.push(app);
    const started = await app.inject({ method: "POST", url: "/api/programmer/sessions", payload: programPayload() });
    const id = started.json().session.id as string;
    const cancelled = await app.inject({ method: "POST", url: `/api/programmer/sessions/${id}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    const interrupted = await waitForProgram(app, id, (item) => item.status !== "running");
    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.checks.find((item) => item.id === "write")?.status).toBe("failed");

    const orphan: ProgramSession = {
      ...interrupted,
      id: "orphan-program",
      status: "running",
      stage: "writing",
      message: "still writing",
    };
    await writeFile(path.join(dataDir, "programmer-sessions.json"), JSON.stringify([interrupted, orphan]));
    await app.close();
    closers.splice(closers.indexOf(app), 1);
    const { app: reopened } = await createApp({
      dataDir,
      nativeAvailable: true,
      runProgram,
      runMonitor,
      listPorts: async () => ["/dev/cu.usbmodem1101"],
    });
    closers.push(reopened);
    const recovered = await reopened.inject({ method: "GET", url: "/api/programmer/sessions/orphan-program" });
    expect(recovered.json().session.status).toBe("interrupted");
    expect(recovered.json().session.nvsPreserved).toBe(true);

    const success = await reopened.inject({ method: "GET", url: `/api/programmer/sessions/${id}` });
    expect(success.json().session.status).toBe("interrupted");
    const monitorApp = reopened;
    const writable = success.json().session as ProgramSession;
    writable.status = "succeeded";
    writable.stage = "idle";
    const sessions = [writable, recovered.json().session as ProgramSession];
    await writeFile(path.join(dataDir, "programmer-sessions.json"), JSON.stringify(sessions));
    const opened = await monitorApp.inject({ method: "POST", url: `/api/programmer/sessions/${id}/monitor` });
    expect(opened.statusCode).toBe(200);
    const watched = await waitForProgram(monitorApp, id, (item) => item.stage !== "monitoring");
    expect(watched.status).toBe("succeeded");
    expect(watched.checks.find((item) => item.id === "version")?.status).toBe("passed");
    expect(watched.checks.find((item) => item.id === "matter")?.status).toBe("unknown");
    expect(watched.hardwareVerified).toBe(false);
    const saved = await monitorApp.inject({ method: "POST", url: `/api/programmer/sessions/${id}/save-log` });
    expect(saved.statusCode).toBe(200);
    const log = await monitorApp.inject({ method: "GET", url: `/api/programmer/sessions/${id}/saved-log` });
    expect(log.body).toContain("1.2.0");
    expect(log.body).not.toContain("12345678");
    expect(log.body).not.toContain("MT:Y");
  });
});
