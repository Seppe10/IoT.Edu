import { sameHardwareMac } from "../setup";

export type StepState = "pending" | "active" | "done" | "failed";

export const APPLE_HOME_STEPS = [
  { id: "code", label: "Waiting for the Apple Home pairing code" },
  { id: "discover", label: "Discovering the commissioned device" },
  { id: "session", label: "Establishing the pairing session" },
  { id: "fabric", label: "Adding the IoT.Edu fabric" },
  { id: "case", label: "Establishing the operational CASE session" },
  { id: "version", label: "Verifying the firmware version" },
  { id: "ready", label: "Confirming device management readiness" },
] as const;

export type AppleHomeStepId = (typeof APPLE_HOME_STEPS)[number]["id"];
export type CommissionStage = "validating_code" | "discovering" | "operational_case" | "verifying_firmware" | "ready" | "failed";

export const EXISTING_FABRIC_STEPS = [
  { id: "locate_peer", label: "Find the stored IoT.Edu device" },
  { id: "discover_operational", label: "Look for the device on the network" },
  { id: "case_session", label: "Reconnect to the device" },
  { id: "read_basic_information", label: "Read the device identity" },
  { id: "verify_identity", label: "Check the firmware" },
  { id: "management_ready", label: "Confirm the device can be managed" },
  { id: "register_node", label: "Save the management record" },
] as const;

export const PRIMARY_SETUP_ACTION = "Continue Device Setup";

export type ExistingFabricStepId = (typeof EXISTING_FABRIC_STEPS)[number]["id"];

export interface ExistingFabricFailure {
  stage: ExistingFabricStepId;
  completed: ExistingFabricStepId[];
}

const PENDING: Record<AppleHomeStepId, StepState> = {
  code: "pending",
  discover: "pending",
  session: "pending",
  fabric: "pending",
  case: "pending",
  version: "pending",
  ready: "pending",
};

export function appleHomeStepStates(input: {
  submitted: boolean;
  stage: CommissionStage | null;
  verified: boolean;
  simulated: boolean;
  failed: boolean;
  failureCode: string | null;
}): Record<AppleHomeStepId, StepState> {
  if (!input.submitted) return { ...PENDING, code: "active" };
  if (input.simulated) return { ...PENDING, code: "done" };
  if (input.verified) {
    return {
      code: "done",
      discover: "done",
      session: "done",
      fabric: "done",
      case: "done",
      version: "done",
      ready: "done",
    };
  }
  if (input.failed) return failedStates(input.stage, input.failureCode);
  if (input.stage === "operational_case") {
    return {
      code: "done",
      discover: "done",
      session: "done",
      fabric: "done",
      case: "active",
      version: "pending",
      ready: "pending",
    };
  }
  if (input.stage === "verifying_firmware" || input.stage === "ready") {
    return {
      code: "done",
      discover: "done",
      session: "done",
      fabric: "done",
      case: "active",
      version: "active",
      ready: "pending",
    };
  }
  if (input.stage === "discovering") {
    return {
      code: "done",
      discover: "active",
      session: "active",
      fabric: "active",
      case: "pending",
      version: "pending",
      ready: "pending",
    };
  }
  return { ...PENDING, code: "done", discover: "active" };
}

function failedStates(stage: CommissionStage | null, code: string | null): Record<AppleHomeStepId, StepState> {
  if (code === "invalid_input") return { ...PENDING, code: "failed" };
  if (code === "discovery_failed") return { ...PENDING, code: "done", discover: "failed" };
  if (code === "commissioning_window_expired") {
    return { ...PENDING, code: "done", discover: "done", session: "failed" };
  }
  if (code === "connection_failed") {
    return {
      code: "done",
      discover: "done",
      session: "done",
      fabric: "done",
      case: "failed",
      version: "pending",
      ready: "pending",
    };
  }
  if (code === "identity_read_failed" || code === "identity_mismatch" || code === "identity_unproven" || code === "peer_mismatch" || stage === "verifying_firmware") {
    return {
      code: "done",
      discover: "done",
      session: "done",
      fabric: "done",
      case: "done",
      version: "failed",
      ready: "pending",
    };
  }
  if (code === "fabric_limit") {
    return { ...PENDING, code: "done", discover: "done", session: "done", fabric: "failed" };
  }
  return { ...PENDING, code: "done", discover: "failed" };
}

export function recoveryFor(code: string | null, operation: "recover" | "commission" = "commission"): string {
  if (operation === "recover" && (code === "connection_failed" || code === "discovery_failed")) {
    return "Could not reconnect to the stored Matter device. The device may be offline, unreachable through the Thread network, or associated with a different physical board. Retry the stored connection, or pair this board with a new Apple Home code only after confirming that the stored peer should be kept. The Apple Home fabric was not removed.";
  }
  switch (code) {
    case "commissioning_window_expired":
      return "In the Home app, turn pairing mode on again and paste the new code. Do not reuse the original factory code, and do not factory-reset the accessory.";
    case "discovery_failed":
      return "The device was not discovered for the new Apple Home code. Confirm this Mac is on the same Wi-Fi as the HomePod, then turn pairing mode on again. The Apple Home fabric and Thread dataset were not changed.";
    case "connection_failed":
      return "The new pairing session did not finish. Turn pairing mode on again if the window closed, then paste the new code. Do not reuse the original factory code. IoT.Edu did not remove the Apple Home fabric.";
    case "identity_read_failed":
      return "The IoT.Edu fabric was not removed. Try verification again. Do not generate another pairing code, and do not factory-reset the accessory.";
    case "identity_mismatch":
      return "The live Basic Information values do not match the selected firmware. The node was not registered and the Apple Home fabric was not removed.";
    case "identity_unproven":
      return "Basic Information did not identify the physical board. Registration did not link it to the selected hardware MAC.";
    case "peer_mismatch":
      return "This Matter peer belongs to a different board. It stays stored for that board, so a new Apple Home pairing code can be used for the selected ESP32-H2. Do not remove the Apple Home fabric.";
    case "peer_selection_required":
      return "Choose the Matter node to verify. A stored peer is not assumed to be the selected ESP32-H2.";
    case "existing_fabric":
      return "An unverified Matter peer is still stored. Continue with a new Apple Home code only after confirming that it is for a different device. The stored peer is not deleted.";
    case "fabric_limit":
      return "Ask an Apple Home administrator to remove a different fabric. IoT.Edu will not remove the Apple Home fabric.";
    case "invalid_input":
      return "Paste the new manual pairing code or QR payload from Apple Home. The original first-time code is not reused.";
    default:
      return "Read the error above. The accessory was not factory reset.";
  }
}

export function managedRecordMessage(
  node: { matterNodeId: string | null; softwareVersion: number | null; hardwareMac?: string | null },
  selectedMac: string | null,
): string {
  const version = node.softwareVersion != null ? ` with SoftwareVersion ${node.softwareVersion}` : "";
  if (node.hardwareMac && selectedMac && !sameHardwareMac(node.hardwareMac, selectedMac)) {
    return `Matter node ${node.matterNodeId} is stored for hardware MAC ${node.hardwareMac}${version}. It is not the selected board ${selectedMac}. A new Apple Home pairing code can add the selected board. This record and the Apple Home fabric stay in place.`;
  }
  if (!node.hardwareMac) {
    return `Matter node ${node.matterNodeId} is stored${version}, but it is not linked to a hardware MAC. Verify it before requesting another Apple Home pairing code. The record was not deleted and the Apple Home fabric was not removed.`;
  }
  return `Matter node ${node.matterNodeId} is already stored${version}. A new Apple Home pairing code is not required while this operational record remains valid. A stale unsaved peer, if one remains, is not deleted and is not removed from the device.`;
}

const EXISTING_IDS = EXISTING_FABRIC_STEPS.map((step) => step.id);

export function existingFabricStepStates(input: {
  started: boolean;
  verified: boolean;
  active: ExistingFabricStepId | null;
  completed: readonly ExistingFabricStepId[];
  failed: ExistingFabricStepId | null;
}): Record<ExistingFabricStepId, StepState> {
  const states = Object.fromEntries(EXISTING_IDS.map((id) => [id, "pending"])) as Record<ExistingFabricStepId, StepState>;
  if (input.verified) {
    for (const id of EXISTING_IDS) states[id] = "done";
    return states;
  }
  if (!input.started) return states;
  for (const id of input.completed) states[id] = "done";
  if (input.failed) {
    states[input.failed] = "failed";
    return states;
  }
  if (input.active && states[input.active] !== "done") states[input.active] = "active";
  else if (!input.active) states.locate_peer = "active";
  return states;
}

export function existingFailure(detail: unknown): ExistingFabricFailure | null {
  if (!detail || typeof detail !== "object") return null;
  const record = detail as { stage?: unknown; completed?: unknown };
  if (!isExistingStage(record.stage)) return null;
  const completed = Array.isArray(record.completed) ? record.completed.filter(isExistingStage) : [];
  return { stage: record.stage, completed };
}

export function isExistingStage(value: unknown): value is ExistingFabricStepId {
  return typeof value === "string" && EXISTING_IDS.some((id) => id === value);
}

export interface SetupPeerRef { matterNodeId: string }
export interface SetupNodeRef { matterNodeId: string | null; hardwareMac?: string | null; simulated?: boolean }

export interface DeviceSetupPlan {
  operation: "recover" | "commission";
  ambiguous: boolean;
  managementStatus: string;
  peerStatus: string;
}

export function planDeviceSetup(input: { selectedMac: string | null; nodes: SetupNodeRef[]; peers: SetupPeerRef[] }): DeviceSetupPlan {
  const liveNodes = input.nodes.filter((node) => !node.simulated && node.matterNodeId);
  const matching = input.selectedMac
    ? liveNodes.find((node) => sameHardwareMac(node.hardwareMac, input.selectedMac))
    : undefined;
  const other = liveNodes.find((node) => node.hardwareMac && input.selectedMac && !sameHardwareMac(node.hardwareMac, input.selectedMac));
  const unsaved = input.peers.filter((peer) => !liveNodes.some((node) => node.matterNodeId === peer.matterNodeId));
  if (matching) {
    return {
      operation: "recover",
      ambiguous: false,
      managementStatus: `Matter node ${matching.matterNodeId} is registered for this board.`,
      peerStatus: "The stored record matches the selected hardware MAC.",
    };
  }
  if (unsaved.length > 0) {
    return {
      operation: "recover",
      ambiguous: true,
      managementStatus: "Not registered. The stored peer is not linked to this board.",
      peerStatus: `Matter node ${unsaved[0]?.matterNodeId ?? ""} is stored, but its physical board is not known. A failed connection does not show that it belongs to a different board.`,
    };
  }
  if (other) {
    return {
      operation: "commission",
      ambiguous: false,
      managementStatus: "This board is not registered.",
      peerStatus: `A stored record belongs to ${other.hardwareMac}. It does not block this board.`,
    };
  }
  return {
    operation: "commission",
    ambiguous: false,
    managementStatus: "Not registered.",
    peerStatus: "This controller has no stored Matter peer.",
  };
}

export function pairingCodeVisible(operation: "recover" | "commission"): boolean {
  return operation === "commission";
}

export function initialDeviceSetupState(): { started: false; operation: null } {
  return { started: false, operation: null };
}
