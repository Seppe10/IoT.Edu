import { describe, expect, it } from "vitest";
import { interpretOtaRequestor } from "./ota-requestor.js";

describe("OTA Requestor interpretation", () => {
  it("accepts a wildcard Operate grant and rejects a missing command", () => {
    const ready = interpretOtaRequestor({
      matterNodeId: "5",
      controllerNodeId: "9",
      aclFailed: false,
      reports: [
        { kind: "value", endpointId: 0, clusterId: 0x002a, attributeId: 0x0001, value: true },
        { kind: "value", endpointId: 0, clusterId: 0x002a, attributeId: 0x0002, value: 0 },
        { kind: "value", endpointId: 0, clusterId: 0x002a, attributeId: 0xfff9, value: [0] },
        { kind: "value", endpointId: 0, clusterId: 0x001f, attributeId: 0x0000, value: [{ privilege: 5, authMode: 2, subjects: null, targets: null }] },
      ],
    });
    expect(ready.clusterPresent).toBe(true);
    expect(ready.announceAccepted).toBe(true);
    expect(ready.controllerCanAnnounce).toBe(true);
    expect(ready.detail).not.toMatch(/subjects:/);

    const denied = interpretOtaRequestor({
      matterNodeId: "5",
      controllerNodeId: "9",
      aclFailed: false,
      reports: [
        { kind: "value", endpointId: 0, clusterId: 0x002a, attributeId: 0x0001, value: true },
        { kind: "value", endpointId: 0, clusterId: 0x001f, attributeId: 0x0000, value: [{ privilege: 5, authMode: 2, subjects: [4], targets: null }] },
      ],
    });
    expect(denied.controllerCanAnnounce).toBe(false);
    expect(denied.detail).not.toContain("4");
  });
});
