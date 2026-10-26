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
  serialNumber: string | null;
  commissionedFabricCount: number | null;
  firmwareUpdateEligible: boolean | null;
  connection: "commissioned" | "reachable" | "offline" | "unknown";
  lastCommunicationAt: string | null;
}

export interface SharingWindow {
  manualPairingCode: string;
  qrPairingCode: string;
}

export interface StoredPeer {
  matterNodeId: string;
  commissionedAt: number | null;
}

/**
 * The operational Matter session. Tests supply a fake. The live process uses Matter.js.
 * `create` is true only for an explicit first identity. A later open must reuse storage.
 */
export interface ManagementTransport {
  ensureStarted(options: { create: boolean }): Promise<ControllerRuntimeInfo>;
  commissionOnExistingNetwork(
    pairingCode: string,
    onProgress?: (event: import("@iotedu/contracts").CommissionProgress) => void,
  ): Promise<ObservedNode>;
  listCommissionedPeers(): Promise<StoredPeer[]>;
  /**
   * Remove only this controller's fabric from the peer, then drop the local peer after the device confirms it.
   * This is not ClientNode.delete(), which forgets the peer locally without RemoveFabric.
   */
  decommissionPeer(matterNodeId: string): Promise<{ removedOnDevice: boolean; detail: string }>;
  /** Drop the local peer only. Does not send RemoveFabric. */
  forgetPeer(matterNodeId: string): Promise<void>;
  refresh(matterNodeId: string): Promise<ObservedNode>;
  reconnect(): Promise<ObservedNode[]>;
  openSharingWindow(matterNodeId: string): Promise<SharingWindow>;
  close(): Promise<void>;
  otaProviderStatus(): Promise<import("@iotedu/contracts").OtaProviderStatus>;
  readOtaRequestor?(matterNodeId: string): Promise<import("@iotedu/contracts").OtaRequestorReport>;
  readApplicationModel?(matterNodeId: string): Promise<Array<{ endpointId: number; deviceTypes: number[]; serverClusters: number[] }> | null>;
  beginOta(input: { matterNodeId: string; image: Uint8Array; vendorId: number; productId: number; softwareVersion: number }): Promise<void>;
  subscribeOta(listener: (event: import("@iotedu/contracts").OtaProviderEvent) => void): () => void;
  listStoredImages(): Promise<Array<{ vendorId: number; productId: number; softwareVersion: number; mode: string }>>;
  storeLocalImage(image: Uint8Array, softwareVersion: number): Promise<void>;
  exerciseBdxArm(): Promise<{ armed: boolean; cleared: boolean }>;
}
