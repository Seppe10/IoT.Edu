import { describe, expect, it } from "vitest";
import { matchNodeTypePackages, nodeTypeReadiness, type MatchProfile, type PackageCandidate } from "./node-types.js";

const environmental: MatchProfile = {
  target: "esp32h2",
  coreComponentId: "matter-core-iotedu",
  deviceComponentId: "custom-dht11",
  gpioNumbers: [4],
  legacyComponentIds: ["iotedu-dht11"],
};

const light: MatchProfile = {
  target: "esp32h2",
  coreComponentId: "matter-core-iotedu",
  deviceComponentId: "custom-photosensitive-light",
  gpioNumbers: [4],
  legacyComponentIds: [],
};

function candidate(overrides: Partial<PackageCandidate>): PackageCandidate {
  return {
    id: "build",
    status: "succeeded",
    simulated: false,
    verification: "compiled",
    hardware: "esp32h2",
    baseFirmwareId: "matter-core-iotedu",
    componentIds: ["custom-dht11"],
    pins: [{ name: "DHT11_DATA", gpio: 4 }],
    softwareVersion: 5,
    softwareVersionString: "1.4.0",
    hasApplicationImage: true,
    applicationSha256: "abc",
    hashMatches: true,
    ...overrides,
  };
}

describe("node type package matching", () => {
  it("keeps the compiled DHT11 package and labels older images as previously compiled", () => {
    const packages = matchNodeTypePackages(environmental, [
      candidate({ id: "current" }),
      candidate({
        id: "older",
        baseFirmwareId: "iotedu-core",
        componentIds: ["iotedu-dht11"],
        softwareVersion: 4,
        softwareVersionString: "1.3.0",
      }),
      candidate({ id: "rgb", componentIds: ["custom-rgb-led"], pins: [{ name: "red", gpio: 4 }, { name: "green", gpio: 10 }, { name: "blue", gpio: 5 }] }),
    ], [{ buildId: "current", state: "release_candidate" }]);
    expect(packages.map((item) => item.buildId)).toEqual(["current", "older"]);
    expect(packages[0]?.releaseState).toBe("release_candidate");
    expect(packages[1]?.releaseState).toBe("legacy");
  });

  it("keeps each compiled package on its own Node Type", () => {
    const rgb: MatchProfile = {
      target: "esp32h2",
      coreComponentId: "matter-core-iotedu",
      deviceComponentId: "custom-rgb-led",
      gpioNumbers: [4, 10, 5],
      legacyComponentIds: [],
    };
    const dht = candidate({ id: "dht" });
    const colour = candidate({
      id: "colour",
      componentIds: ["custom-rgb-led"],
      pins: [{ name: "red", gpio: 4 }, { name: "green", gpio: 10 }, { name: "blue", gpio: 5 }],
      softwareVersion: 8,
      softwareVersionString: "1.7.0",
    });
    const sensor = candidate({
      id: "sensor",
      componentIds: ["custom-photosensitive-light"],
      pins: [{ name: "adc", gpio: 4 }],
      softwareVersion: 7,
      softwareVersionString: "1.6.0",
    });
    expect(matchNodeTypePackages(environmental, [dht, colour, sensor], []).map((item) => item.buildId)).toEqual(["dht"]);
    expect(matchNodeTypePackages(rgb, [dht, colour, sensor], []).map((item) => item.buildId)).toEqual(["colour"]);
    expect(matchNodeTypePackages(light, [dht, colour, sensor], []).map((item) => item.buildId)).toEqual(["sensor"]);
    expect(nodeTypeReadiness({ deviceValidationState: "validated", packages: matchNodeTypePackages(light, [sensor], []) }).statusLabel).toBe("Compiled / Available");
  });

  it("does not offer the DHT11 package to a pending light sensor", () => {
    const packages = matchNodeTypePackages(light, [candidate({ id: "current" })], []);
    expect(packages).toEqual([]);
    expect(nodeTypeReadiness({ deviceValidationState: "validation_required", packages }).statusLabel).toBe("Pending firmware build");
  });

  it("rejects a hash mismatch, a failed build, and a different GPIO", () => {
    const packages = matchNodeTypePackages(environmental, [
      candidate({ id: "bad-hash", hashMatches: false }),
      candidate({ id: "failed", status: "failed" }),
      candidate({ id: "other-pin", pins: [{ name: "DHT11_DATA", gpio: 5 }] }),
    ], []);
    expect(packages).toEqual([]);
  });

  it("reports compilation as outstanding when the source is already validated", () => {
    const readiness = nodeTypeReadiness({ deviceValidationState: "validated", packages: [] });
    expect(readiness.pendingReason).toMatch(/Matter integration compilation/);
  });
});
