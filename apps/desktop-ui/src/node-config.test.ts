import { describe, expect, it } from "vitest";
import { ENVIRONMENTAL_SENSOR, loadNodeConfig, packageMatchesConfig, saveNodeConfig, validateNodeConfig } from "./node-config";

describe("node configuration", () => {
  it("accepts the DHT11 environmental sensor profile", () => {
    expect(validateNodeConfig(ENVIRONMENTAL_SENSOR).ok).toBe(true);
  });

  it("rejects a reserved GPIO, an unknown profile, and a mismatched package", () => {
    expect(validateNodeConfig({ ...ENVIRONMENTAL_SENSOR, gpio: 9 }).ok).toBe(false);
    expect(validateNodeConfig({ ...ENVIRONMENTAL_SENSOR, nodeType: "relay" }).issues[0]?.code).toBe("profile");
    expect(packageMatchesConfig({ hardware: "esp32h2", componentIds: ["iotedu-dht11"] }, ENVIRONMENTAL_SENSOR)).toBeNull();
    expect(packageMatchesConfig({ hardware: "esp32h2", componentIds: ["custom-dht11"] }, ENVIRONMENTAL_SENSOR)).toBeNull();
    expect(packageMatchesConfig({ hardware: "esp32h2", componentIds: ["custom-rgb-led"] }, ENVIRONMENTAL_SENSOR)).toMatch(/DHT11/);
    expect(packageMatchesConfig({ hardware: "esp32h2", componentIds: [] }, ENVIRONMENTAL_SENSOR)).toMatch(/DHT11/);
  });

  it("saves a valid draft and ignores an invalid one", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    saveNodeConfig(storage, { ...ENVIRONMENTAL_SENSOR, name: "Bench" });
    expect(loadNodeConfig(storage).name).toBe("Bench");
    saveNodeConfig(storage, { ...ENVIRONMENTAL_SENSOR, gpio: 9, name: "Bad" });
    expect(loadNodeConfig(storage).name).toBe("Bench");
  });
});
