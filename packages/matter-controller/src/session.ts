export interface ControllerRuntimeInfo {
  fabricId: string | null;
  credentialId: string | null;
  controllerNodeId: string | null;
  matterJsVersion: string;
}

export interface ObservedNode {
  matterNodeId: string;
  vendorId: number | null;
  productId: number | null;
  hardwareVersion: number | null;
  hardwareVersionString: string | null;
  softwareVersion: number | null;
  softwareVersionString: string | null;
  commissionedFabricCount: number | null;
  firmwareUpdateEligible: boolean | null;
  connection: "commissioned" | "reachable" | "offline" | "unknown";
  lastCommunicationAt: string | null;
}

export interface SharingWindow {
  manualPairingCode: string;
  qrPairingCode: string;
}

/**
 * The operational Matter session. Tests supply a fake. The live process uses Matter.js.
 * `create` is true only for an explicit first identity. A later open must reuse storage.
 */
export interface ManagementTransport {
  ensureStarted(options: { create: boolean }): Promise<ControllerRuntimeInfo>;
  commissionOnExistingNetwork(pairingCode: string): Promise<ObservedNode>;
  refresh(matterNodeId: string): Promise<ObservedNode>;
  reconnect(): Promise<ObservedNode[]>;
  openSharingWindow(matterNodeId: string): Promise<SharingWindow>;
  close(): Promise<void>;
}
