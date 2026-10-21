import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  appFitsPartition,
  detectGpioConflicts,
  parsePartitionCsv,
  partitionLayoutId,
  renderVersionSdkconfig,
  selectionIssues,
  type BoardProfile,
} from "./index.js";
import type { ComponentManifest } from "@iotedu/contracts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const profile: BoardProfile = {
  id: "esp32h2-devkitm-1",
  target: "esp32h2",
  gpioMin: 0,
  gpioMax: 27,
  reservedGpio: [
    { gpio: 8, reason: "strapping" },
    { gpio: 9, reason: "BOOT" },
  ],
  flashSizeBytes: 4 * 1024 * 1024,
  bootloaderOffset: 0,
  partitionTableOffset: 0xc000,
};

describe("firmware checks", () => {
  it("parses the reference partition table and keeps a stable layout id", async () => {
    const text = await readFile(path.join(repoRoot, "reference/matter-dht11/partitions.csv"), "utf8");
    const rows = parsePartitionCsv(text);
    const ota0 = rows.find((row) => row.name === "ota_0");
    const ota1 = rows.find((row) => row.name === "ota_1");
    const otadata = rows.find((row) => row.name === "otadata");
    expect(ota0).toMatchObject({ offset: 0x20000, size: 0x1e0000 });
    expect(ota1).toMatchObject({ offset: 0x200000, size: 0x1e0000 });
    expect(otadata?.offset).toBe(0x1d000);
    const id = partitionLayoutId({
      partitions: rows,
      flashSizeBytes: profile.flashSizeBytes,
      bootloaderOffset: profile.bootloaderOffset,
      partitionTableOffset: profile.partitionTableOffset,
    });
    expect(id).toHaveLength(64);
    expect(id).toBe(
      partitionLayoutId({
        partitions: rows,
        flashSizeBytes: profile.flashSizeBytes,
        bootloaderOffset: profile.bootloaderOffset,
        partitionTableOffset: profile.partitionTableOffset,
      }),
    );
  });

  it("rejects DHT11 and another driver sharing GPIO4, and reserved pins", () => {
    const issues = detectGpioConflicts(profile, [
      { componentId: "iotedu-dht11", pinName: "DHT11_DATA", gpio: 4 },
      { componentId: "iotedu-ldr", pinName: "LDR_ADC", gpio: 4 },
      { componentId: "iotedu-dht11", pinName: "DHT11_DATA_BAD", gpio: 9 },
    ]);
    expect(issues.map((issue) => issue.code)).toEqual(["gpio_conflict", "gpio_reserved"]);
  });

  it("injects one aligned version snippet", () => {
    const text = renderVersionSdkconfig(2, "1.1");
    expect(text).toContain('CONFIG_APP_PROJECT_VER="1.1"');
    expect(text).toContain("CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER=2");
    expect(text).toContain('set(PROJECT_VER "1.1")');
    expect(text).toContain("set(PROJECT_VER_NUMBER 2)");
  });

  it("blocks planned components and native mode", () => {
    const ldr = {
      id: "iotedu-ldr",
      name: "LDR",
      status: "planned",
      selectableForBuild: false,
      type: "sensor",
    } as ComponentManifest;
    const issues = selectionIssues([ldr], ["iotedu-ldr"], "native");
    expect(issues.some((issue) => issue.code === "component_not_buildable")).toBe(true);
    expect(issues.some((issue) => issue.code === "toolchain_mode_unavailable")).toBe(true);
  });

  it("rejects an image larger than the OTA slot and warns above 90%", () => {
    expect(appFitsPartition(0x1e0001, 0x1e0000)[0]?.code).toBe("firmware_too_large");
    expect(appFitsPartition(Math.floor(0x1e0000 * 0.91), 0x1e0000)[0]?.code).toBe("firmware_near_capacity");
    expect(appFitsPartition(1591552, 0x1e0000)).toEqual([]);
  });
});
