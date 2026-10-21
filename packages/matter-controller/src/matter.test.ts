import { describe, expect, it } from "vitest";
import { MemoryNodeRepository, MockMatterManagementService } from "./index.js";

describe("mock Matter service", () => {
  it("does not invent a Matter node id or report a live session", async () => {
    const service = new MockMatterManagementService(new MemoryNodeRepository());
    const result = await service.commission({
      path: "smart_home",
      name: "Bench node",
      pairingCode: "should-not-be-stored-as-matter-proof",
      confirm: true,
      acknowledgeSimulation: true,
    });
    expect(result.matterSessionOpened).toBe(false);
    expect(result.node.simulated).toBe(true);
    expect(result.node.matterNodeId).toBeNull();
    expect(result.node.reachable).toBeNull();
    expect(result.node.vendorId).toBeNull();
    const caps = await service.getCapabilities();
    expect(caps.bleCommissioning).toBe("unsupported");
    expect(caps.matterCommissioning).toBe("mock_only");
  });
});
