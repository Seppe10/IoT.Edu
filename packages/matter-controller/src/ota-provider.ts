import { Readable } from "node:stream";
import type { OtaProviderEvent, OtaProviderStatus } from "@iotedu/contracts";
import { MatterOperationError } from "./errors.js";

export interface AnnouncedPeer {
  peerAddress?: { nodeId?: unknown };
  act(purpose: string, actor: (agent: { get(type: unknown): NetworkState }) => Promise<void>): Promise<void>;
}

interface NetworkState {
  state: { autoSubscribe: boolean; defaultSubscription: unknown };
  subscriptionActive: boolean;
}

export interface AttachedOta {
  status(): OtaProviderStatus;
  begin(input: { matterNodeId: string; image: Uint8Array; vendorId: number; productId: number; softwareVersion: number }, peer: AnnouncedPeer, endpointRead: unknown): Promise<void>;
  subscribe(listener: (event: OtaProviderEvent) => void): () => void;
  listImages(): Promise<Array<{ vendorId: number; productId: number; softwareVersion: number; mode: string }>>;
  storeImage(image: Uint8Array, softwareVersion: number): Promise<void>;
  exerciseBdxArm(): Promise<{ armed: boolean; cleared: boolean }>;
}

interface ProviderNode {
  add(definition: unknown, options?: unknown): Promise<ProviderEndpoint>;
  env: { get(type: unknown): unknown };
}

interface ProviderEndpoint {
  number: number;
  act<T>(actor: (agent: { get(type: unknown): OtaManager } ) => Promise<T>): Promise<T>;
}

interface BdxSessionLike {
  peerAddress?: { nodeId?: unknown };
  progressFinished?: { on(listener: () => void): unknown };
  progressCancelled?: { on(listener: () => void): unknown };
}
interface OtaManager {
  events: {
    updateApplying: { on(listener: (peer: { nodeId?: unknown }) => void): unknown };
    updateFailed: { on(listener: (peer: { nodeId?: unknown }) => void): unknown };
  };
  forceUpdate(peerAddress: unknown, target: { vendorId: number; productId: number; targetSoftwareVersion: number }): Promise<void>;
  storage: unknown;
}

/**
 * Install the Matter.js OTA Provider on the management node and serve a local image over BDX.
 * The DCL client stays offline. Sensor and actuator clusters are not written.
 */
export async function attachOtaProvider(node: ProviderNode): Promise<AttachedOta> {
  const { OtaProviderEndpoint } = await import("@matter/node/endpoints/ota-provider");
  const { SoftwareUpdateManager } = await import("@matter/node/behaviors/system/software-update");
  const { NetworkClient } = await import("@matter/node/behaviors/system/network");
  const { BdxProtocol, DclOtaUpdateService, PeerAddress } = await import("@matter/protocol");
  const endpoint = await node.add(OtaProviderEndpoint, { id: "ota-provider" });
  const listeners = new Set<(event: OtaProviderEvent) => void>();
  const emit = (event: OtaProviderEvent) => {
    for (const listener of listeners) listener(event);
  };
  const manager = await endpoint.act(async (agent) => agent.get(SoftwareUpdateManager));
  const otaService = node.env.get(DclOtaUpdateService) as {
    updateInfoFromStream(stream: ReadableStream<Uint8Array>, url: string, options: { maxApplicableSoftwareVersion: number; minApplicableSoftwareVersion: number }): Promise<Record<string, unknown>>;
    store(stream: ReadableStream<Uint8Array>, info: Record<string, unknown>, mode: string): Promise<unknown>;
    find(options?: { vendorId?: number; productId?: number }): Promise<Array<{ vendorId: number; productId: number; softwareVersion: number; mode: string }>>;
    storage: unknown;
  };
  const bdx = node.env.get(BdxProtocol) as {
    sessionStarted: { on(listener: (session: BdxSessionLike) => void): unknown };
    enablePeerForScope(peer: unknown, storage: unknown): boolean;
    disablePeerForScope(peer: unknown, storage: unknown, force?: boolean): Promise<void>;
    sessionFor(peer: unknown, scope: string): unknown;
  };
  manager.events.updateApplying.on((peer) => {
    const matterNodeId = nodeIdText(peer?.nodeId);
    if (!matterNodeId) return;
    emit({ type: "applying", matterNodeId, detail: "ApplyUpdateRequest was received. The new SoftwareVersion has not been read." });
  });
  manager.events.updateFailed.on((peer) => {
    const matterNodeId = nodeIdText(peer?.nodeId);
    if (!matterNodeId) return;
    emit({ type: "failed", matterNodeId, detail: "The OTA provider reported the update failed. The device was not factory reset." });
  });
  bdx.sessionStarted.on((session) => {
    const matterNodeId = nodeIdText(session.peerAddress?.nodeId);
    if (!matterNodeId) return;
    emit({ type: "bdx-start", matterNodeId, detail: "A BDX session started for this node." });
    session.progressFinished?.on(() => {
      emit({ type: "bdx-complete", matterNodeId, detail: "The BDX session reported that the offered byte count was transferred. The installed SoftwareVersion has not been read." });
    });
    session.progressCancelled?.on(() => {
      emit({ type: "bdx-interrupted", matterNodeId, detail: "The BDX session was cancelled before the image finished transferring." });
    });
  });

  return {
    status: () => ({
      running: true,
      endpointNumber: endpoint.number,
      fabricScoped: true,
      ledgerOffline: process.env.MATTER_DCL_OFFLINE === "true",
    }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async listImages() {
      return otaService.find();
    },
    async storeImage(image, softwareVersion) {
      const info = await otaService.updateInfoFromStream(asStream(image), "file://iotedu-local.ota", {
        minApplicableSoftwareVersion: 0,
        maxApplicableSoftwareVersion: Math.max(0, softwareVersion - 1),
      });
      // Mode "prod" is the only slot QueryImage selects while allowTestOtaImages is false.
      // store() still rejects a digest mismatch. VID, PID, version, and consent are checked later.
      await otaService.store(asStream(image), { ...info, source: "local" }, "prod");
    },
    async begin(input, peer, endpointRead) {
      const info = await otaService.updateInfoFromStream(asStream(input.image), "file://iotedu-local.ota", {
        minApplicableSoftwareVersion: 0,
        maxApplicableSoftwareVersion: Math.max(0, input.softwareVersion - 1),
      });
      await otaService.store(asStream(input.image), { ...info, source: "local" }, "prod");
      await peer.act("ota-subscribe", async (agent) => {
        const network = agent.get(NetworkClient);
        network.state.defaultSubscription = endpointRead;
        network.state.autoSubscribe = true;
      });
      const address = peer.peerAddress;
      if (!address) throw new MatterOperationError("connection_failed", "The node has no fabric address, so the provider was not announced.");
      try {
        await endpoint.act(async (agent) => agent.get(SoftwareUpdateManager).forceUpdate(address, {
          vendorId: input.vendorId,
          productId: input.productId,
          targetSoftwareVersion: input.softwareVersion,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "The provider could not announce the image.";
        throw new MatterOperationError(
          "connection_failed",
          `${message} Reading the OTA Requestor does not start an update, and the device was not factory reset.`,
        );
      }
    },
    async exerciseBdxArm() {
      const peer = PeerAddress({ fabricIndex: 1 as never, nodeId: 999n as never });
      const storage = otaService.storage;
      const armed = bdx.enablePeerForScope(peer, storage);
      await bdx.disablePeerForScope(peer, storage, true);
      return { armed, cleared: bdx.sessionFor(peer, "ota") == null };
    },
  };
}

function asStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from([Buffer.from(bytes)])) as ReadableStream<Uint8Array>;
}

function nodeIdText(value: unknown): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "nodeId" in value) return nodeIdText((value as { nodeId: unknown }).nodeId);
  return null;
}
