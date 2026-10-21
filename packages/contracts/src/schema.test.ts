import { describe, expect, it } from "vitest";
import { componentManifestSchema, firmwareBuildRequestSchema } from "./index.js";

describe("contracts", () => {
  it("rejects a manifest that claims a remote source", () => {
    const parsed = componentManifestSchema.safeParse({
      id: "x",
      name: "X",
      description: "d",
      type: "sensor",
      version: "1.0.0",
      status: "planned",
      source: "github",
      target: "esp32h2",
      idfCompatibility: ">=5.4.1 <5.5",
      selectableForBuild: false,
      firmware: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-positive firmware version", () => {
    const parsed = firmwareBuildRequestSchema.safeParse({
      mode: "mock",
      codeSource: "approved",
      nodeId: null,
      hardware: "esp32h2",
      baseFirmwareId: "iotedu-core",
      componentIds: [],
      pins: [],
      softwareVersion: 0,
      softwareVersionString: "0.0",
      uploadId: null,
      confirm: true,
    });
    expect(parsed.success).toBe(false);
  });
});
