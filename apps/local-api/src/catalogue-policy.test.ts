import { describe, expect, it } from "vitest";
import { deduplicatedSize, gpioAssignmentIssues, STORAGE_STOP_BYTES, storageDecision } from "./catalogue-policy.js";

describe("catalogue storage policy", () => {
  it("stores one blob when several components share the same source hash", () => {
    const result = deduplicatedSize([
      { hash: "aaa", bytes: 100 },
      { hash: "aaa", bytes: 100 },
      { hash: "bbb", bytes: 40 },
    ]);
    expect(result).toEqual({ uniqueCount: 2, uniqueBytes: 140, duplicateBytes: 100 });
  });

  it("rejects a write that would pass the stop threshold and a write whose size cannot be measured", () => {
    expect(storageDecision(STORAGE_STOP_BYTES - 10, 20).allow).toBe(false);
    expect(storageDecision(1_000, 100).allow).toBe(true);
    expect(storageDecision(null, 100)).toMatchObject({ allow: false, level: "unknown" });
  });

  it("detects a shared GPIO and a reserved pin without dropping an existing assignment", () => {
    const issues = gpioAssignmentIssues([
      { componentName: "Photosensitive Light Sensor", connectionName: "Light", gpio: 4 },
      { componentName: "DHT11 Temperature and Humidity", connectionName: "Data", gpio: 4 },
      { componentName: "RGB LED Controller", connectionName: "Blue", gpio: 9 },
    ], [{ gpio: 9, reason: "BOOT / factory reset" }]);
    expect(issues.some((issue) => issue.includes("GPIO 4"))).toBe(true);
    expect(issues.some((issue) => issue.includes("GPIO 9"))).toBe(true);
  });
});
