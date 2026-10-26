export interface FirmwareChoice {
  id: string;
  group: "current" | "newer" | "older" | "incompatible";
  softwareVersion: number | null;
  softwareVersionString: string | null;
  state: string | null;
  productId: number | null;
  compatible: boolean;
  detail: string;
}

export interface OtaStageView {
  id: string;
  state: string;
  detail: string;
}

export interface OtaJobView {
  status: string;
  message: string;
  previousSoftwareVersion: number | null;
  expectedSoftwareVersion: number | null;
  installedVersionConfirmed: boolean;
  stages: OtaStageView[];
  createdAt?: string;
  verification?: { state: string; detail: string; softwareVersion: number | null } | null;
}

export function firmwareOptionLabel(option: FirmwareChoice): string {
  if (option.id === "keep") {
    const version = option.softwareVersionString && option.softwareVersion != null
      ? `${option.softwareVersionString} / SoftwareVersion ${option.softwareVersion}`
      : "version not read";
    return `Keep current firmware — ${version}`;
  }
  const group = option.group === "newer" ? "Newer" : option.group === "older" ? "Older" : "Incompatible";
  const state = option.state ? option.state.replaceAll("_", " ") : "unrecorded";
  return `${group} · ${option.softwareVersionString ?? "unknown"} / SoftwareVersion ${option.softwareVersion ?? "unknown"} · ${state}`;
}

export function firmwareVersionLabel(version: number | null): string {
  if (version == null) return "unknown";
  return `1.${version - 1}.0`;
}

export function otaStartEnabled(input: {
  eligible: boolean;
  approved: boolean;
  preflightAllowed: boolean;
  busy: boolean;
  needsVerification: boolean;
}): boolean {
  return input.eligible && input.approved && input.preflightAllowed && !input.busy && !input.needsVerification;
}

export function selectionStatus(option: FirmwareChoice | undefined, needsVerification: boolean): string {
  if (needsVerification) return "Unable to update — previous update outcome requires verification.";
  if (!option || option.id === "keep") return "No update is needed.";
  if (option.group === "older") return "This older firmware cannot be installed over the air.";
  if (option.group === "newer" && option.compatible) return "Compatible update available.";
  return "Unable to update — incompatible firmware.";
}

export function preflightSummary(result: { allowed: boolean; checks: { status: string; label: string; mandatory?: boolean }[] } | null): string {
  if (!result) return "";
  if (result.allowed) return "Ready to update.";
  const failed = result.checks.find((check) => check.mandatory !== false && check.status !== "passed");
  const label = failed?.label.toLowerCase() ?? "the update check";
  if (label.includes("offline") || label.includes("connection") || label.includes("reach")) return "Unable to update — device offline.";
  if (label.includes("function") || label.includes("product") || label.includes("version")) return "Unable to update — incompatible firmware.";
  return "Unable to update.";
}

export interface OtaProgress {
  phase: "idle" | "preparing" | "downloading" | "installing" | "reconnecting" | "completed" | "failed" | "needs_verification" | "not_installed" | "unavailable";
  title: string;
  detail: string;
  percent: number | null;
  indeterminate: boolean;
  checkable: boolean;
}

export function otaProgress(job: OtaJobView | null): OtaProgress {
  if (!job) {
    return { phase: "idle", title: "No update is in progress.", detail: "", percent: null, indeterminate: false, checkable: false };
  }
  const version = firmwareVersionLabel(job.expectedSoftwareVersion);
  const transferred = job.stages.some((stage) => stage.id === "transfer_completed" && (stage.state === "observed" || stage.state === "inferred"));
  const applying = job.stages.some((stage) => stage.id === "applying" && (stage.state === "observed" || stage.state === "inferred"));
  const started = job.stages.some((stage) => stage.id === "transfer_started" && stage.state === "observed");
  if (job.verification?.state === "installed" || (job.status === "succeeded" && job.installedVersionConfirmed)) {
    return {
      phase: "completed",
      title: `Firmware updated successfully to version ${firmwareVersionLabel(job.verification?.softwareVersion ?? job.expectedSoftwareVersion)}.`,
      detail: "The new version was read from the device.",
      percent: null,
      indeterminate: false,
      checkable: false,
    };
  }
  if (job.verification?.state === "not_installed") {
    return {
      phase: "not_installed",
      title: "The requested update is not installed.",
      detail: job.verification.detail,
      percent: null,
      indeterminate: false,
      checkable: false,
    };
  }
  if (job.verification?.state === "unavailable") {
    return {
      phase: "unavailable",
      title: "Update status is unknown.",
      detail: "The device could not be read. The firmware was not sent again.",
      percent: null,
      indeterminate: false,
      checkable: true,
    };
  }
  if (job.status === "failed") {
    return { phase: "failed", title: "The firmware update could not be completed.", detail: job.message, percent: null, indeterminate: false, checkable: false };
  }
  if ((job.status === "interrupted" || job.verification?.state === "needs_verification") && transferred) {
    return {
      phase: "needs_verification",
      title: "Update status needs checking.",
      detail: "The firmware download completed, but IoT.Edu restarted before confirming installation.",
      percent: null,
      indeterminate: false,
      checkable: true,
    };
  }
  if (job.status === "running" && applying) {
    return { phase: "reconnecting", title: "Waiting for your device to reconnect.", detail: "Keep it powered on.", percent: null, indeterminate: true, checkable: false };
  }
  if (job.status === "running" && transferred) {
    return { phase: "installing", title: "Your device is installing the firmware.", detail: "Keep it powered on.", percent: null, indeterminate: true, checkable: false };
  }
  if (job.status === "running" && started) {
    return { phase: "downloading", title: "Sending firmware to your device.", detail: "Keep the board powered on.", percent: percentFrom(job), indeterminate: false, checkable: false };
  }
  if (job.status === "running") {
    return { phase: "preparing", title: "Preparing your firmware update.", detail: version, percent: null, indeterminate: true, checkable: false };
  }
  return { phase: "idle", title: "No update is in progress.", detail: "", percent: null, indeterminate: false, checkable: false };
}

export function otaHistoryEntry(job: OtaJobView): { status: string; detail: string } {
  const progress = otaProgress(job);
  if (progress.phase === "completed") return { status: "Completed", detail: "Firmware successfully updated." };
  if (progress.phase === "needs_verification") return { status: "Needs verification", detail: "Download completed; installation confirmation was interrupted." };
  if (progress.phase === "not_installed") return { status: "Not installed", detail: "The device is still running the previous firmware." };
  if (progress.phase === "unavailable") return { status: "Unknown", detail: "The device could not be read after the download." };
  if (progress.phase === "failed") return { status: "Failed", detail: "The firmware update could not be completed." };
  if (job.status === "blocked") return { status: "Blocked", detail: "The update was not started." };
  if (job.status === "running") return { status: "In progress", detail: progress.title };
  return { status: "Interrupted", detail: "The update stopped before completion." };
}

function percentFrom(job: OtaJobView): number | null {
  const stage = job.stages.find((item) => item.id === "transfer_started");
  const match = stage?.detail.match(/(\d+) of (\d+) bytes/);
  if (!match) return null;
  const total = Number(match[2]);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((Number(match[1]) / total) * 100)));
}
