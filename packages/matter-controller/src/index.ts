import { randomUUID } from "node:crypto";
import {
  APP_VERSION,
  FABRIC_LABEL,
  type CapabilityReport,
  type CommissionRequest,
  type ManagedNode,
  type MatterManagementService,
  type NodeRepository,
} from "@iotedu/contracts";

/**
 * Phase 1 stand-in. It records a local node and never opens a Matter session,
 * loads a fabric key, or invents a Matter node id.
 */
export class MockMatterManagementService implements MatterManagementService {
  constructor(private readonly nodes: NodeRepository) {}

  async getCapabilities(): Promise<CapabilityReport> {
    return {
      applicationVersion: APP_VERSION,
      matterCommissioning: "mock_only",
      bleCommissioning: "unsupported",
      threadDataset: "needs_setup",
      firmwareBuild: "mock_only",
      otaProvider: "mock_only",
      usbFlash: "needs_setup",
      ai: "needs_setup",
      notes: [
        "No matter.js controller is running. Commissioning records are simulated local notes.",
        "Bluetooth commissioning is not implemented on this host.",
        "No Thread operational dataset is stored.",
        "The OTA Provider is not available. Simulated artifacts cannot be deployed.",
        "USB flashing instructions are documented; no board flash has been run from this app.",
        "AI drafting is disabled until a provider is configured. The key, if any, stays on the server.",
        "A missing controller credential file will not be replaced with a new identity.",
      ],
    };
  }

  async commission(input: CommissionRequest) {
    const now = new Date().toISOString();
    const limitation =
      input.path === "new_device"
        ? "Bluetooth commissioning and a Thread operational dataset are not available. Use the smart-home sharing path when a real controller is added. This record is simulated."
        : "The smart-home commissioning window was not contacted. This record is a local placeholder only.";
    const node: ManagedNode = {
      id: randomUUID(),
      name: input.name,
      simulated: true,
      matterNodeId: null,
      vendorId: null,
      productId: null,
      softwareVersion: null,
      softwareVersionString: null,
      hardware: "ESP32-H2 (declared, not read)",
      reachable: null,
      fabricLabel: FABRIC_LABEL,
      commissionedFabricCount: null,
      otherFabricCount: null,
      partitionLayoutId: null,
      installedComponents: [],
      history: [
        {
          at: now,
          kind: "simulated_commission",
          detail: limitation,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    await this.nodes.save(node);
    return {
      simulated: true as const,
      matterSessionOpened: false as const,
      node,
      message: "No Matter commissioning was performed.",
      limitation,
    };
  }

  async refreshNode(nodeId: string) {
    const node = await this.nodes.getById(nodeId);
    if (!node) throw new Error("Node not found");
    return {
      node,
      liveRead: "unavailable" as const,
      message: "Basic Information was not read. The Matter controller is not running, so stored fields were left unchanged.",
    };
  }

  async openCommissioningWindow(_nodeId: string) {
    return {
      opened: false as const,
      message:
        "AdministratorCommissioning was not invoked. A commissioning window can be opened only after a real management session exists.",
    };
  }
}

export class MemoryNodeRepository implements NodeRepository {
  private readonly nodes = new Map<string, ManagedNode>();

  async list() {
    return [...this.nodes.values()];
  }

  async getById(id: string) {
    return this.nodes.get(id) ?? null;
  }

  async save(node: ManagedNode) {
    this.nodes.set(node.id, node);
  }
}
