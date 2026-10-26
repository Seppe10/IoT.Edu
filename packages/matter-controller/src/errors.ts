export type MatterErrorCode =
  | "invalid_input"
  | "identity_missing"
  | "identity_corrupt"
  | "regeneration_refused"
  | "discovery_failed"
  | "commissioning_window_expired"
  | "connection_failed"
  | "identity_read_failed"
  | "identity_mismatch"
  | "identity_unproven"
  | "peer_mismatch"
  | "peer_selection_required"
  | "existing_fabric"
  | "fabric_limit"
  | "ble_unsupported"
  | "thread_dataset_missing"
  | "new_device_unavailable";

export type IdentityStage =
  | "locate_peer"
  | "discover_operational"
  | "case_session"
  | "read_basic_information"
  | "verify_identity"
  | "management_ready"
  | "register_node";

export interface IdentityDiagnostic {
  stage: IdentityStage;
  completed: IdentityStage[];
  matterNodeId: string | null;
  endpointId: number | null;
  clusterId: number | null;
  attributeId: number | null;
  errorClass: string;
  status: number | null;
  elapsedMs: number | null;
  attempts: number;
}

export class MatterOperationError extends Error {
  constructor(
    readonly code: MatterErrorCode,
    message: string,
    readonly statusCode = 400,
    readonly detail: IdentityDiagnostic | null = null,
  ) {
    super(message);
    this.name = "MatterOperationError";
  }
}

export const FABRIC_LIMIT = 5;

export const BACKUP_INSTRUCTIONS =
  "Stop IoT.Edu before copying or restoring the matter-controller directory inside the data directory. Keep that copy outside the Git repository, preferably in encrypted storage. Restore it only while the application is stopped. If those files cannot be loaded, IoT.Edu will not generate a replacement identity. An existing smart-home administrator can open a new Matter commissioning window so this controller can be added again. A failed commissioning attempt does not factory reset the node.";
