import { randomUUID } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import {
  APP_VERSION,
  FABRIC_LABEL,
  type CapabilityReport,
  type CommissionRequest,
  type CommissioningWindowResult,
  type ControllerStatus,
  type ManagedNode,
  type MatterManagementService,
  type NodeRepository,
  type RefreshResult,
} from "@iotedu/contracts";
import { BACKUP_INSTRUCTIONS, FABRIC_LIMIT, MatterOperationError } from "./errors.js";
import { assertCreateAllowed, controllerStorageDir, inspectIdentity, writeIdentity, type StoredIdentity } from "./identity.js";
import { redactSecrets } from "./redact.js";
import type { ManagementTransport, ObservedNode } from "./session.js";

const NEW_DEVICE_LIMITATION =
  "A new ESP32-H2 cannot be commissioned from this host. Bluetooth commissioning is not part of the installed Matter.js build, and no Thread operational dataset is available. IoT.Edu did not invent a dataset, did not create a second Thread network, and did not record the node as commissioned. Flash the initial firmware over USB first, then commission the node from the existing smart-home controller and add IoT.Edu with a pairing code.";

/**
 * Persistent management fabric. The transport is Matter.js in the live process and a fake in tests.
 * Mock mode never reaches this class.
 */
export class LiveMatterManagementService implements MatterManagementService {
  private startupError: string | null = null;
  private transportPromise: Promise<ManagementTransport> | null = null;

  constructor(
    private readonly nodes: NodeRepository,
    private readonly dataDir: string,
    private readonly injected?: ManagementTransport,
  ) {}

  async getCapabilities(): Promise<CapabilityReport> {
    const inspection = await inspectIdentity(this.dataDir, FABRIC_LABEL);
    const ready = inspection.state === "ready" && !this.startupError;
    return {
      applicationVersion: APP_VERSION,
      matterCommissioning: ready ? "available" : "needs_setup",
      bleCommissioning: "unsupported",
      threadDataset: "needs_setup",
      firmwareBuild: "mock_only",
      otaProvider: "mock_only",
      usbFlash: "needs_setup",
      ai: "needs_setup",
      notes: [
        `Matter.js ${inspection.state === "ready" ? inspection.identity.matterJsVersion : "0.18.0"} is the management controller. The fabric label is ${FABRIC_LABEL}. It is not a second Thread network.`,
        "Smart-home-first commissioning adds this controller to a device that is already on the existing Thread network. Use the pairing code from that controller.",
        NEW_DEVICE_LIMITATION,
        "Controller keys stay in the data directory and are not written to Git. A stored identity is not replaced when it fails to load.",
        BACKUP_INSTRUCTIONS,
        "Administrative reads use Basic Information, Descriptor, Operational Credentials, and the OTA requestor. Sensor measurements and actuator commands are not requested.",
        `The firmware accepts at most ${FABRIC_LIMIT} fabrics. A fabric-table rejection does not factory reset the node.`,
        "The OTA Provider is not running. Hardware verification of commissioning has not been recorded.",
      ],
    };
  }

  async getControllerStatus(): Promise<ControllerStatus> {
    const inspection = await inspectIdentity(this.dataDir, FABRIC_LABEL);
    if (inspection.state === "ready") {
      return {
        identityLoaded: this.startupError == null,
        persisted: true,
        fabricLabel: inspection.identity.fabricLabel,
        fabricId: inspection.identity.fabricId,
        credentialId: inspection.identity.credentialId,
        controllerNodeId: inspection.identity.controllerNodeId,
        matterJsVersion: inspection.identity.matterJsVersion,
        regenerationBlocked: true,
        message: this.startupError
          ?? "The management identity is stored and will be reused. IoT.Edu will not generate a replacement.",
        backup: BACKUP_INSTRUCTIONS,
      };
    }
    if (inspection.state === "corrupt" || inspection.state === "blocked") {
      return {
        identityLoaded: false,
        persisted: true,
        fabricLabel: FABRIC_LABEL,
        fabricId: null,
        credentialId: null,
        controllerNodeId: null,
        matterJsVersion: null,
        regenerationBlocked: true,
        message: inspection.message,
        backup: BACKUP_INSTRUCTIONS,
      };
    }
    return {
      identityLoaded: false,
      persisted: false,
      fabricLabel: FABRIC_LABEL,
      fabricId: null,
      credentialId: null,
      controllerNodeId: null,
      matterJsVersion: null,
      regenerationBlocked: true,
      message: "No management identity is stored. Create one explicitly. Commissioning will not generate one.",
      backup: BACKUP_INSTRUCTIONS,
    };
  }

  async createIdentity(): Promise<ControllerStatus> {
    const inspection = await inspectIdentity(this.dataDir, FABRIC_LABEL);
    if (inspection.state === "ready") return this.getControllerStatus();
    assertCreateAllowed(inspection);
    await mkdir(inspection.directory, { recursive: true, mode: 0o700 });
    await chmod(inspection.directory, 0o700);
    const transport = await this.transport({ create: true });
    const info = await transport.ensureStarted({ create: true });
    const identity: StoredIdentity = {
      version: 1,
      createdAt: new Date().toISOString(),
      fabricLabel: FABRIC_LABEL,
      matterJsVersion: info.matterJsVersion,
      fabricId: info.fabricId,
      credentialId: info.credentialId,
      controllerNodeId: info.controllerNodeId,
    };
    await writeIdentity(inspection.directory, identity);
    this.startupError = null;
    return this.getControllerStatus();
  }

  async restore(): Promise<void> {
    const inspection = await inspectIdentity(this.dataDir, FABRIC_LABEL);
    if (inspection.state !== "ready") return;
    try {
      const transport = await this.transport({ create: false });
      await this.applyObservations(await transport.reconnect());
    } catch (error) {
      this.startupError = error instanceof Error ? redactSecrets(error.message) : "The stored controller identity could not be opened.";
    }
  }

  async close(): Promise<void> {
    if (!this.transportPromise) return;
    const transport = await this.transportPromise;
    await transport.close();
    this.transportPromise = null;
  }

  async commission(input: CommissionRequest) {
    if (input.path === "new_device") {
      throw new MatterOperationError("new_device_unavailable", NEW_DEVICE_LIMITATION);
    }
    const pairingCode = normalizePairingCode(input.pairingCode);
    if (!pairingCode) {
      throw new MatterOperationError("invalid_input", "A commissioning code from the existing smart-home controller is required.");
    }
    const inspection = await inspectIdentity(this.dataDir, FABRIC_LABEL);
    if (inspection.state !== "ready") {
      throw new MatterOperationError("identity_missing", "Create the management controller identity before commissioning. A missing identity is not generated automatically.");
    }
    if (this.startupError) {
      throw new MatterOperationError("identity_corrupt", this.startupError);
    }
    const transport = await this.transport({ create: false });
    let observed: ObservedNode;
    try {
      observed = await transport.commissionOnExistingNetwork(pairingCode);
    } catch (error) {
      if (error instanceof MatterOperationError && error.code === "fabric_limit") {
        throw new MatterOperationError(
          "fabric_limit",
          `The device cannot accept another fabric (the firmware allows ${FABRIC_LIMIT}). IoT.Edu did not factory reset it. An existing smart-home administrator can remove a fabric or open a new commissioning window.`,
        );
      }
      if (error instanceof MatterOperationError) throw new MatterOperationError(error.code, redactSecrets(error.message), error.statusCode);
      throw new MatterOperationError("connection_failed", redactSecrets(error instanceof Error ? error.message : "Commissioning failed."));
    }
    const node = this.recordFromObservation(input.name, observed, "commissioned", inspection.identity.fabricId);
    await this.nodes.save(node);
    const sessionOpened = observed.connection === "reachable";
    return {
      simulated: false as const,
      matterSessionOpened: sessionOpened,
      node,
      message: sessionOpened
        ? "The node is on the IoT.Edu management fabric and a CASE session was established."
        : "The controller finished commissioning, but the administrative CASE session did not stay up. Stored identity fields are only those the device returned.",
      limitation: sessionOpened ? null : "Refresh the node when it is reachable. The node was not factory reset.",
    };
  }

  async refreshNode(nodeId: string): Promise<RefreshResult> {
    const node = await this.nodes.getById(nodeId);
    if (!node) throw new MatterOperationError("invalid_input", "Node not found", 404);
    if (node.simulated || !node.matterNodeId) {
      return {
        node,
        liveRead: "unavailable",
        message: "Basic Information was not read. This record has no management-fabric node id.",
      };
    }
    try {
      const transport = await this.transport({ create: false });
      const observed = await transport.refresh(node.matterNodeId);
      const updated = this.mergeObservation(node, observed, "refreshed");
      await this.nodes.save(updated);
      return {
        node: updated,
        liveRead: observed.connection === "reachable" ? "read" : "failed",
        message: observed.connection === "reachable"
          ? "Administrative clusters were read. Sensor measurements were not requested."
          : "The node is commissioned here but did not answer. Stored values were left as last read. The node was not factory reset.",
      };
    } catch (error) {
      return {
        node,
        liveRead: "failed",
        message: redactSecrets(error instanceof Error ? error.message : "The management session could not read the node."),
      };
    }
  }

  async openCommissioningWindow(nodeId: string): Promise<CommissioningWindowResult> {
    const node = await this.nodes.getById(nodeId);
    if (!node) throw new MatterOperationError("invalid_input", "Node not found", 404);
    if (node.simulated || !node.matterNodeId) {
      return {
        opened: false,
        message: "AdministratorCommissioning was not invoked. This record has no live management session.",
      };
    }
    try {
      const transport = await this.transport({ create: false });
      const window = await transport.openSharingWindow(node.matterNodeId);
      return {
        opened: true,
        message: "An enhanced commissioning window was opened for a second administrator. The code is shown once and is redacted from logs.",
        manualPairingCode: window.manualPairingCode || undefined,
        qrPairingCode: window.qrPairingCode || undefined,
      };
    } catch (error) {
      return {
        opened: false,
        message: redactSecrets(error instanceof Error ? error.message : "The commissioning window was not opened. The node was not factory reset."),
      };
    }
  }

  private async transport(options: { create: boolean }): Promise<ManagementTransport> {
    if (!this.transportPromise) {
      this.transportPromise = this.injected
        ? Promise.resolve(this.injected)
        : import("./live.js").then((module) => module.openMatterTransport(this.directory(), options));
    }
    return this.transportPromise;
  }

  private directory(): string {
    return controllerStorageDir(this.dataDir);
  }

  private async applyObservations(observations: ObservedNode[]): Promise<void> {
    const nodes = await this.nodes.list();
    for (const observed of observations) {
      const existing = nodes.find((node) => node.matterNodeId === observed.matterNodeId);
      if (!existing) continue;
      await this.nodes.save(this.mergeObservation(existing, observed, "reconnected"));
    }
  }

  private recordFromObservation(name: string, observed: ObservedNode, kind: string, managementFabricId: string | null): ManagedNode {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      name,
      simulated: false,
      matterNodeId: observed.matterNodeId,
      vendorId: observed.vendorId,
      productId: observed.productId,
      softwareVersion: observed.softwareVersion,
      softwareVersionString: observed.softwareVersionString,
      hardware: observed.hardwareVersionString ?? "Not returned by the device",
      hardwareVersion: observed.hardwareVersion,
      hardwareVersionString: observed.hardwareVersionString,
      reachable: observed.connection === "reachable" ? true : observed.connection === "offline" ? false : null,
      connection: observed.connection,
      lastCommunicationAt: observed.lastCommunicationAt,
      firmwareUpdateEligible: observed.firmwareUpdateEligible,
      fabricLabel: FABRIC_LABEL,
      managementFabricId,
      commissionedFabricCount: observed.commissionedFabricCount,
      otherFabricCount: otherFabricCount(observed.commissionedFabricCount),
      partitionLayoutId: null,
      installedComponents: [],
      history: [{ at: now, kind, detail: historyDetail(observed) }],
      createdAt: now,
      updatedAt: now,
    };
  }

  private mergeObservation(node: ManagedNode, observed: ObservedNode, kind: string): ManagedNode {
    const now = new Date().toISOString();
    return {
      ...node,
      simulated: false,
      matterNodeId: observed.matterNodeId,
      vendorId: observed.vendorId ?? node.vendorId,
      productId: observed.productId ?? node.productId,
      softwareVersion: observed.softwareVersion ?? node.softwareVersion,
      softwareVersionString: observed.softwareVersionString ?? node.softwareVersionString,
      hardware: observed.hardwareVersionString ?? node.hardware,
      hardwareVersion: observed.hardwareVersion ?? node.hardwareVersion,
      hardwareVersionString: observed.hardwareVersionString ?? node.hardwareVersionString,
      reachable: observed.connection === "reachable" ? true : observed.connection === "offline" ? false : node.reachable,
      connection: observed.connection,
      lastCommunicationAt: observed.lastCommunicationAt ?? node.lastCommunicationAt,
      firmwareUpdateEligible: observed.firmwareUpdateEligible ?? node.firmwareUpdateEligible,
      commissionedFabricCount: observed.commissionedFabricCount ?? node.commissionedFabricCount,
      otherFabricCount: otherFabricCount(observed.commissionedFabricCount ?? node.commissionedFabricCount ?? null),
      updatedAt: now,
      history: [...node.history, { at: now, kind, detail: historyDetail(observed) }],
    };
  }
}

export function normalizePairingCode(value: string | undefined): string | null {
  if (!value) return null;
  const compact = value.trim().replace(/\s+/g, "");
  if (/^MT:[A-Z0-9.-]+$/i.test(compact) && compact.length <= 512) return compact;
  if (/^\d{11}$/.test(compact) || /^\d{21}$/.test(compact)) return compact;
  if (/^\d{4}-\d{3}-\d{4}$/.test(compact)) return compact;
  throw new MatterOperationError("invalid_input", "The commissioning code is not a Matter QR code or manual pairing code.");
}

function otherFabricCount(count: number | null): number | null {
  if (count == null) return null;
  return Math.max(0, count - 1);
}

function historyDetail(observed: ObservedNode): string {
  const version = observed.softwareVersionString ?? (observed.softwareVersion == null ? "not returned" : String(observed.softwareVersion));
  return `Management connection ${observed.connection}. SoftwareVersion ${version}.`;
}
