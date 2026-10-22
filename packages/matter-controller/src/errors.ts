export type MatterErrorCode =
  | "invalid_input"
  | "identity_missing"
  | "identity_corrupt"
  | "regeneration_refused"
  | "discovery_failed"
  | "connection_failed"
  | "fabric_limit"
  | "ble_unsupported"
  | "thread_dataset_missing"
  | "new_device_unavailable";

export class MatterOperationError extends Error {
  constructor(
    readonly code: MatterErrorCode,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "MatterOperationError";
  }
}

export const FABRIC_LIMIT = 5;

export const BACKUP_INSTRUCTIONS =
  "Stop IoT.Edu before copying or restoring the matter-controller directory inside the data directory. Keep that copy outside the Git repository, preferably in encrypted storage. Restore it only while the application is stopped. If those files cannot be loaded, IoT.Edu will not generate a replacement identity. An existing smart-home administrator can open a new Matter commissioning window so this controller can be added again. A failed commissioning attempt does not factory reset the node.";
