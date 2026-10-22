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

export function interruptRunningJob(job: OtaJob, detail: string): void {
  if (job.status !== "running") return;
  job.status = "interrupted";
  job.installedVersionConfirmed = false;
  job.message = detail;
  const open = job.stages.find((stage) => stage.state === "not_observed" || stage.state === "inferred");
  if (open) recordStage(job, open.id, "interrupted", detail);
  job.updatedAt = new Date().toISOString();
}
