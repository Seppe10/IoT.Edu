import { OTA_LIFECYCLE, type OtaJob, type OtaProviderEvent } from "@iotedu/contracts";

export function initialOtaStages(): OtaJob["stages"] {
  return OTA_LIFECYCLE.map((stage) => ({
    id: stage.id,
    label: stage.label,
    state: "not_observed" as const,
    detail: "This stage has not been observed.",
  }));
}

export function recordStage(job: OtaJob, id: string, state: OtaJob["stages"][number]["state"], detail: string): void {
  const stage = job.stages.find((item) => item.id === id);
  if (!stage) return;
  if (stage.state === "observed" && state !== "failed" && state !== "interrupted") return;
  stage.state = state;
  stage.detail = detail;
  job.updatedAt = new Date().toISOString();
}

/**
 * Map a provider callback onto the deployment record.
 * Transfer completion never marks the job succeeded. Only a later SoftwareVersion read can do that.
 */
export function applyProviderEvent(job: OtaJob, event: OtaProviderEvent): void {
  if (event.matterNodeId !== job.matterNodeId) return;
  if (job.status === "succeeded" || job.status === "blocked") return;
  switch (event.type) {
    case "bdx-start":
      recordStage(job, "update_request", "observed", "A BDX session opened. The provider enables BDX while handling QueryImage, so the device requested this image.");
      recordStage(job, "transfer_started", "observed", event.detail);
      if (job.status === "running") job.message = "The device requested the image and BDX transfer has started. The installed version has not been read.";
      break;
    case "bdx-progress": {
      if (job.status !== "running") break;
      const stage = job.stages.find((item) => item.id === "transfer_started");
      const observed = progressText(event);
      if (stage) {
        stage.state = "observed";
        stage.detail = observed;
      }
      job.message = `BDX transfer is in progress. ${observed} The installed version has not been read.`;
      job.updatedAt = new Date().toISOString();
      break;
    }
    case "bdx-complete":
      recordStage(job, "transfer_completed", "observed", event.detail);
      if (job.status === "running") job.message = "BDX reported the transfer finished. The update is not complete until the device reports the new SoftwareVersion.";
      break;
    case "bdx-interrupted":
      if (job.stages.find((stage) => stage.id === "transfer_completed")?.state === "observed") break;
      recordStage(job, "transfer_started", "interrupted", event.detail);
      job.status = "interrupted";
      job.message = `${event.detail} The transfer was not started again.`;
      break;
    case "applying":
      if (job.stages.find((stage) => stage.id === "transfer_completed")?.state === "not_observed") {
        recordStage(job, "transfer_completed", "inferred", "ApplyUpdateRequest arrived. A separate BDX completion event was not seen.");
      }
      recordStage(job, "applying", "observed", event.detail);
      recordStage(job, "restart", "inferred", "The provider allowed the apply. A restart or disconnection has not been observed.");
      if (job.status === "running") job.message = "The device asked to apply the image. The new SoftwareVersion has not been read.";
      break;
    case "failed":
      recordStage(job, "applying", "failed", event.detail);
      job.status = "failed";
      job.installedVersionConfirmed = false;
      job.message = `${event.detail} No factory reset was performed.`;
      break;
    default:
      break;
  }
}

export function confirmInstalledVersion(job: OtaJob, version: number | null, error: string | null): void {
  if (job.status === "succeeded" || job.status === "blocked" || job.status === "failed" || job.status === "interrupted") return;
  const applying = job.stages.find((stage) => stage.id === "applying");
  const applySeen = applying?.state === "observed" || applying?.state === "inferred";
  if (!applySeen) {
    if (error && job.stages.some((stage) => stage.id === "transfer_started" && stage.state === "observed")) {
      recordStage(job, "transfer_started", "interrupted", error);
      job.status = "interrupted";
      job.message = `${error} The image was not offered again.`;
    }
    return;
  }
  if (version == null) {
    if (!error) return;
    recordStage(job, "restart", "interrupted", error);
    job.message = `${error} The image was not offered again. A later read can still confirm the version.`;
    return;
  }
  recordStage(job, "reconnected", "observed", `Basic Information returned SoftwareVersion ${version}.`);
  if (job.expectedSoftwareVersion != null && version === job.expectedSoftwareVersion) {
    recordStage(job, "version_verified", "observed", `The device reported SoftwareVersion ${version}, which is the version in the offered image.`);
    job.installedVersionConfirmed = true;
    job.status = "succeeded";
    job.message = `The device reported SoftwareVersion ${version}.`;
    job.verification = {
      state: "installed",
      softwareVersion: version,
      softwareVersionString: null,
      vendorId: null,
      productId: null,
      endpointIds: [],
      deviceTypes: [],
      detail: `The device reported SoftwareVersion ${version}.`,
      checkedAt: new Date().toISOString(),
    };
    return;
  }
  if (job.previousSoftwareVersion != null && version === job.previousSoftwareVersion) {
    recordStage(job, "version_verified", "not_observed", `The device still reports SoftwareVersion ${version}. The offered version has not been observed.`);
    job.message = `The device still reports SoftwareVersion ${version}. The update is not complete.`;
    return;
  }
  recordStage(job, "version_verified", "failed", `The device reported SoftwareVersion ${version}. The offered image is SoftwareVersion ${job.expectedSoftwareVersion ?? "unknown"}.`);
  job.installedVersionConfirmed = false;
  job.status = "failed";
  job.message = `The device reported SoftwareVersion ${version}, which is not the offered version. The transfer was not started again.`;
}

function progressText(event: OtaProviderEvent): string {
  const bytes = event.bytesTransferred;
  const total = event.totalBytes;
  if (typeof bytes !== "number") return event.detail;
  if (typeof total === "number" && total > 0) {
    return `${bytes} of ${total} bytes transferred (${Math.floor((bytes / total) * 100)}% of the length reported by the BDX session).`;
  }
  return `${bytes} bytes transferred. The BDX session did not report a total length, so no percentage is shown.`;
}

export interface ObservedFirmware {
  reachable: boolean;
  softwareVersion: number | null;
  softwareVersionString: string | null;
  vendorId: number | null;
  productId: number | null;
  endpoints: Array<{ endpointId: number; deviceTypes: number[]; serverClusters: number[] }> | null;
}

export interface ExpectedFirmwareIdentity {
  vendorId: number | null;
  productId: number | null;
  deviceTypes: number[];
}

export function transferCompleted(job: OtaJob): boolean {
  return job.stages.some((stage) => stage.id === "transfer_completed" && (stage.state === "observed" || stage.state === "inferred"));
}

/**
 * Record a read-only check against an update that was already offered.
 * A matching SoftwareVersion is installed only when the vendor, product and expected device types also match.
 * An unread device stays unknown. The offered image is not announced again.
 */
export function reconcileObservedFirmware(job: OtaJob, observed: ObservedFirmware, expected: ExpectedFirmwareIdentity | null): void {
  const checkedAt = new Date().toISOString();
  const endpointIds = observed.endpoints?.map((endpoint) => endpoint.endpointId) ?? [];
  const deviceTypes = observed.endpoints?.flatMap((endpoint) => endpoint.deviceTypes.map((deviceType) => ({ endpointId: endpoint.endpointId, deviceType }))) ?? [];
  const base = {
    softwareVersion: observed.softwareVersion,
    softwareVersionString: observed.softwareVersionString,
    vendorId: observed.vendorId,
    productId: observed.productId,
    endpointIds,
    deviceTypes,
    checkedAt,
  };
  if (!observed.reachable || observed.softwareVersion == null) {
    job.verification = {
      ...base,
      state: "unavailable",
      detail: "The device could not be read. Whether the firmware was installed is unknown. The image was not offered again.",
    };
    if (job.status === "running") job.status = "interrupted";
    job.installedVersionConfirmed = false;
    job.message = job.verification.detail;
    job.updatedAt = checkedAt;
    return;
  }
  const identityOk = (expected?.vendorId == null || observed.vendorId === expected.vendorId)
    && (expected?.productId == null || observed.productId === expected.productId);
  const applicationTypes = observed.endpoints
    ?.filter((endpoint) => endpoint.endpointId !== 0)
    .flatMap((endpoint) => endpoint.deviceTypes) ?? null;
  const typesOk = !expected || expected.deviceTypes.length === 0 || (applicationTypes != null && expected.deviceTypes.every((deviceType) => applicationTypes.includes(deviceType)));
  const requestorOk = observed.endpoints == null
    || observed.endpoints.some((endpoint) => endpoint.endpointId === 0 && endpoint.serverClusters.includes(0x002a));
  const versionMatches = job.expectedSoftwareVersion != null && observed.softwareVersion === job.expectedSoftwareVersion;
  if (versionMatches && identityOk && typesOk && requestorOk && (expected == null || expected.deviceTypes.length === 0 || observed.endpoints != null)) {
    recordStage(job, "reconnected", "observed", `Basic Information returned SoftwareVersion ${observed.softwareVersion}.`);
    recordStage(job, "version_verified", "observed", `A read-only check found SoftwareVersion ${observed.softwareVersion} with the expected identity.`);
    job.installedVersionConfirmed = true;
    job.status = "succeeded";
    job.verification = {
      ...base,
      state: "installed",
      detail: `A read-only check found SoftwareVersion ${observed.softwareVersion}. The image was not offered again.`,
    };
    job.message = job.verification.detail;
    job.updatedAt = checkedAt;
    return;
  }
  if (versionMatches && (!identityOk || !typesOk || !requestorOk || (expected != null && expected.deviceTypes.length > 0 && observed.endpoints == null))) {
    job.verification = {
      ...base,
      state: "needs_verification",
      detail: `SoftwareVersion ${observed.softwareVersion} was read, but the device identity or endpoint list did not confirm the offered firmware. The image was not offered again.`,
    };
    if (job.status === "running") job.status = "interrupted";
    job.installedVersionConfirmed = false;
    job.message = job.verification.detail;
    job.updatedAt = checkedAt;
    return;
  }
  job.verification = {
    ...base,
    state: "not_installed",
    detail: `The device reports SoftwareVersion ${observed.softwareVersion}. Offered SoftwareVersion ${job.expectedSoftwareVersion ?? "unknown"} is not installed. The image was not offered again.`,
  };
  if (job.status === "running") job.status = "interrupted";
  job.installedVersionConfirmed = false;
  job.message = job.verification.detail;
  job.updatedAt = checkedAt;
}

export function interruptRunningJob(job: OtaJob, detail: string): void {
  if (job.status !== "running") return;
  job.status = "interrupted";
  job.installedVersionConfirmed = false;
  job.message = detail;
  const open = job.stages.find((stage) => stage.state === "not_observed" || stage.state === "inferred");
  if (open) recordStage(job, open.id, "interrupted", detail);
  job.updatedAt = new Date().toISOString();
}
