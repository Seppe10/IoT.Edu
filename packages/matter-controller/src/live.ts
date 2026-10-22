import path from "node:path";
import { config } from "@matter/nodejs/config";
import { FABRIC_LABEL } from "@iotedu/contracts";
import { MatterOperationError } from "./errors.js";
import { IDENTITY_FILE, protectStorage } from "./identity.js";
import { redactSecrets } from "./redact.js";
import type { ControllerRuntimeInfo, ManagementTransport, ObservedNode, SharingWindow } from "./session.js";

const MATTER_JS_VERSION = "0.18.0";
const CONTROLLER_ID = "iotedu-management";

let platformReady = false;
let active: { directory: string; node: MatterControllerNode; transport: MatterJsTransport } | null = null;

interface MatterControllerNode {
  start(): Promise<void>;
  close(): Promise<void>;
  state: { basicInformation?: { uniqueId?: string } };
  env: { get(type: unknown): { fabrics?: Array<{ fabricId?: unknown; nodeId?: unknown }>; config?: { rootKeyIdentifier?: unknown } } };
  peers: {
    commissioned: RemotePeer[];
    commission(options: Record<string, unknown>): Promise<RemotePeer>;
  };
}

interface RemotePeer {
  id: string;
  peerAddress?: { nodeId?: unknown };
  lifecycle: { isConnected?: boolean };
  start(): Promise<void>;
  act(purpose: string, actor: (agent: Record<string, unknown>) => Promise<ObservedFacts>): Promise<ObservedFacts>;
  openEnhancedCommissioningWindow(timeout?: unknown): Promise<{ manualPairingCode?: string; qrPairingCode?: string }>;
}

interface ObservedFacts {
  vendorId: number | null;
  productId: number | null;
  hardwareVersion: number | null;
  hardwareVersionString: string | null;
  softwareVersion: number | null;
  softwareVersionString: string | null;
  commissionedFabricCount: number | null;
  firmwareUpdateEligible: boolean | null;
}

/**
 * Matter.js installs process signal handlers when its platform loads.
 * Configure that platform before the first import, and keep storage inside the data directory.
 */
export function armMatterPlatform(storageDir: string): void {
  const directory = path.resolve(storageDir);
  process.env.MATTER_PATH_ROOT = directory;
  process.env.MATTER_STORAGE_PATH = directory;
  process.env.MATTER_PATH_CONFIG = path.join(directory, "matter-config.json");
  if (platformReady) return;
  config.trapProcessSignals = false;
  config.trapUnhandledErrors = false;
  config.setProcessExitCodeOnError = false;
  config.loadProcessArgv = false;
  config.defaultEnvironmentName = "iotedu";
  config.defaultStoragePath = directory;
  config.defaultConfigFilePath = "matter-config.json";
  platformReady = true;
}

export async function openMatterTransport(storageDir: string, options: { create: boolean }): Promise<ManagementTransport> {
  const directory = path.resolve(storageDir);
  if (active?.directory === directory) return active.transport;
  if (active) {
    throw new MatterOperationError("connection_failed", "A Matter controller is already open for another data directory.");
  }
  if (!options.create && !(await storageHasKeys(directory))) {
    throw new MatterOperationError(
      "identity_corrupt",
      "The controller identity record is present but its credential files are missing. IoT.Edu did not generate a replacement identity.",
    );
  }
  armMatterPlatform(directory);
  const { ServerNode, Logger, LogLevel, Seconds } = await import("@matter/main");
  const { ControllerBehavior } = await import("@matter/node/behaviors/system/controller");
  const { Read, FabricAuthority, CertificateAuthority } = await import("@matter/protocol");
  installRedactingLog(Logger, LogLevel.WARN);
  const root = ServerNode.RootEndpoint.with(ControllerBehavior);
  const node = await ServerNode.create(root, {
    id: CONTROLLER_ID,
    controller: {
      adminFabricLabel: FABRIC_LABEL,
      ble: false,
      ip: true,
    },
    basicInformation: {
      nodeLabel: FABRIC_LABEL,
      productName: "Management Hub",
      vendorName: "IoT.Edu",
    },
  }) as unknown as MatterControllerNode;
  await node.start();
  await protectStorage(directory);
  const read = Read as unknown as ReadApi;
  const transport = new MatterJsTransport(node, FabricAuthority, CertificateAuthority, read, Seconds, directory);
  active = { directory, node, transport };
  return transport;
}

interface ReadApi {
  (selector: unknown): unknown;
  Attribute(selector: { endpoint: number }): unknown;
}

class MatterJsTransport implements ManagementTransport {
  constructor(
    private readonly node: MatterControllerNode,
    private readonly fabricAuthority: unknown,
    private readonly certificateAuthority: unknown,
    private readonly read: ReadApi,
    private readonly seconds: (value: number) => unknown,
    private readonly directory: string,
  ) {}

  async ensureStarted(_options: { create: boolean }): Promise<ControllerRuntimeInfo> {
    const authority = this.node.env.get(this.fabricAuthority);
    const fabric = authority.fabrics?.[0];
    const certificate = this.node.env.get(this.certificateAuthority) as {
      construction?: PromiseLike<unknown>;
      config?: { rootKeyIdentifier?: unknown };
    };
    if (certificate.construction) await certificate.construction;
    return {
      fabricId: idText(fabric?.fabricId),
      credentialId: bytesToHex(certificate.config?.rootKeyIdentifier) ?? idText(this.node.state.basicInformation?.uniqueId),
      controllerNodeId: idText(fabric?.nodeId) ?? this.node.state.basicInformation?.uniqueId ?? null,
      matterJsVersion: MATTER_JS_VERSION,
    };
  }

  async commissionOnExistingNetwork(pairingCode: string): Promise<ObservedNode> {
    let peer: RemotePeer;
    try {
      peer = await withTimeout(this.node.peers.commission({
        pairingCode,
        autoSubscribe: false,
        autoStateInitialize: true,
        defaultSubscription: this.read(this.read.Attribute({ endpoint: 0 })),
        discoveryCapabilities: { onIpNetwork: true, ble: false },
        timeout: this.seconds(60),
      }), 90_000, "Commissioning");
    } catch (error) {
      throw mapCommissionError(error);
    }
    return this.describe(peer, true);
  }

  async refresh(matterNodeId: string): Promise<ObservedNode> {
    const peer = this.find(matterNodeId);
    return this.describe(peer, true);
  }

  async reconnect(): Promise<ObservedNode[]> {
    const nodes: ObservedNode[] = [];
    for (const peer of this.node.peers.commissioned) {
      const id = idText(peer.peerAddress?.nodeId);
      if (!id) continue;
      nodes.push(await this.describe(peer, true));
    }
    return nodes;
  }

  async openSharingWindow(matterNodeId: string): Promise<SharingWindow> {
    const peer = this.find(matterNodeId);
    try {
      await withTimeout(peer.start(), 20_000, "CASE session");
      const window = await withTimeout(peer.openEnhancedCommissioningWindow(this.seconds(180)), 20_000, "Commissioning window");
      if (!window.manualPairingCode && !window.qrPairingCode) {
        throw new MatterOperationError("connection_failed", "The device did not return a commissioning code.");
      }
      return {
        manualPairingCode: window.manualPairingCode ?? "",
        qrPairingCode: window.qrPairingCode ?? "",
      };
    } catch (error) {
      if (error instanceof MatterOperationError) throw error;
      throw new MatterOperationError("connection_failed", `The commissioning window was not opened. ${safeMessage(error)} The node was not factory reset.`);
    }
  }

  async close(): Promise<void> {
    await this.node.close();
    if (active?.node === this.node) active = null;
  }

  private find(matterNodeId: string): RemotePeer {
    const peer = this.node.peers.commissioned.find((item) => idText(item.peerAddress?.nodeId) === matterNodeId);
    if (!peer) throw new MatterOperationError("connection_failed", "That node is not on the IoT.Edu management fabric.");
    return peer;
  }

  private async describe(peer: RemotePeer, attemptSession: boolean): Promise<ObservedNode> {
    const matterNodeId = idText(peer.peerAddress?.nodeId);
    if (!matterNodeId) {
      throw new MatterOperationError("connection_failed", "The controller did not receive a Matter node id. No node record was stored.");
    }
    if (!attemptSession) {
      return emptyObservation(matterNodeId, "commissioned");
    }
    try {
      await withTimeout(peer.start(), 20_000, "CASE session");
      const facts = await withTimeout(peer.act("management-read", async (agent) => readAdministrative(agent)), 20_000, "Administrative read");
      return {
        matterNodeId,
        ...facts,
        connection: peer.lifecycle.isConnected === false ? "offline" : "reachable",
        lastCommunicationAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof MatterOperationError && error.code === "fabric_limit") throw error;
      return {
        ...emptyObservation(matterNodeId, "offline"),
        connection: "offline",
        lastCommunicationAt: null,
      };
    }
  }
}

function readAdministrative(agent: Record<string, unknown>): ObservedFacts {
  const basic = clusterState(agent, "basicInformation");
  const credentials = clusterState(agent, "operationalCredentials");
  const requestor = clusterState(agent, "otaSoftwareUpdateRequestor");
  const updatePossible = requestor ? booleanOrNull(requestor.updatePossible) : null;
  return {
    vendorId: numberOrNull(basic?.vendorId),
    productId: numberOrNull(basic?.productId),
    hardwareVersion: numberOrNull(basic?.hardwareVersion),
    hardwareVersionString: stringOrNull(basic?.hardwareVersionString),
    softwareVersion: numberOrNull(basic?.softwareVersion),
    softwareVersionString: stringOrNull(basic?.softwareVersionString),
    commissionedFabricCount: numberOrNull(credentials?.commissionedFabrics),
    firmwareUpdateEligible: updatePossible,
  };
}

function clusterState(agent: Record<string, unknown>, name: string): Record<string, unknown> | null {
  try {
    const cluster = agent[name];
    if (!cluster || typeof cluster !== "object") return null;
    const state = (cluster as { state?: unknown }).state;
    if (!state || typeof state !== "object") return null;
    return state as Record<string, unknown>;
  } catch {
    return null;
  }
}

function emptyObservation(matterNodeId: string, connection: ObservedNode["connection"]): ObservedNode {
  return {
    matterNodeId,
    vendorId: null,
    productId: null,
    hardwareVersion: null,
    hardwareVersionString: null,
    softwareVersion: null,
    softwareVersionString: null,
    commissionedFabricCount: null,
    firmwareUpdateEligible: null,
    connection,
    lastCommunicationAt: null,
  };
}

function mapCommissionError(error: unknown): MatterOperationError {
  if (error instanceof MatterOperationError) return error;
  const message = safeMessage(error);
  if (/fabric/i.test(message) && /(full|limit|no space|too many|busy)/i.test(message)) {
    return new MatterOperationError(
      "fabric_limit",
      "The device cannot accept another fabric. IoT.Edu did not factory reset it. An existing administrator can remove a fabric or open a new commissioning window.",
    );
  }
  if (/not found|timeout|discover|no device|mdns/i.test(message)) {
    return new MatterOperationError("discovery_failed", `The device was not discovered on the existing network. ${message}`);
  }
  return new MatterOperationError("connection_failed", `Commissioning did not finish. ${message} The node was not factory reset.`);
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "The Matter controller reported a failure.";
  return redactSecrets(message);
}

function installRedactingLog(logger: { level: unknown; destinations: { default?: { write: (text: string, message: never) => void; ioteduRedacted?: boolean } } }, warn: unknown): void {
  logger.level = warn;
  const destination = logger.destinations.default;
  if (!destination || destination.ioteduRedacted) return;
  const write = destination.write.bind(destination);
  destination.write = ((text: string, message: never) => {
    write(redactSecrets(text), message);
  }) as typeof destination.write;
  destination.ioteduRedacted = true;
}

function bytesToHex(value: unknown): string | null {
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  return null;
}

function idText(value: unknown): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.length > 0 && value !== "[object Object]") return value;
  if (value && typeof value === "object" && "id" in value) return idText((value as { id: unknown }).id);
  if (value && typeof value === "object" && Symbol.toPrimitive in Object.getPrototypeOf(value)) {
    const text = String(value);
    return text && text !== "[object Object]" ? text : null;
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "valueOf" in value) {
    const numeric = Number(value.valueOf());
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

async function storageHasKeys(directory: string): Promise<boolean> {
  try {
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(directory);
    return names.some((name) => name !== IDENTITY_FILE && name !== "matter-config.json");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function matterJsVersion(): string {
  return MATTER_JS_VERSION;
}
