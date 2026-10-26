import type { EraseAssessment } from "@iotedu/contracts";

export type CheckStatus = "Verified" | "Not Verified" | "Blocked";

export interface RecoveryCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

function fuse(value: string | undefined, safe: string, missing: string): { status: CheckStatus; detail: string } {
  if (!value || value === "unknown") return { status: "Not Verified", detail: missing };
  if (value === safe) return { status: "Verified", detail: value };
  return { status: "Blocked", detail: value };
}

export function recoveryChecks(assessment: EraseAssessment | null): RecoveryCheck[] {
  const device = assessment?.device ?? null;
  const security = assessment?.security ?? null;
  const backup = assessment?.backup ?? null;
  const identified = Boolean(device?.connected && device.chip === "ESP32-H2" && device.mac && device.revision && device.revision !== "unknown" && device.flashSizeBytes);
  const secureBoot = fuse(security?.secureBoot, "disabled", "Secure Boot has not been read.");
  const encryption = fuse(security?.flashEncryption, "disabled", "Flash encryption has not been read.");
  const download = fuse(security?.downloadMode, "allowed", "Download mode has not been read.");
  const usb = fuse(security?.usbDownload, "allowed", "USB download permission has not been read.");
  const backupStatus: CheckStatus = !backup ? "Not Verified" : backup.verified && backup.complete ? "Verified" : "Blocked";
  const offsetBlocker = assessment?.blockers.find((item) => (
    item.code === "bootloader_incompatible"
    || item.code === "application_incompatible"
    || item.code === "flash_size_mismatch"
    || item.code === "partition_exceeds_flash"
    || item.code === "firmware_plan"
  ));
  const factoryPreserved = assessment?.firmware.credentialMode === "example_dac" && backup?.verified === true && backup.complete;
  const factoryStatus: CheckStatus = assessment?.firmware.credentialMode === "secure_cert"
    ? "Blocked"
    : factoryPreserved
      ? "Verified"
      : "Not Verified";
  return [
    {
      id: "identity",
      label: "Connected hardware identity",
      status: identified ? "Verified" : "Not Verified",
      detail: identified && device ? `${device.chip} ${device.revision}, MAC ${device.mac}, ${device.flashSizeBytes} bytes` : "Identify the connected ESP32-H2 before erase preparation reads it again.",
    },
    { id: "secure-boot", label: "Secure Boot", status: secureBoot.status, detail: secureBoot.detail },
    { id: "encryption", label: "Flash encryption", status: encryption.status, detail: encryption.detail },
    { id: "download", label: "Download mode", status: download.status, detail: download.detail },
    { id: "usb", label: "USB download permission", status: usb.status, detail: usb.detail },
    {
      id: "backup",
      label: "Flash backup",
      status: backupStatus,
      detail: backup ? `Stored ${backup.createdAt} at ${backup.location}.` : "Backup before erase is created automatically when this chip can be reflashed.",
    },
    {
      id: "integrity",
      label: "Backup integrity",
      status: backupStatus,
      detail: backup?.verified ? "The saved flash image matches its SHA-256 hashes." : "A successful read is not treated as a verified backup until the saved files match.",
    },
    {
      id: "package",
      label: "Firmware package",
      status: assessment?.firmware.ready ? "Verified" : "Not Verified",
      detail: assessment?.firmware.detail ?? "Check Recovery Readiness has not been run.",
    },
    {
      id: "offsets",
      label: "Flash-offset compatibility",
      status: !assessment ? "Not Verified" : offsetBlocker ? "Blocked" : assessment.firmware.ready ? "Verified" : "Not Verified",
      detail: offsetBlocker ? `${offsetBlocker.message} ${offsetBlocker.action}` : "The package offsets are checked against the connected flash.",
    },
    {
      id: "toolchain",
      label: "ESP-IDF programming tools",
      status: !assessment ? "Not Verified" : assessment.toolchain.available ? "Verified" : "Blocked",
      detail: assessment?.toolchain.detail ?? "Check Recovery Readiness has not been run.",
    },
    {
      id: "port",
      label: "USB programming interface",
      status: device?.connected ? "Verified" : "Not Verified",
      detail: device?.programmingPort || "Select the programming interface. A busy console port does not block this check.",
    },
    {
      id: "factory",
      label: "Factory data preservation",
      status: factoryStatus,
      detail: factoryStatus === "Verified"
        ? "Factory and provisioning data are inside the verified backup. First-time installation writes the four application images."
        : factoryStatus === "Blocked"
          ? "This package requires a secure-cert partition that first-time installation does not restore."
          : assessment?.firmware.credentialMode === "example_dac"
            ? "Backup support is available. Factory data stays Not Verified until that backup is complete and its integrity is verified."
            : "The package credential mode has not been confirmed.",
    },
    {
      id: "reinstall",
      label: "Firmware can be installed after erase",
      status: assessment?.enabled ? "Verified" : "Not Verified",
      detail: assessment?.enabled
        ? "Erase can be offered. Firmware installation stays a separate confirmation."
        : assessment?.blockers[0]
          ? `${assessment.blockers[0].message} ${assessment.blockers[0].action}`
          : "Erase preparation has not finished.",
    },
  ];
}

export function backupPhase(
  backup: { verified: boolean; complete: boolean } | null,
  busy: string | null,
): "Backup capability available" | "Backup in progress" | "Backup completed" | "Backup integrity verified" | "Backup integrity check in progress" {
  if (busy === "backup") return "Backup in progress";
  if (busy === "verify") return "Backup integrity check in progress";
  if (backup?.verified && backup.complete) return "Backup integrity verified";
  if (backup) return "Backup completed";
  return "Backup capability available";
}
