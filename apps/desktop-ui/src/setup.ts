export const SETUP_STATES = [
  "not_started",
  "ready",
  "in_progress",
  "completed",
  "failed",
  "requires_attention",
  "not_verified",
  "not_applicable",
] as const;

export type SetupState = (typeof SETUP_STATES)[number];

export type DeviceIdentityStatus = "verified" | "historical" | "unknown";
export type DeviceProbeSource = "chip_id" | "boot_log" | null;

export interface SetupRecord {
  selectedBuildId: string | null;
  programmingPort: string | null;
  consolePort: string | null;
  hardware: SetupState;
  smartHome: SetupState;
  management: SetupState;
  appleHomeConfirmedAt: string | null;
  lastHardwareEvidenceAt: string | null;
  hardwareEvidence: string | null;
  programSessionId: string | null;
  deviceMac: string | null;
  deviceModel: string | null;
  deviceRevision: string | null;
  deviceFlash: string | null;
  deviceProbeAt: string | null;
  deviceProbeSource: DeviceProbeSource;
  deviceIdentity: DeviceIdentityStatus;
  deviceSessionId: string | null;
}

export interface LiveNodeSummary {
  simulated: boolean;
  reachable: boolean | null;
  matterNodeId: string | null;
  hardwareMac?: string | null;
  presence?: "online" | "unreachable" | "checking" | "unknown" | "stale";
}

export function presenceLabel(node: { simulated?: boolean; presence?: string | null; matterNodeId?: string | null }): string {
  if (node.simulated) return "Simulated";
  if (node.presence === "online") return "Online";
  if (node.presence === "unreachable") return "Unreachable";
  if (node.presence === "checking") return "Checking";
  if (node.presence === "stale") return "Stale";
  if (!node.matterNodeId) return "Registered";
  return "Unknown";
}

export const EMPTY_SETUP: SetupRecord = {
  selectedBuildId: null,
  programmingPort: null,
  consolePort: null,
  hardware: "not_started",
  smartHome: "not_started",
  management: "not_started",
  appleHomeConfirmedAt: null,
  lastHardwareEvidenceAt: null,
  hardwareEvidence: null,
  programSessionId: null,
  deviceMac: null,
  deviceModel: null,
  deviceRevision: null,
  deviceFlash: null,
  deviceProbeAt: null,
  deviceProbeSource: null,
  deviceIdentity: "unknown",
  deviceSessionId: null,
};

const STORAGE_KEY = "iotedu.setup.v1";

export function stateLabel(state: SetupState): string {
  switch (state) {
    case "not_started": return "Not Started";
    case "ready": return "Ready";
    case "in_progress": return "In Progress";
    case "completed": return "Completed";
    case "failed": return "Failed";
    case "requires_attention": return "Requires Attention";
    case "not_verified": return "Not Verified";
    case "not_applicable": return "Not Applicable";
  }
}

export function reopenSetup(record: SetupRecord): SetupRecord {
  return {
    ...record,
    hardware: record.hardware === "completed" || record.hardware === "in_progress" ? "not_verified" : record.hardware,
    deviceIdentity: record.deviceIdentity === "verified" ? "historical" : record.deviceIdentity,
    smartHome: record.appleHomeConfirmedAt ? "not_verified" : record.smartHome === "completed" ? "not_verified" : record.smartHome,
    management: "not_verified",
  };
}

export function sameHardwareMac(left: string | null | undefined, right: string | null | undefined): boolean {
  const first = normaliseMac(left);
  const second = normaliseMac(right);
  return first !== null && first === second;
}

function normaliseMac(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  return hex.length === 12 ? hex : null;
}

export function belongsToSetupDevice(record: SetupRecord, node: LiveNodeSummary): boolean {
  if (node.simulated || !node.matterNodeId) return false;
  const selected = normaliseMac(record.deviceMac);
  if (!selected) return true;
  const reported = normaliseMac(node.hardwareMac);
  return reported === selected;
}

export function reconcileSetup(record: SetupRecord, nodes: LiveNodeSummary[]): SetupRecord {
  const live = nodes.filter((node) => belongsToSetupDevice(record, node));
  const online = live.some((node) => node.presence === "online");
  const unreachable = live.some((node) => node.presence === "unreachable");
  const management: SetupState = online
    ? "completed"
    : unreachable
      ? "requires_attention"
      : live.length > 0
        ? "not_verified"
        : "not_started";
  let smartHome = record.smartHome;
  if (online && record.appleHomeConfirmedAt) smartHome = "completed";
  else if (unreachable) smartHome = "requires_attention";
  else if (record.appleHomeConfirmedAt) smartHome = "not_verified";
  else if (live.length > 0) smartHome = "ready";
  return { ...record, management, smartHome };
}

export function loadSetup(storage: Pick<Storage, "getItem"> | null): SetupRecord {
  if (!storage) return { ...EMPTY_SETUP };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_SETUP };
    const parsed = JSON.parse(raw) as Partial<SetupRecord>;
    return reopenSetup({ ...EMPTY_SETUP, ...parsed });
  } catch {
    return { ...EMPTY_SETUP };
  }
}

export function saveSetup(storage: Pick<Storage, "setItem"> | null, record: SetupRecord): void {
  storage?.setItem(STORAGE_KEY, JSON.stringify(record));
}
