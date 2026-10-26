import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LocalCatalogRepository } from "@iotedu/catalog";
import {
  type BuildArtifact,
  type BuildJob,
  type FirmwareBuildRequest,
  type ManagedNode,
  type OtaJob,
  type OtaRequest,
  type PreflightCheck,
  type PreflightResult,
  type ValidationResult,
} from "@iotedu/contracts";
import {
  appFitsPartition,
  detectGpioConflicts,
  inspectMatterOtaImage,
  loadReferenceLayout,
  renderVersionSdkconfig,
  selectionIssues,
  versionSupersedes,
  type BoardProfile,
  type MatterOtaInspection,
} from "@iotedu/firmware-builder";
import { runNativeDht11Build, type NativeBuildResult, type NativeBuildSpec } from "@iotedu/firmware-builder/native";
import type { MatterManagementService } from "@iotedu/contracts";
import { applyProviderEvent, confirmInstalledVersion, initialOtaStages, reconcileObservedFirmware, recordStage, transferCompleted, type ExpectedFirmwareIdentity } from "@iotedu/matter-controller";
import { catalogueEnabled, listFirmwareReleases } from "./catalogue-store.js";
import { deviceTypesFor, firmwareOnlyEligibility } from "./ota-composition.js";
import { loadOtaCatalogue } from "./ota-composition-store.js";
import type { BuildRepository, OtaRepository } from "./store.js";

export type NativeRunner = (spec: NativeBuildSpec) => Promise<NativeBuildResult>;

export interface CatalogueBuildHook {
  notes: string[];
  prepareWorkspace: (workspaceDir: string) => Promise<{
    partitionLayoutId: string;
    pinExpectations?: { key: string; value: string }[];
    productId?: number;
  }>;
  onComplete: (job: BuildJob, result: NativeBuildResult | null) => Promise<void>;
}

export class LocalFirmwareBuildService {
  private readonly running = new Map<string, AbortController>();
  private activeNativeId: string | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private logChain: Promise<void> = Promise.resolve();
  private lastSave = 0;
  private readonly catalogueHooks = new Map<string, CatalogueBuildHook>();

  constructor(
    private readonly catalog: LocalCatalogRepository,
    private readonly jobs: BuildRepository,
    private readonly dataDir: string,
    private readonly repoRoot: string,
    private readonly profile: BoardProfile,
    private readonly options: {
      nodes?: { getById(id: string): Promise<ManagedNode | null> };
      nativeAvailable?: boolean;
      runNative?: NativeRunner;
    } = {},
  ) {}

  async validate(input: FirmwareBuildRequest): Promise<ValidationResult> {
    const issues: ValidationResult["issues"] = [];
    const manifests = await this.catalog.list();
    if (input.baseFirmwareId !== "iotedu-core") {
      issues.push({
        level: "error",
        code: "unknown_base",
        message: "The only base firmware in this release is the audited Matter-over-Thread core.",
      });
    }
    issues.push(...selectionIssues(manifests, [input.baseFirmwareId, ...input.componentIds], input.mode));
    issues.push(...detectGpioConflicts(this.profile, input.pins));
    for (const id of input.componentIds) {
      const manifest = manifests.find((item) => item.id === id);
      for (const pin of manifest?.firmware?.kconfig ?? []) {
        if (!input.pins.some((item) => item.componentId === id && item.pinName === pin.pinName)) {
          issues.push({
            level: "error",
            code: "missing_pin",
            message: `${manifest?.name ?? id} needs a ${pin.pinName} assignment`,
          });
        }
      }
    }
    try {
      renderVersionSdkconfig(input.softwareVersion, input.softwareVersionString);
    } catch (error) {
      issues.push({
        level: "error",
        code: "invalid_version",
        message: error instanceof Error ? error.message : "Firmware version is invalid",
      });
    }
    if (input.nodeId && this.options.nodes) {
      const node = await this.options.nodes.getById(input.nodeId);
      if (node?.softwareVersion != null && !versionSupersedes(input.softwareVersion, node.softwareVersion)) {
        issues.push({
          level: "warning",
          code: "version_not_higher",
          message: `SoftwareVersion ${input.softwareVersion} is not higher than installed SoftwareVersion ${node.softwareVersion}.`,
        });
      }
    }
    if (input.mode === "native") {
      if (input.codeSource !== "approved") {
        issues.push({
          level: "error",
          code: "untrusted_source_not_compiled",
          message: "Native builds accept approved local components only. Uploaded and AI sources are not compiled.",
        });
      }
      const unsupported = input.componentIds.filter((id) => id !== "iotedu-dht11");
      if (!input.componentIds.includes("iotedu-dht11") || unsupported.length > 0) {
        issues.push({
          level: "error",
          code: "native_package_unsupported",
          message: "The native pipeline builds the verified ESP32-H2 DHT11 package. Other component sets are rejected.",
        });
      }
      if (!this.options.nativeAvailable) {
        issues.push({
          level: "error",
          code: "toolchain_not_configured",
          message: "Native builds need IDF_PATH, ESP_MATTER_PATH, and IDF_ACTIVATE in the API environment.",
        });
      }
    }
    if (input.codeSource === "ai_draft") {
      issues.push({
        level: "error",
        code: "ai_not_available",
        message: "AI drafts cannot be built. Configure a provider later, then review the source before accepting it.",
      });
    }
    if (input.codeSource === "upload" && !input.uploadId) {
      issues.push({
        level: "error",
        code: "missing_upload",
        message: "An uploaded source id is required for the custom-code path.",
      });
    }
    if (input.codeSource === "upload" && input.uploadId) {
      const upload = path.join(this.dataDir, "uploads", input.uploadId, "meta.json");
      try {
        await readFile(upload, "utf8");
      } catch {
        issues.push({
          level: "error",
          code: "upload_missing",
          message: "The uploaded source was not found. It was not compiled.",
        });
      }
    }
    const selected = new Set(input.componentIds);
    for (const pin of input.pins) {
      if (!selected.has(pin.componentId) && pin.componentId !== input.baseFirmwareId) {
        issues.push({
          level: "error",
          code: "pin_without_component",
          message: `Pin ${pin.pinName} refers to ${pin.componentId}, which is not selected.`,
        });
      }
    }
    return { ok: issues.every((issue) => issue.level !== "error"), issues };
  }

  async build(input: FirmwareBuildRequest): Promise<BuildJob> {
    const validation = await this.validate(input);
    const now = new Date().toISOString();
    const id = randomUUID();
    if (!validation.ok) {
      const rejected: BuildJob = {
        id,
        simulated: input.mode !== "native",
        verification: null,
        status: "failed",
        request: input,
        validation,
        logs: ["Build rejected before any compiler was started.", ...validation.issues.map((issue) => issue.message)],
        artifacts: [],
        partitionLayoutId: null,
        durationMs: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.jobs.save(rejected);
      return rejected;
    }

    if (input.mode === "native") {
      if (this.activeNativeId) {
        const busy: BuildJob = {
          id,
          simulated: false,
          verification: null,
          status: "failed",
          request: input,
          validation,
          logs: ["Another native build is already running. Wait for it to finish before starting a second one."],
          artifacts: [],
          partitionLayoutId: null,
          durationMs: null,
          createdAt: now,
          updatedAt: now,
        };
        await this.jobs.save(busy);
        return busy;
      }
      const running: BuildJob = {
        id,
        simulated: false,
        verification: null,
        status: "running",
        request: input,
        validation,
        logs: ["Native build accepted. The compiler has been started."],
        artifacts: [],
        partitionLayoutId: null,
        durationMs: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.jobs.save(running);
      void this.executeNative(running);
      return running;
    }

    const layout = await loadReferenceLayout(this.repoRoot, this.profile);
    const body = [
      "SIMULATED IoT.Edu firmware package",
      "This file is not an ESP-IDF application binary.",
      "Do not flash it and do not offer it as a Matter OTA image.",
      `softwareVersion=${input.softwareVersion}`,
      `softwareVersionString=${input.softwareVersionString}`,
      `components=${input.componentIds.join(",")}`,
      "",
    ].join("\n");
    const dir = path.join(this.dataDir, "builds", id);
    await mkdir(dir, { recursive: true });
    const artifactPath = path.join(dir, "SIMULATED.txt");
    await writeFile(artifactPath, body, "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const job: BuildJob = {
      id,
      simulated: true,
      verification: "simulated",
      status: "simulated",
      request: input,
      validation,
      logs: [
        "Mock mode: ESP-IDF was not invoked.",
        "No application image or Matter OTA image was produced.",
        `Partition layout ${layout.layoutId} was copied from the reference table for display only.`,
        "The resulting record is simulated and is not deployable.",
      ],
      artifacts: [
        {
          name: "SIMULATED.txt",
          relativePath: path.join("builds", id, "SIMULATED.txt"),
          sha256,
          size: Buffer.byteLength(body),
          simulated: true,
          deployable: false,
        },
      ],
      partitionLayoutId: layout.layoutId,
      durationMs: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.jobs.save(job);
    return job;
  }

  async composeCatalogue(request: FirmwareBuildRequest, hook: CatalogueBuildHook): Promise<BuildJob> {
    const issues: ValidationResult["issues"] = [...detectGpioConflicts(this.profile, request.pins)];
    try {
      renderVersionSdkconfig(request.softwareVersion, request.softwareVersionString);
    } catch (error) {
      issues.push({
        level: "error",
        code: "invalid_version",
        message: error instanceof Error ? error.message : "Firmware version is invalid",
      });
    }
    if (request.componentIds.includes("custom-dht11") && request.softwareVersion === 2) {
      issues.push({
        level: "error",
        code: "version_is_component_revision",
        message: "Matter SoftwareVersion must be a device firmware version. Component revision 2 is not a firmware version.",
      });
    }
    if (!this.options.nativeAvailable) {
      issues.push({
        level: "error",
        code: "toolchain_not_configured",
        message: "Native builds need IDF_PATH, ESP_MATTER_PATH, and IDF_ACTIVATE in the API environment.",
      });
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const validation = { ok: issues.every((issue) => issue.level !== "error"), issues };
    if (!validation.ok || this.activeNativeId) {
      const rejected: BuildJob = {
        id,
        simulated: false,
        verification: null,
        status: "failed",
        request,
        validation,
        logs: this.activeNativeId && validation.ok
          ? ["Another native build is already running. Wait for it to finish before starting a second one."]
          : ["Catalogue composition was rejected before the compiler started.", ...issues.map((issue) => issue.message)],
        artifacts: [],
        partitionLayoutId: null,
        durationMs: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.jobs.save(rejected);
      return rejected;
    }
    this.catalogueHooks.set(id, hook);
    const running: BuildJob = {
      id,
      simulated: false,
      verification: null,
      status: "running",
      request,
      validation,
      logs: ["Catalogue composition accepted. The ESP-IDF compiler has been started. The device is not being written.", ...hook.notes],
      artifacts: [],
      partitionLayoutId: null,
      durationMs: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.jobs.save(running);
    void this.executeNative(running);
    return running;
  }

  async recoverInterrupted(): Promise<void> {
    for (const job of await this.jobs.list()) {
      if (job.status !== "running") continue;
      job.status = "interrupted";
      job.verification = null;
      job.artifacts = job.artifacts.map((artifact) => ({ ...artifact, deployable: false }));
      job.logs = [
        ...job.logs,
        "The API process stopped before this build finished. It is not a successful firmware package.",
      ];
      job.updatedAt = new Date().toISOString();
      await this.jobs.save(job);
      await rm(path.join(this.dataDir, "builds", job.id, "workspace"), { recursive: true, force: true });
    }
  }

  async cancel(id: string): Promise<BuildJob | null> {
    const job = await this.jobs.get(id);
    if (!job) return null;
    const controller = this.running.get(id);
    if (job.status !== "running" || !controller) return job;
    controller.abort();
    job.logs = [...job.logs, "Cancellation requested."];
    job.updatedAt = new Date().toISOString();
    await this.persist(job);
    return job;
  }

  async readLog(id: string): Promise<{ status: BuildJob["status"]; tail: string } | null> {
    const job = await this.jobs.get(id);
    if (!job) return null;
    const file = path.join(this.dataDir, "builds", id, "artifacts", "build.log");
    let tail = job.logs.join("\n");
    try {
      const text = await readFile(file, "utf8");
      const lines = text.split(/\r?\n/);
      tail = lines.slice(-200).join("\n");
    } catch {
      // The milestone list is enough until the log file exists.
    }
    return { status: job.status, tail };
  }

  private persist(job: BuildJob): Promise<void> {
    this.saveChain = this.saveChain.then(() => this.jobs.save(job));
    return this.saveChain;
  }

  private appendLog(job: BuildJob, line: string): void {
    const next = [...job.logs, line];
    job.logs = next.length > 48 ? [...next.slice(0, 8), ...next.slice(-40)] : next;
    this.logChain = this.logChain.then(async () => {
      const file = path.join(this.dataDir, "builds", job.id, "artifacts", "build.log");
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, `${line}\n`);
      const now = Date.now();
      if (now - this.lastSave > 2000) {
        this.lastSave = now;
        job.updatedAt = new Date().toISOString();
        await this.persist(job);
      }
    });
  }

  private async executeNative(job: BuildJob): Promise<void> {
    const pin = job.request.pins.find((item) =>
      (item.componentId === "iotedu-dht11" || item.componentId === "custom-dht11") && item.pinName === "DHT11_DATA");
    const controller = new AbortController();
    this.running.set(job.id, controller);
    this.activeNativeId = job.id;
    const artifactDir = path.join(this.dataDir, "builds", job.id, "artifacts");
    const workspaceDir = path.join(this.dataDir, "builds", job.id, "workspace");
    const hook = this.catalogueHooks.get(job.id);
    const runner = this.options.runNative ?? runNativeDht11Build;
    let result: NativeBuildResult | null = null;
    try {
      result = await runner({
        repoRoot: this.repoRoot,
        workspaceDir,
        artifactDir,
        softwareVersion: job.request.softwareVersion,
        softwareVersionString: job.request.softwareVersionString,
        dht11Gpio: pin?.gpio ?? 4,
        signal: controller.signal,
        prepareWorkspace: hook ? () => hook.prepareWorkspace(workspaceDir) : undefined,
        onLog: (line) => {
          this.appendLog(job, line);
        },
      });
      await this.logChain;
      await this.persist(job);
      job.durationMs = result.durationMs;
      job.partitionLayoutId = result.partitionLayoutId;
      job.validation = {
        ok: result.ok && result.issues.every((issue) => issue.level !== "error"),
        issues: [...job.validation.issues, ...result.issues],
      };
      job.logs = [...job.logs, ...result.summary];
      if (result.cancelled || controller.signal.aborted) {
        job.status = "interrupted";
        job.verification = null;
        job.simulated = false;
        job.artifacts = [];
        job.logs = [...job.logs, "Build cancelled. No firmware package was published."];
      } else if (result.ok) {
        job.status = "succeeded";
        job.verification = "compiled";
        job.simulated = false;
        job.artifacts = await this.recordedArtifacts(job.id, result, artifactDir);
        job.logs = [...job.logs, "Compilation finished. The package is compiled and has not been hardware-verified."];
      } else {
        job.status = "failed";
        job.verification = null;
        job.simulated = false;
        job.artifacts = await this.diagnosticArtifacts(job.id, artifactDir);
        job.logs = [...job.logs, "Build failed. No deployable firmware package was published."];
      }
    } catch (error) {
      job.status = "failed";
      job.verification = null;
      job.simulated = false;
      job.artifacts = [];
      job.logs = [...job.logs, error instanceof Error ? error.message : "Native build failed"];
    } finally {
      this.running.delete(job.id);
      if (this.activeNativeId === job.id) this.activeNativeId = null;
      this.catalogueHooks.delete(job.id);
      job.updatedAt = new Date().toISOString();
      await this.persist(job);
      if (hook) {
        try {
          await hook.onComplete(job, result);
        } catch (error) {
          job.logs = [...job.logs, error instanceof Error ? error.message : "The catalogue build record was not saved."];
          job.updatedAt = new Date().toISOString();
          await this.persist(job);
        }
      }
    }
  }

  private async recordedArtifacts(id: string, result: NativeBuildResult, artifactDir: string): Promise<BuildArtifact[]> {
    const artifacts: BuildArtifact[] = result.artifacts.map((artifact) => ({
      name: artifact.name,
      relativePath: path.join("builds", id, "artifacts", artifact.name),
      sha256: artifact.sha256,
      size: artifact.size,
      simulated: false,
      deployable: artifact.deployable,
    }));
    try {
      artifacts.push(await this.hashFile(id, artifactDir, "build.log", false));
    } catch {
      // A runner can finish without writing a log file.
    }
    const sums = artifacts.map((artifact) => `${artifact.sha256}  ${artifact.name}`).join("\n") + "\n";
    const sumsPath = path.join(artifactDir, "SHA256SUMS");
    await writeFile(sumsPath, sums);
    artifacts.push(await this.hashFile(id, artifactDir, "SHA256SUMS", false));
    return artifacts;
  }

  private async diagnosticArtifacts(id: string, artifactDir: string): Promise<BuildArtifact[]> {
    const found: BuildArtifact[] = [];
    for (const name of ["build.log", "sdkconfig"]) {
      try {
        found.push(await this.hashFile(id, artifactDir, name, false));
      } catch {
        // A failed start may not have produced that file.
      }
    }
    return found;
  }

  private async hashFile(id: string, artifactDir: string, name: string, deployable: boolean): Promise<BuildArtifact> {
    const body = await readFile(path.join(artifactDir, name));
    return {
      name,
      relativePath: path.join("builds", id, "artifacts", name),
      sha256: createHash("sha256").update(body).digest("hex"),
      size: body.length,
      simulated: false,
      deployable,
    };
  }

  async get(id: string) {
    return this.jobs.get(id);
  }

  async list() {
    return this.jobs.list();
  }
}

export class LocalOtaService {
  private listening = false;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly builds: BuildRepository,
    private readonly jobs: OtaRepository,
    private readonly nodes: { getById(id: string): Promise<ManagedNode | null>; list(): Promise<ManagedNode[]> },
    private readonly profile: BoardProfile,
    private readonly repoRoot: string,
    private readonly dataDir: string,
    private readonly matter: MatterManagementService,
  ) {}

  attach(): void {
    if (this.listening) return;
    this.listening = true;
    this.matter.subscribeOta((event) => {
      this.pending = this.pending
        .catch(() => undefined)
        .then(() => this.onProviderEvent(event.matterNodeId, event))
        .catch((error: unknown) => {
          console.error(JSON.stringify({
            source: "iotedu-ota",
            message: "An OTA progress write failed. The controller stayed up and the image was not offered again.",
            detail: error instanceof Error ? error.message : "unknown",
          }));
        });
    });
  }

  async recoverInterrupted(): Promise<void> {
    for (const job of await this.jobs.list()) {
      try {
        const transferred = transferCompleted(job);
        const unverified = job.status === "interrupted" && !job.verification && transferred;
        if (job.status !== "running" && !unverified) continue;
        if (job.status === "running") {
          const checkedAt = new Date().toISOString();
          job.status = "interrupted";
          job.installedVersionConfirmed = false;
          job.verification = {
            state: "needs_verification",
            softwareVersion: null,
            softwareVersionString: null,
            vendorId: null,
            productId: null,
            endpointIds: [],
            deviceTypes: [],
            detail: transferred
              ? "The firmware download completed, but IoT.Edu restarted before confirming installation. The image was not offered again."
              : "IoT.Edu restarted before the download was confirmed. The image was not offered again.",
            checkedAt,
          };
          job.message = job.verification.detail;
          job.updatedAt = checkedAt;
          await this.jobs.save(job);
        }
        if (transferred) await this.verify(job.id);
      } catch (error) {
        console.error(JSON.stringify({
          source: "iotedu-ota",
          message: "OTA recovery could not be saved. The image was not offered again.",
          detail: error instanceof Error ? error.message : "unknown",
        }));
      }
    }
  }

  async verify(id: string): Promise<OtaJob | null> {
    const job = await this.jobs.get(id);
    if (!job?.matterNodeId) return job;
    const expected = await this.expectedIdentity(job.request.buildId);
    try {
      const version = await this.matter.readInstalledSoftwareVersion(job.matterNodeId);
      const node = (await this.nodes.list()).find((item) => item.matterNodeId === job.matterNodeId) ?? null;
      let endpoints: Awaited<ReturnType<NonNullable<MatterManagementService["readApplicationModel"]>>> = null;
      if (this.matter.readApplicationModel) {
        try {
          endpoints = await this.matter.readApplicationModel(job.matterNodeId);
        } catch {
          endpoints = null;
        }
      }
      reconcileObservedFirmware(job, {
        reachable: version != null,
        softwareVersion: version,
        softwareVersionString: node?.softwareVersionString ?? null,
        vendorId: node?.vendorId ?? null,
        productId: node?.productId ?? null,
        endpoints,
      }, expected);
    } catch (error) {
      reconcileObservedFirmware(job, {
        reachable: false,
        softwareVersion: null,
        softwareVersionString: null,
        vendorId: null,
        productId: null,
        endpoints: null,
      }, expected);
      job.message = `${error instanceof Error ? error.message : "The device could not be read."} The image was not offered again.`;
      if (job.verification) job.verification.detail = job.message;
    }
    await this.jobs.save(job);
    return job;
  }

  private async expectedIdentity(buildId: string): Promise<ExpectedFirmwareIdentity | null> {
    if (!catalogueEnabled()) return null;
    try {
      const catalogue = await loadOtaCatalogue(await this.builds.list(), this.profile);
      const release = catalogue.releases.find((item) => item.buildId === buildId) ?? null;
      if (!release) return null;
      return { vendorId: release.vendorId, productId: release.productId, deviceTypes: deviceTypesFor(release.components) };
    } catch {
      return null;
    }
  }

  async preflight(input: OtaRequest): Promise<PreflightResult> {
    const prepared = await this.inspect(input);
    const allowed = prepared.checks.filter((check) => check.mandatory).every((check) => check.status === "passed");
    return {
      allowed,
      checks: prepared.checks,
      message: allowed
        ? "Preflight passed. Deployment still waits for the device to request the image and to report the new SoftwareVersion."
        : "Deployment is blocked. A mandatory check failed or could not be verified.",
    };
  }

  async deploy(input: OtaRequest): Promise<OtaJob> {
    const prepared = await this.inspect(input);
    const allowed = prepared.checks.filter((check) => check.mandatory).every((check) => check.status === "passed");
    const now = new Date().toISOString();
    const preflight = {
      allowed,
      checks: prepared.checks,
      message: allowed
        ? "Preflight passed. Deployment still waits for the device to request the image and to report the new SoftwareVersion."
        : "Deployment is blocked. A mandatory check failed or could not be verified.",
    };
    const job: OtaJob = {
      id: randomUUID(),
      simulated: false,
      status: allowed ? "running" : "blocked",
      request: input,
      preflight,
      stages: initialOtaStages(),
      matterNodeId: prepared.node?.matterNodeId ?? null,
      expectedSoftwareVersion: prepared.image?.softwareVersion ?? null,
      previousSoftwareVersion: prepared.node?.softwareVersion ?? null,
      installedVersionConfirmed: false,
      message: allowed
        ? "Preflight passed. The provider has not announced the image yet."
        : "Deployment was not started. " + preflight.message,
      createdAt: now,
      updatedAt: now,
    };
    if (!allowed || !prepared.imageBytes || !prepared.node?.matterNodeId || prepared.image?.vendorId == null || prepared.image.productId == null || prepared.image.softwareVersion == null) {
      job.status = "blocked";
      job.simulated = prepared.node?.simulated === true;
      await this.jobs.save(job);
      return job;
    }
    const existing = await this.jobs.list();
    const running = existing.find((item) => item.request.nodeId === input.nodeId && item.status === "running");
    const awaitingCheck = existing.find((item) => item.request.nodeId === input.nodeId && (item.verification?.state === "needs_verification" || item.verification?.state === "unavailable"));
    if (running || awaitingCheck) {
      job.status = "blocked";
      job.message = running
        ? "Another update is already running for this node. It was not interrupted."
        : "A previous update still needs a firmware check. The image was not offered again.";
      await this.jobs.save(job);
      return job;
    }
    recordStage(job, "preflight", "observed", "Every mandatory preflight check was verified.");
    await this.jobs.save(job);
    try {
      await this.matter.beginOta({
        matterNodeId: prepared.node.matterNodeId,
        image: prepared.imageBytes,
        vendorId: prepared.image.vendorId,
        productId: prepared.image.productId,
        softwareVersion: prepared.image.softwareVersion,
      });
      await this.pending;
      const current = (await this.jobs.get(job.id)) ?? job;
      recordStage(current, "provider_ready", "observed", "The image is stored on the management controller and the provider announced it on the management fabric. A device request has not been received.");
      current.message = "The provider is ready. The update is not complete until the device reports the new SoftwareVersion.";
      current.updatedAt = new Date().toISOString();
      await this.jobs.save(current);
      return current;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The provider could not offer the image.";
      recordStage(job, "provider_ready", "failed", detail);
      job.status = "failed";
      job.message = `${detail} No factory reset was performed.`;
    }
    job.updatedAt = new Date().toISOString();
    await this.jobs.save(job);
    return job;
  }

  async get(id: string) {
    const job = await this.jobs.get(id);
    if (!job || job.status !== "running" || !job.matterNodeId) return job;
    try {
      const version = await this.matter.readInstalledSoftwareVersion(job.matterNodeId);
      confirmInstalledVersion(job, version, null);
    } catch (error) {
      confirmInstalledVersion(job, null, error instanceof Error ? error.message : "The device could not be read.");
    }
    await this.jobs.save(job);
    return job;
  }

  private async onProviderEvent(matterNodeId: string, event: Parameters<typeof applyProviderEvent>[1]): Promise<void> {
    const job = (await this.jobs.list()).find((item) => item.matterNodeId === matterNodeId && (item.status === "running" || item.status === "interrupted"));
    if (!job || job.status !== "running") return;
    applyProviderEvent(job, event);
    await this.jobs.save(job);
  }

  private async inspect(input: OtaRequest): Promise<{
    checks: PreflightCheck[];
    node: ManagedNode | null;
    image: MatterOtaInspection | null;
    imageBytes: Uint8Array | null;
  }> {
    const checks: PreflightCheck[] = [];
    const node = await this.nodes.getById(input.nodeId);
    const build = await this.builds.get(input.buildId);
    const artifact = build?.artifacts.find((item) => item.name === input.artifactName) ?? null;
    const layout = await loadReferenceLayout(this.repoRoot, this.profile);
    const slot = layout.partitions.find((row) => row.name === "ota_0");
    const provider = await this.matter.getOtaProviderStatus();
    const others = (await this.jobs.list()).filter((job) => job.request.nodeId === input.nodeId && job.status === "running");
    let image: MatterOtaInspection | null = null;
    let imageBytes: Uint8Array | null = null;
    const realFile = Boolean(artifact && !artifact.simulated && artifact.deployable && artifact.name.endsWith(".ota") && build?.verification === "compiled");
    if (realFile && artifact && build) {
      try {
        imageBytes = await readFile(path.join(this.dataDir, "builds", build.id, "artifacts", artifact.name));
        image = inspectMatterOtaImage(imageBytes);
      } catch {
        image = null;
      }
    }
    let hashStatus: "match" | "mismatch" | "unchecked" = "unchecked";
    if (realFile && artifact && imageBytes && /^[a-f0-9]{64}$/.test(artifact.sha256)) {
      const actual = createHash("sha256").update(imageBytes).digest("hex");
      hashStatus = actual === artifact.sha256 ? "match" : "mismatch";
    }
    let requestorConfigured: boolean | null = null;
    let rollbackConfigured = false;
    if (build && realFile) {
      try {
        const sdkconfig = await readFile(path.join(this.dataDir, "builds", build.id, "artifacts", "sdkconfig"), "utf8");
        requestorConfigured = /CONFIG_ENABLE_OTA_REQUESTOR=y/.test(sdkconfig);
        rollbackConfigured = /CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y/.test(sdkconfig);
      } catch {
        requestorConfigured = null;
      }
    }
    let liveVersion: number | null = null;
    let liveRead: "not_checked" | "read" | "failed" = "not_checked";
    let requestorReport: Awaited<ReturnType<NonNullable<MatterManagementService["readOtaRequestor"]>>> | null = null;
    if (node && !node.simulated && node.matterNodeId && node.connection === "reachable") {
      try {
        liveVersion = await this.matter.readInstalledSoftwareVersion(node.matterNodeId);
        liveRead = liveVersion == null ? "failed" : "read";
      } catch {
        liveRead = "failed";
      }
      if (this.matter.readOtaRequestor) {
        try {
          requestorReport = await this.matter.readOtaRequestor(node.matterNodeId);
        } catch {
          requestorReport = null;
        }
      }
    }
    const recordedBuilds = await this.builds.list();
    const installedLayout = node?.partitionLayoutId
      ?? recordedBuilds.find((item) => item.verification === "compiled" && item.partitionLayoutId === layout.layoutId && item.request.softwareVersion === (liveVersion ?? node?.softwareVersion))?.partitionLayoutId
      ?? null;
    const push = (check: PreflightCheck) => checks.push(check);
    push({ id: "single_node", label: "Device identity", status: node ? "passed" : "failed", mandatory: true, detail: node ? `${node.name}. Matter node ${node.matterNodeId ?? "not assigned"}.` : "The selected node does not exist." });
    push({ id: "artifact_present", label: "Selected firmware package", status: artifact ? "passed" : "failed", mandatory: true, detail: artifact ? artifact.name : "The artifact is not recorded for that build." });
    push({
      id: "artifact_real",
      label: "Compiled Matter OTA image",
      status: realFile ? "passed" : "failed",
      mandatory: true,
      detail: artifact?.simulated || build?.verification === "simulated"
        ? "This package is simulated. It cannot be offered to a device."
        : realFile ? "The build is compiled and the selected file is a .ota image." : "Only a compiled sensors.ota image can be offered.",
    });
    push({
      id: "matter_image",
      label: "Image compatibility",
      status: artifact?.simulated ? "failed" : !realFile ? "unknown" : image?.ok ? "passed" : "failed",
      mandatory: true,
      detail: artifact?.simulated ? "A simulated file is not a Matter OTA image." : image?.error ?? (image?.ok ? `Matter OTA header VID ${hex(image.vendorId)} PID ${hex(image.productId)} SoftwareVersion ${image.softwareVersion}.` : "The file was not read."),
    });
    push({
      id: "artifact_hash",
      label: "Firmware artifact integrity",
      status: hashStatus === "match" ? "passed" : hashStatus === "mismatch" ? "failed" : "unknown",
      readiness: hashStatus === "mismatch" ? "check_failed" : undefined,
      mandatory: hashStatus !== "unchecked",
      detail: hashStatus === "match"
        ? "The OTA file matches its recorded SHA-256."
        : hashStatus === "mismatch"
          ? "The OTA file does not match its recorded SHA-256."
          : "This record does not have a SHA-256 hash to compare. A compiled file name is not integrity evidence.",
    });
    push({
      id: "installed_version",
      label: "Current firmware version",
      status: liveRead === "read" ? "passed" : liveRead === "failed" ? "failed" : "unknown",
      readiness: liveRead === "failed" ? "check_failed" : undefined,
      mandatory: true,
      detail: liveRead === "read"
        ? `Installed SoftwareVersion ${liveVersion} was read from the device for this check.`
        : liveRead === "failed"
          ? "The device was marked reachable, but SoftwareVersion could not be read in this check."
          : "The device is not currently reachable, so SoftwareVersion was not read. A stored version is not used.",
    });
    push({
      id: "version_newer",
      label: "Proposed firmware version",
      status: liveRead !== "read" || image?.softwareVersion == null ? "unknown" : image.softwareVersion > (liveVersion ?? 0) && image.softwareVersion === build?.request.softwareVersion ? "passed" : "failed",
      mandatory: true,
      detail: image?.softwareVersion == null
        ? "The image version could not be verified."
        : `Image SoftwareVersion ${image.softwareVersion} (${image.softwareVersionString ?? ""}). Installed SoftwareVersion ${liveRead === "read" ? liveVersion : "not read"}.`,
    });
    push({
      id: "vid_pid",
      label: "Vendor and product",
      status: node?.vendorId == null || node?.productId == null || image?.vendorId == null || image.productId == null ? "unknown" : node.vendorId === image.vendorId && node.productId === image.productId ? "passed" : "failed",
      mandatory: true,
      detail: image?.vendorId == null ? "Vendor and product identifiers were not verified from the image and the device." : `Image ${hex(image.vendorId)}/${hex(image.productId)}. Device ${hex(node?.vendorId ?? null)}/${hex(node?.productId ?? null)}.`,
    });
    push({
      id: "hardware",
      label: "ESP32-H2 target",
      status: !image ? "unknown" : image.targetsEsp32h2 ? "passed" : "failed",
      mandatory: true,
      detail: image?.targetsEsp32h2 ? "The payload image header names ESP32-H2." : image?.chipId == null ? "The payload chip id could not be verified." : `The payload chip id is ${image.chipId}, not ESP32-H2.`,
    });
    push({
      id: "size",
      label: "OTA partition capacity",
      status: image?.payloadSize == null || !slot ? "unknown" : appFitsPartition(image.payloadSize, slot.size).some((issue) => issue.level === "error") ? "failed" : "passed",
      mandatory: true,
      detail: image?.payloadSize == null || !slot ? "The payload size or the OTA slot size is not available." : `Payload ${image.payloadSize} bytes. OTA slot ${slot.size} bytes.`,
    });
    push({
      id: "partition_layout",
      label: "Partition compatibility",
      status: installedLayout == null ? "unknown" : installedLayout === layout.layoutId ? "passed" : "failed",
      mandatory: true,
      detail: installedLayout == null
        ? "The partition layout has not been recorded for this node or for the installed package. A merged image is not assumed to be safe."
        : installedLayout === layout.layoutId
          ? "The installed package uses this partition layout. An OTA write uses the inactive application slot. NVS, factory data, Matter fabric credentials, and Thread operational data are outside that slot. The running slot was not read from the device."
          : "The recorded layout does not match this package. A write would need explicit approval because it can disturb NVS, Matter fabric data, or Thread data.",
    });
    const requestorReady = requestorReport
      ? requestorReport.clusterPresent && requestorReport.updatePossible === true && requestorReport.announceAccepted !== false && requestorConfigured !== false
      : liveRead === "read" && node?.firmwareUpdateEligible === true && requestorConfigured !== false;
    push({
      id: "ota_requestor",
      label: "OTA Requestor capability",
      status: liveRead === "failed" ? "failed" : requestorReady ? "passed" : requestorReport || (liveRead === "read" && (node?.firmwareUpdateEligible === false || requestorConfigured === false)) ? "failed" : "unknown",
      readiness: liveRead === "failed" ? "check_failed" : undefined,
      mandatory: true,
      detail: requestorReport
        ? requestorReport.detail
        : liveRead !== "read"
          ? "The OTA Requestor was not read. A stored update flag is not current evidence."
          : requestorReady
            ? "SoftwareVersion was read in this check and the stored requestor flag allows an update. That flag is not a separate Requestor-cluster read, and it does not authorise an update."
            : "The device was read, and the stored requestor flag does not allow an update.",
    });
    push({
      id: "image_requestor",
      label: "Package OTA Requestor",
      status: requestorConfigured == null ? "unknown" : requestorConfigured ? "passed" : "failed",
      mandatory: requestorConfigured != null,
      detail: requestorConfigured == null
        ? "This package has no sdkconfig, so its OTA Requestor setting was not confirmed. A .ota file does not prove the application contains a Requestor."
        : requestorConfigured
          ? "CONFIG_ENABLE_OTA_REQUESTOR is enabled in this package. The application starts the Matter OTA Requestor through the installed SDK."
          : "This package was built without the Matter OTA Requestor.",
    });
    push({
      id: "management_fabric",
      label: "Matter management connection",
      status: liveRead === "read" ? "passed" : liveRead === "failed" || node?.simulated || !node?.matterNodeId ? "failed" : "unknown",
      readiness: liveRead === "failed" ? "check_failed" : undefined,
      mandatory: true,
      detail: liveRead === "read"
        ? "An operational read of SoftwareVersion succeeded in this check."
        : liveRead === "failed"
          ? "The stored connection said reachable, but this check could not read the device."
          : node?.matterNodeId
            ? "The device was not read. A saved Matter peer is not current reachability."
            : "This record is not on the management fabric.",
    });
    push({
      id: "ota_provider",
      label: "Provider connectivity",
      status: provider.running && provider.fabricScoped && provider.ledgerOffline ? "passed" : "failed",
      mandatory: true,
      detail: provider.running ? `OTA Provider endpoint ${provider.endpointNumber ?? "unknown"}. The image ledger client is offline, so only an image stored by this controller can be served.` : "The OTA Provider is not running on the management controller.",
    });
    push({
      id: "provider_permission",
      label: "Provider permission",
      status: !provider.running || node?.simulated || !node?.matterNodeId ? "failed" : node.connection == null ? "unknown" : node.connection === "reachable" && input.userApproved ? "passed" : "failed",
      mandatory: true,
      detail: "A requestor read is not enough. The offer requires this controller's fabric session and explicit approval.",
    });
    if (catalogueEnabled() && build) {
      let releaseStatus: PreflightCheck["status"] = "failed";
      let releaseDetail = "This package is not a release candidate or a published release.";
      let releaseReadiness: PreflightCheck["readiness"];
      try {
        const releases = await listFirmwareReleases();
        const match = releases.find((release) => release.buildId === build.id && (release.state === "release_candidate" || release.state === "published"));
        if (!match) {
          releaseDetail = "This package is not a verified release candidate or a published release, so it is not eligible for deployment.";
        } else if (hashStatus === "mismatch" || (match.otaSha256 && artifact?.sha256 && match.otaSha256 !== artifact.sha256)) {
          releaseStatus = "failed";
          releaseReadiness = "check_failed";
          releaseDetail = "The OTA file does not match the release record.";
        } else if (image?.softwareVersion !== match.softwareVersion || image.softwareVersionString !== match.softwareVersionString) {
          releaseDetail = "The OTA header and the release record do not use the same Matter version.";
        } else {
          releaseStatus = "passed";
          releaseDetail = `${match.softwareVersionString} is recorded as ${match.state === "published" ? "a published release" : "a release candidate"}. The file hash was compared with that record.`;
        }
      } catch {
        releaseReadiness = "check_failed";
        releaseDetail = "The firmware release record could not be read.";
      }
      push({ id: "firmware_release", label: "Firmware release record", status: releaseStatus, readiness: releaseReadiness, mandatory: true, detail: releaseDetail });
    }
    if (catalogueEnabled() && build && node) {
      try {
        const catalogue = await loadOtaCatalogue(await this.builds.list(), this.profile);
        const decision = firmwareOnlyEligibility({
          node: {
            vendorId: node.vendorId,
            productId: node.productId,
            softwareVersion: liveRead === "read" && liveVersion != null ? liveVersion : node.softwareVersion,
            softwareVersionString: node.softwareVersionString,
          },
          releases: catalogue.releases,
          buildId: build.id,
        });
        push({
          id: "function_profile",
          label: "Firmware function",
          status: decision.eligible ? "passed" : "failed",
          mandatory: true,
          detail: decision.reason,
        });
      } catch {
        push({
          id: "function_profile",
          label: "Firmware function",
          status: "failed",
          mandatory: true,
          detail: "The installed firmware recipe could not be read, so this package was not offered.",
        });
      }
    }
    if (input.migrationRisk === "B" || input.migrationRisk === "C") {
      push({
        id: "apple_home_rediscovery",
        label: "Apple Home rediscovery",
        status: "warning",
        mandatory: false,
        detail: "Existing Matter fabrics are intended to remain, but Apple Home may need to refresh its accessory representation and may not automatically recognise the new device type. A successful CASE session does not prove that.",
      });
    }
    if (input.migrationRisk === "C") {
      push({
        id: "functionality_migration",
        label: "Functionality replacement acknowledgement",
        status: input.migrationAcknowledged ? "passed" : "failed",
        mandatory: true,
        detail: input.migrationAcknowledged
          ? "The functionality replacement was acknowledged separately from ordinary OTA approval. The product id staying the same does not make this low-risk."
          : "Removing or replacing Matter functionality needs a separate acknowledgement. A constant product id does not make the endpoint change low-risk.",
      });
    }
    const mandatoryOpen = checks.filter((check) => check.mandatory && check.status !== "passed");
    push({
      id: "transfer_ready",
      label: "Transfer readiness",
      status: others.length > 0 ? "failed" : mandatoryOpen.length === 0 && input.userApproved ? "passed" : mandatoryOpen.some((check) => check.status === "unknown") ? "unknown" : "failed",
      mandatory: true,
      detail: others.length > 0 ? "An update is already running for this node." : "Transfer readiness follows the checks above. Rollback has not been verified.",
    });
    push({ id: "power", label: "Power-related warning", status: "warning", mandatory: false, detail: "Keep the board powered for the whole transfer. This warning does not mean a transfer has started." });
    push({
      id: "rollback",
      label: "Rollback",
      status: "unknown",
      mandatory: false,
      detail: rollbackConfigured
        ? "This package enables application rollback. The bootloader already on the board was not read, so this does not prove the installed bootloader can roll back. A failed boot still needs the USB recovery path."
        : "CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE is not set in this package. Firmware 1.9.0 was built the same way. A new application cannot turn bootloader rollback on. The inactive OTA slot remains the written image, and USB installation remains the recovery path. No eFuse or flash-encryption setting is changed.",
    });
    push({
      id: "acl",
      label: "OTA ACL permissions",
      status: requestorReport?.aclRead === "read" ? requestorReport.controllerCanAnnounce ? "passed" : "failed" : requestorReport?.aclRead === "failed" ? "failed" : "unknown",
      readiness: requestorReport?.aclRead === "failed" ? "check_failed" : undefined,
      mandatory: true,
      detail: requestorReport
        ? requestorReport.aclRead === "read"
          ? requestorReport.controllerCanAnnounce
            ? "The access-control list grants this controller Operate or higher for AnnounceOTAProvider. No entry was changed."
            : "The access-control list does not grant this controller permission to announce an OTA Provider. No entry was changed. Add a scoped grant only after explicit approval."
          : "The access-control list could not be read. No entry was changed, and an announcement is not authorised from an unread list."
        : "The device Access Control list was not read. A future transfer still needs this controller permitted to offer an update on the existing fabric. No fabric or credential was created or changed.",
    });
    push({ id: "approval", label: "Explicit user approval", status: input.userApproved ? "passed" : "failed", mandatory: true, detail: input.userApproved ? "Approval was supplied for this node and this package." : "Deployment requires explicit approval." });
    return { checks: checks.map(withReadiness), node, image, imageBytes };
  }
}

function withReadiness(check: PreflightCheck): PreflightCheck {
  if (check.readiness) return check;
  const readiness = check.status === "passed" ? "ready" : check.status === "unknown" ? "not_checked" : "not_ready";
  return { ...check, readiness };
}

function hex(value: number | null): string {
  if (value == null) return "unknown";
  return `0x${value.toString(16).toUpperCase().padStart(4, "0")}`;
}
