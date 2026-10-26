import { describe, expect, it } from "vitest";
import { interpretConsole } from "./diagnostics";
import { EMPTY_SETUP, loadSetup, reconcileSetup, reopenSetup, saveSetup } from "./setup";

describe("setup workflow", () => {
  it("does not treat a stored success as current reachability", () => {
    const stored = {
      ...EMPTY_SETUP,
      hardware: "completed" as const,
      smartHome: "completed" as const,
      management: "completed" as const,
      appleHomeConfirmedAt: "2026-10-22T00:00:00.000Z",
    };
    const reopened = reopenSetup(stored);
    expect(reopened.hardware).toBe("not_verified");
    expect(reopened.management).toBe("not_verified");
    const offline = reconcileSetup(reopened, [{ simulated: false, reachable: false, matterNodeId: "2", presence: "unreachable" }]);
    expect(offline.management).toBe("requires_attention");
    expect(offline.smartHome).toBe("requires_attention");
    const cached = reconcileSetup(reopened, [{ simulated: false, reachable: true, matterNodeId: "2" }]);
    expect(cached.management).toBe("not_verified");
    const live = reconcileSetup(reopened, [{ simulated: false, reachable: true, matterNodeId: "2", presence: "online" }]);
    expect(live.management).toBe("completed");
    expect(live.smartHome).toBe("completed");
  });

  it("keeps an uncommissioned board ready for first-time setup", () => {
    const next = reconcileSetup(EMPTY_SETUP, []);
    expect(next.management).toBe("not_started");
    expect(next.smartHome).toBe("not_started");
  });

  it("round-trips the selected package without marking hardware currently verified", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    saveSetup(storage, { ...EMPTY_SETUP, selectedBuildId: "pkg-1", hardware: "completed" });
    expect(loadSetup(storage).selectedBuildId).toBe("pkg-1");
    expect(loadSetup(storage).hardware).toBe("not_verified");
    saveSetup(storage, { ...EMPTY_SETUP, deviceMac: "48:31:b7:cf:37:5f", deviceIdentity: "verified", deviceProbeSource: "chip_id" });
    expect(loadSetup(storage).deviceIdentity).toBe("historical");
    expect(loadSetup(storage).deviceMac).toBe("48:31:b7:cf:37:5f");
  });

  it("does not treat another board's Matter node as this ESP32-H2", () => {
    const setup = { ...EMPTY_SETUP, deviceMac: "48:31:b7:cf:37:5f", appleHomeConfirmedAt: "2026-10-24T02:00:00.000Z" };
    const previous = reconcileSetup(setup, [{
      simulated: false,
      reachable: true,
      matterNodeId: "1",
      hardwareMac: "48:31:B7:CF:3D:52",
      presence: "online",
    }]);
    expect(previous.management).toBe("not_started");
    const unproven = reconcileSetup(setup, [{
      simulated: false,
      reachable: true,
      matterNodeId: "1",
      hardwareMac: null,
      presence: "online",
    }]);
    expect(unproven.management).toBe("not_started");
    const matched = reconcileSetup(setup, [{
      simulated: false,
      reachable: true,
      matterNodeId: "1",
      hardwareMac: "48:31:B7:CF:37:5F",
      presence: "online",
    }]);
    expect(matched.management).toBe("completed");
  });
});

describe("console interpretation", () => {
  it("keeps a factory-reset click from counting as a reset", () => {
    expect(interpretConsole("", "1.3.0").factoryReset).toBe("unknown");
  });

  it("separates a DHT11 read from a dashboard and detects a reset log", () => {
    const text = [
      "App version:      1.3.0",
      "chip[DL]: OpenThread started: OK",
      "DHT11 Temperature: 24°C, Humidity: 51%RH",
      "Factory reset requested",
    ].join("\n");
    const found = interpretConsole(text, "1.3.0");
    expect(found.firmwareIdentity).toBe("pass");
    expect(found.dht11).toBe("pass");
    expect(found.factoryReset).toBe("incomplete");
    expect(found.matter).toBe("pass");
  });
});
