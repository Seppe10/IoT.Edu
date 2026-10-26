import { commissioningFromLog, identifyHardwareMac, type CommissioningObservation, type MacSource } from "./hardware-installation.js";

export const FACTORY_RESET_WATCH_SECONDS = 45;
export const FACTORY_RESET_WATCH_MIN_SECONDS = 30;
export const FACTORY_RESET_WATCH_MAX_SECONDS = 60;
export const GPIO9_LONG_PRESS_MS = 5000;

export type FactoryResetStage =
  | "not_observed"
  | "hold_detected"
  | "reset_started"
  | "reboot_pending"
  | "post_reset_boot"
  | "verified_fabric_free"
  | "fabric_still_present"
  | "reboot_without_reset";

export interface FactoryResetAssessment {
  stage: FactoryResetStage;
  resetHold: boolean;
  resetStarted: boolean;
  performingReset: boolean;
  restartAnnounced: boolean;
  postResetBoot: boolean;
  fabricRetrieved: boolean;
  fabricVendors: string[];
  commissioningMode: number | null;
  bleAdvertising: boolean;
  matterListening: boolean;
  dnsSdWarning: string | null;
  mac: string | null;
  macSource: MacSource;
  identityConflict: boolean;
  affectsStoredCredentials: boolean;
  conclusive: boolean;
  headline: string;
  detail: string;
}

const HOLD = /Factory reset triggered/i;
const START = /Starting factory reset|Performing factory reset|Factory reset requested/i;
const PERFORMING = /Performing factory reset/i;
const RESTART = /System restarting/i;
const BOOT = /(?:^|\n)(?:rst:0x[0-9a-f]+|ESP-ROM:)/g;

function lastMatch(log: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const found = [...log.matchAll(new RegExp(pattern.source, flags))];
  return found.at(-1)?.index ?? -1;
}

function compactMac(value: string | null | undefined): string {
  return (value ?? "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

export function factoryResetConsoleRecovery(input: { watchedPort: string; portsNow: string[] }): { disconnected: boolean; followedNewPort: false } {
  return {
    disconnected: !input.portsNow.includes(input.watchedPort),
    followedNewPort: false,
  };
}

export function assessFactoryResetCapture(log: string, selectedMac: string | null = null): FactoryResetAssessment {
  const holdAt = lastMatch(log, HOLD);
  const startAt = lastMatch(log, START);
  const performing = PERFORMING.test(log);
  const restartAt = lastMatch(log, RESTART);
  const resetHold = holdAt >= 0;
  const resetStarted = startAt >= 0;
  const restartAnnounced = restartAt >= startAt && restartAt >= 0 && resetStarted;
  const bootAt = [...log.matchAll(BOOT)].map((match) => match.index ?? -1).filter((index) => resetStarted && index > startAt).at(-1) ?? -1;
  const postResetText = bootAt >= 0 ? log.slice(bootAt) : "";
  const postResetBoot = postResetText.length > 0;
  const commissioning = commissioningFromLog(postResetText || (resetStarted ? "" : log));
  const wholeIdentity = identifyHardwareMac(log);
  const postIdentity = postResetBoot ? identifyHardwareMac(postResetText) : null;
  const identity = postIdentity?.mac ? postIdentity : wholeIdentity;
  const selected = compactMac(selectedMac);
  const observed = compactMac(identity.mac);
  const identityConflict = wholeIdentity.conflict || Boolean(postIdentity?.conflict) || Boolean(selected && observed && selected !== observed);
  const mac = identityConflict ? null : identity.mac;
  const fabricRetrieved = postResetBoot && commissioning.state === "commissioned";
  const mode = [...(postResetText.matchAll(/commissioning mode (\d+)/gi))].at(-1);
  const base = {
    resetHold,
    resetStarted,
    performingReset: performing,
    restartAnnounced,
    postResetBoot,
    fabricRetrieved,
    fabricVendors: postResetBoot ? commissioning.fabricVendors : [],
    commissioningMode: mode?.[1] != null ? Number(mode[1]) : null,
    bleAdvertising: postResetBoot && commissioning.bleAdvertisingObserved,
    matterListening: /Server Listening|CHIP task running/i.test(postResetText),
    dnsSdWarning: postResetBoot ? commissioning.dnsSdWarning : null,
    mac,
    macSource: identityConflict ? "unverified" as const : identity.source,
    identityConflict,
    affectsStoredCredentials: resetStarted,
    conclusive: false,
    headline: "Current commissioning state unknown",
    detail: "Commissioning state was not observed.",
  };

  if (!resetHold && !resetStarted) {
    if ([...log.matchAll(BOOT)].length > 0) {
      return { ...base, stage: "reboot_without_reset", headline: "Reboot without reset", detail: "The console showed a restart and no Matter factory-reset event. A reboot does not clear fabrics." };
    }
    return { ...base, stage: "not_observed", headline: "Reset requested but not observed", detail: "The watch ended without a Matter factory-reset log. Holding the button is not evidence that the reset ran." };
  }
  if (!resetStarted) {
    return { ...base, stage: "hold_detected", headline: "Reset requested but not observed", detail: "The long-press was recognised. The release that starts the factory reset was not observed." };
  }
  if (!postResetBoot && restartAnnounced) {
    return { ...base, stage: "reboot_pending", headline: "Reboot pending", detail: "Factory reset restarted the board. The following boot was not captured." };
  }
  if (!postResetBoot) {
    return { ...base, stage: "reset_started", headline: "Factory-reset event observed", detail: "Factory-reset event observed. The following boot was not captured." };
  }
  if (fabricRetrieved) {
    const vendors = commissioning.fabricVendors.map((vendor) => `0x${vendor}`).join(", ");
    return {
      ...base,
      stage: "fabric_still_present",
      conclusive: true,
      headline: "Commissioned again after reset",
      detail: `The boot after factory reset retrieved a stored fabric${vendors ? ` (vendor ${vendors})` : ""}.`,
    };
  }
  if (base.matterListening && commissioning.state === "uncommissioned") {
    return {
      ...base,
      stage: "verified_fabric_free",
      conclusive: true,
      headline: "Factory-new and ready for commissioning",
      detail: "The boot after factory reset retrieved no stored fabric. Matter started without a stored fabric.",
    };
  }
  return {
    ...base,
    stage: "post_reset_boot",
    headline: "Post-reset boot being verified",
    detail: "The boot after factory reset is incomplete, so commissioning state is Unknown. No stored fabric was read in the captured boot, and the commissioning window was not established.",
  };
}

export function commissioningOverlayFromReset(assessment: FactoryResetAssessment): CommissioningObservation | null {
  if (assessment.identityConflict || !assessment.mac) return null;
  if (assessment.stage === "not_observed" || assessment.stage === "reboot_without_reset") return null;
  if (assessment.stage === "verified_fabric_free") {
    return {
      state: "uncommissioned",
      windowOpen: null,
      windowNow: assessment.commissioningMode != null && assessment.commissioningMode > 0 ? "unknown" : "unknown",
      lastWindowEvent: assessment.bleAdvertising ? "ble_advertising_started" : null,
      bleAdvertisingObserved: assessment.bleAdvertising,
      dnsSdWarning: assessment.dnsSdWarning,
      appleHomeFabric: false,
      fabricVendors: [],
      detail: assessment.detail,
    };
  }
  if (assessment.stage === "fabric_still_present") {
    return {
      state: "commissioned",
      windowOpen: false,
      windowNow: "closed",
      lastWindowEvent: null,
      bleAdvertisingObserved: false,
      dnsSdWarning: assessment.dnsSdWarning,
      appleHomeFabric: assessment.fabricVendors.includes("1349"),
      fabricVendors: assessment.fabricVendors,
      detail: assessment.detail,
    };
  }
  return {
    state: "unknown",
    windowOpen: null,
    windowNow: "unknown",
    lastWindowEvent: null,
    bleAdvertisingObserved: assessment.bleAdvertising,
    dnsSdWarning: null,
    appleHomeFabric: false,
    fabricVendors: [],
    detail: assessment.detail,
  };
}

export function managedNodeAfterResetDecision(input: {
  nodes: Array<{ id: string; hardwareMac?: string | null; matterNodeId?: string | null; operationalReverification?: "required" | null }>;
  reportedMac: string | null;
  matterNodeId: string;
}): { action: "create" | "update" | "relink" | "reject"; nodeId: string | null } {
  const reported = compactMac(input.reportedMac);
  const sameNode = input.nodes.find((node) => node.matterNodeId === input.matterNodeId);
  const sameBoard = reported
    ? input.nodes.find((node) => node.id !== sameNode?.id && compactMac(node.hardwareMac) === reported)
    : undefined;
  if (sameBoard?.operationalReverification === "required") return { action: "relink", nodeId: sameBoard.id };
  if (sameBoard) return { action: "reject", nodeId: sameBoard.id };
  if (sameNode) return { action: "update", nodeId: sameNode.id };
  return { action: "create", nodeId: null };
}
