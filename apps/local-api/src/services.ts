import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LocalCatalogRepository } from "@iotedu/catalog";
import {
  OTA_LIFECYCLE,
  type BuildJob,
  type FirmwareBuildRequest,
  type OtaJob,
  type OtaRequest,
  type PreflightResult,
  type ValidationResult,
} from "@iotedu/contracts";
import {
  appFitsPartition,
  detectGpioConflicts,
  loadReferenceLayout,
  selectionIssues,
  type BoardProfile,
} from "@iotedu/firmware-builder";
import type { BuildRepository, OtaRepository } from "./store.js";

export class LocalFirmwareBuildService {
  constructor(
    private readonly catalog: LocalCatalogRepository,
    private readonly jobs: BuildRepository,
    private readonly dataDir: string,
    private readonly repoRoot: string,
    private readonly profile: BoardProfile,
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
        simulated: true,
        status: "failed",
        request: input,
        validation,
        logs: ["Build rejected before any compiler was started.", ...validation.issues.map((issue) => issue.message)],
        artifacts: [],
        partitionLayoutId: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.jobs.save(rejected);
      return rejected;
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
      status: "simulated",
      request: input,
      validation,
      logs: [
        "Mock mode: ESP-IDF was not invoked.",
        "No sensors.bin or Matter .ota image was produced.",
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
      createdAt: now,
      updatedAt: now,
    };
    await this.jobs.save(job);
    return job;
  }

  async get(id: string) {
    return this.jobs.get(id);
  }

  async list() {
    return this.jobs.list();
  }
}

export class LocalOtaService {
  constructor(
    private readonly builds: BuildRepository,
    private readonly jobs: OtaRepository,
    private readonly nodes: { getById(id: string): Promise<import("@iotedu/contracts").ManagedNode | null> },
    private readonly profile: BoardProfile,
    private readonly repoRoot: string,
  ) {}

  async preflight(input: OtaRequest): Promise<PreflightResult> {
    const checks: PreflightResult["checks"] = [];
    const node = await this.nodes.getById(input.nodeId);
    const build = await this.builds.get(input.buildId);
    const artifact = build?.artifacts.find((item) => item.name === input.artifactName) ?? null;
    const layout = await loadReferenceLayout(this.repoRoot, this.profile);
    const slot = layout.partitions.find((row) => row.name === "ota_0");

    checks.push({
      id: "single_node",
      label: "Exactly one node",
      status: node ? "passed" : "failed",
      mandatory: true,
      detail: node ? `Target ${node.name}` : "The selected node does not exist.",
    });
    checks.push({
      id: "artifact_present",
      label: "Selected firmware artifact",
      status: artifact ? "passed" : "failed",
      mandatory: true,
      detail: artifact ? artifact.name : "The artifact is not recorded for that build.",
    });
    checks.push({
      id: "artifact_real",
      label: "Deployable firmware image",
      status: artifact && !artifact.simulated && artifact.deployable ? "passed" : "failed",
      mandatory: true,
      detail: artifact?.simulated
        ? "This artifact is simulated. Mock output cannot be deployed."
        : "No verified application binary or Matter OTA image is available.",
    });
    checks.push({
      id: "installed_version",
      label: "Installed firmware version",
      status: node?.softwareVersion == null ? "unknown" : "passed",
      mandatory: true,
      detail:
        node?.softwareVersion == null
          ? "SoftwareVersion has not been read from the node."
          : `Installed SoftwareVersion ${node.softwareVersion}.`,
    });
    checks.push({
      id: "version_newer",
      label: "Firmware version eligibility",
      status:
        node?.softwareVersion == null || !build
          ? "unknown"
          : build.request.softwareVersion > node.softwareVersion
            ? "passed"
            : "failed",
      mandatory: true,
      detail:
        node?.softwareVersion == null
          ? "Eligibility is unknown until the installed version is read."
          : `Candidate ${build?.request.softwareVersion} compared with installed ${node.softwareVersion}.`,
    });
    checks.push({
      id: "hardware",
      label: "Hardware compatibility",
      status: "unknown",
      mandatory: true,
      detail: "Hardware identity has not been read from the device.",
    });
    checks.push({
      id: "vid_pid",
      label: "VID and PID compatibility",
      status: node?.vendorId == null || node.productId == null ? "unknown" : "passed",
      mandatory: true,
      detail: "Vendor and product identifiers have not been read from Basic Information.",
    });
    checks.push({
      id: "size",
      label: "Firmware size and slot capacity",
      status: artifact?.simulated ? "unknown" : artifact && slot ? (appFitsPartition(artifact.size, slot.size).some((issue) => issue.level === "error") ? "failed" : "passed") : "unknown",
      mandatory: true,
      detail: artifact?.simulated
        ? "Size was not assessed because the file is not a firmware image."
        : "No firmware image is available to measure.",
    });
    checks.push({
      id: "partition_layout",
      label: "Partition layout compatibility",
      status: node?.partitionLayoutId == null ? "unknown" : node.partitionLayoutId === layout.layoutId ? "passed" : "failed",
      mandatory: true,
      detail:
        node?.partitionLayoutId == null
          ? "Layout is unknown until the node is flashed by this application."
          : "Compared with the reference partition layout.",
    });
    checks.push({
      id: "ota_requestor",
      label: "OTA Requestor support",
      status: "unknown",
      mandatory: true,
      detail: "The OTA Software Update Requestor cluster has not been read.",
    });
    checks.push({
      id: "management_fabric",
      label: "Management fabric availability",
      status: "unknown",
      mandatory: true,
      detail: "No management fabric session is loaded.",
    });
    checks.push({
      id: "ota_provider",
      label: "OTA Provider readiness",
      status: "unknown",
      mandatory: true,
      detail: "The local OTA Provider is not running.",
    });
    checks.push({
      id: "reachability",
      label: "Node reachability",
      status: node?.reachable == null ? "unknown" : node.reachable ? "passed" : "failed",
      mandatory: true,
      detail: "Reachability requires a Matter administrative session, which is not available.",
    });
    checks.push({
      id: "power",
      label: "Power-related warning",
      status: "warning",
      mandatory: false,
      detail: "Keep the board powered for the whole transfer. This warning does not mean a transfer has started.",
    });
    checks.push({
      id: "approval",
      label: "Explicit user approval",
      status: input.userApproved ? "passed" : "failed",
      mandatory: true,
      detail: input.userApproved ? "Approval was supplied." : "Deployment requires explicit approval.",
    });

    const allowed = checks.filter((check) => check.mandatory).every((check) => check.status === "passed");
    return {
      allowed,
      checks,
      message: allowed
        ? "Preflight passed."
        : "Deployment is blocked. Unknown mandatory checks are not treated as passed.",
    };
  }

  async deploy(input: OtaRequest): Promise<OtaJob> {
    const preflight = await this.preflight(input);
    const now = new Date().toISOString();
    const job: OtaJob = {
      id: randomUUID(),
      simulated: true,
      status: preflight.allowed ? "failed" : "blocked",
      request: input,
      preflight,
      stages: OTA_LIFECYCLE.map((stage) => ({
        id: stage.id,
        label: stage.label,
        state: "not_observed" as const,
        detail: "No Matter OTA event has been observed.",
      })),
      installedVersionConfirmed: false,
      message: preflight.allowed
        ? "Preflight passed unexpectedly without a provider. Deployment was not started."
        : "Deployment was not started. " + preflight.message,
      createdAt: now,
      updatedAt: now,
    };
    if (preflight.allowed) {
      job.status = "failed";
      job.message = "Refusing to mark success. The OTA Provider is not implemented, so no image was offered.";
    }
    await this.jobs.save(job);
    return job;
  }

  async get(id: string) {
    return this.jobs.get(id);
  }
}
