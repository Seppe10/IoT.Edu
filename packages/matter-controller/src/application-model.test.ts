import { describe, expect, it } from "vitest";
import { interpretApplicationModel, partsFrom } from "./application-model.js";

describe("Matter application model reads", () => {
  it("keeps the descriptor parts and device types", () => {
    const parts = partsFrom([{ kind: "value", endpointId: 0, clusterId: 0x001d, attributeId: 0x0003, value: [1] }]);
    const model = interpretApplicationModel([0, ...parts], [
      { kind: "value", endpointId: 0, clusterId: 0x001d, attributeId: 0x0000, value: [{ deviceType: 0x0016, revision: 1 }] },
      { kind: "value", endpointId: 0, clusterId: 0x001d, attributeId: 0x0001, value: [0x0028, 0x002a] },
      { kind: "value", endpointId: 1, clusterId: 0x001d, attributeId: 0x0000, value: [{ deviceType: 0x010d, revision: 1 }] },
      { kind: "value", endpointId: 1, clusterId: 0x001d, attributeId: 0x0001, value: [0x0006] },
    ]);
    expect(model.find((endpoint) => endpoint.endpointId === 1)?.deviceTypes).toEqual([0x010d]);
    expect(model.find((endpoint) => endpoint.endpointId === 0)?.serverClusters).toContain(0x002a);
  });
});
