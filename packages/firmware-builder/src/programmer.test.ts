import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildJob } from "@iotedu/contracts";
import { describe, expect, it } from "vitest";
import { loadReferenceLayout, type BoardProfile } from "./index.js";
import {
  buildWritePlan,
  chipProbeAccepted,
  filterSerialPortNames,
  flashProgressPercent,
  isAllowedSerialPort,
  packageProgrammingBlock,
  redactSerialLog,
  probeChip,
  runUsbWrite,
  startupChecks,
  writeDiagnostic,
  type FlashArguments,
  type ToolExecutor,
} from "./programmer.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const profile: BoardProfile = {
  id: "esp32h2-devkitm-1",
  target: "esp32h2",
  gpioMin: 0,
  gpioMax: 27,
  reservedGpio: [],
  flashSizeBytes: 4 * 1024 * 1024,
  bootloaderOffset: 0,
  partitionTableOffset: 0xc000,
};

function job(overrides: Partial<BuildJob> = {}): BuildJob {
  const names = ["bootloader.bin", "sensors.bin", "partition-table.bin", "ota_data_initial.bin", "usb-image.bin", "flasher_args.json"];
  return {
    id: "pkg",
    simulated: false,
    verification: "compiled",
    status: "succeeded",
    request: {
      mode: "native",
      codeSource: "approved",
      nodeId: null,
      hardware: "esp32h2",
      baseFirmwareId: "iotedu-core",
      componentIds: ["iotedu-dht11"],
      pins: [],
      softwareVersion: 3,
      softwareVersionString: "1.2.0",
      uploadId: null,
      confirm: true,
    },
    validation: { ok: true, issues: [] },
    logs: [],
    artifacts: names.map((name) => ({
      name,
      relativePath: name,
      sha256: "abc",
      size: 1,
      simulated: false,
      deployable: false,
    })),
    partitionLayoutId: "layout",
    durationMs: 1,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    ...overrides,
  };
}

function flasher(): FlashArguments {
  return {
    write_flash_args: ["--flash_mode", "dio", "--flash_size", "4MB", "--flash_freq", "48m"],
    flash_files: {
      "0x0": "bootloader/bootloader.bin",
      "0xc000": "partition_table/partition-table.bin",
      "0x1d000": "ota_data_initial.bin",
      "0x20000": "sensors.bin",
    },
    extra_esptool_args: { chip: "esp32h2", before: "default_reset", after: "hard_reset" },
    bootloader: { encrypted: "false" },
    app: { encrypted: "false" },
    "partition-table": { encrypted: "false" },
    otadata: { encrypted: "false" },
  };
}

async function samplePlan() {
  const bootloader = Buffer.from("boot");
  const table = Buffer.from("table");
  const otadata = Buffer.from("ota");
  const app = Buffer.from("app-image");
  const merged = Buffer.alloc(0x20000 + app.length, 0xff);
  merged.set(bootloader, 0);
  merged.set(table, 0xc000);
  merged.set(otadata, 0x1d000);
  merged.set(app, 0x20000);
  merged[0x10000] = 0x5a;
  const dir = await mkdtemp(path.join(tmpdir(), "iotedu-plan-"));
  const layout = await loadReferenceLayout(repoRoot, profile);
  const plan = buildWritePlan({
    flasher: flasher(),
    artifactDir: dir,
    port: "/dev/cu.usbmodem1101",
    partitions: layout.partitions,
    bootloaderOffset: profile.bootloaderOffset,
    partitionTableOffset: profile.partitionTableOffset,
    flashSizeBytes: profile.flashSizeBytes,
    files: {
      "bootloader.bin": bootloader,
      "partition-table.bin": table,
      "ota_data_initial.bin": otadata,
      "sensors.bin": app,
      "usb-image.bin": merged,
    },
  });
  return { plan, dir, app };
}

describe("USB programmer", () => {
  it("accepts a compiled package and rejects a simulated one", () => {
    expect(packageProgrammingBlock(job())).toBeNull();
    const simulated = packageProgrammingBlock(job({ simulated: true, verification: "simulated", status: "simulated" }));
    expect(simulated?.code).toBe("simulated_package");
    expect(packageProgrammingBlock(job({ status: "failed", verification: null }))?.code).toBe("package_not_compiled");
  });

  it("accepts only a local macOS USB device path", () => {
    expect(isAllowedSerialPort("/dev/cu.usbmodem1101")).toBe(true);
    expect(isAllowedSerialPort("/dev/cu.usbserial-1410")).toBe(true);
    expect(isAllowedSerialPort("/dev/cu.wchusbserial110")).toBe(true);
    expect(isAllowedSerialPort("/dev/cu.SLAB_USBtoUART")).toBe(true);
    expect(isAllowedSerialPort("/dev/tty.usbmodem1101")).toBe(false);
    expect(isAllowedSerialPort("/tmp/cu.usbmodem1101")).toBe(false);
    expect(isAllowedSerialPort("/dev/cu.usbmodem1101;reboot")).toBe(false);
    expect(isAllowedSerialPort("/dev/cu.usbmodem1101/../../etc/passwd")).toBe(false);
    expect(filterSerialPortNames(["cu.usbmodem1101", "cu.Bluetooth-Incoming-Port", "tty.usbmodem1101"])).toEqual([
      "/dev/cu.usbmodem1101",
    ]);
  });

  it("builds a write from package metadata without erase or the merged image", async () => {
    const { plan, dir } = await samplePlan();
    expect(plan.ok, plan.issues.map((item) => item.message).join("; ")).toBe(true);
    expect(plan.args[0]).toBe("write-flash");
    expect(plan.args).toContain("/dev/cu.usbmodem1101");
    expect(plan.args).toEqual(expect.arrayContaining(["0x0", "0xc000", "0x1d000", "0x20000", "write_flash"]));
    expect(plan.args.some((arg) => arg.endsWith("usb-image.bin"))).toBe(false);
    expect(plan.args.some((arg) => /erase/i.test(arg))).toBe(false);
    expect(plan.args).not.toContain("0x10000");
    expect(plan.args).toContain(path.join(dir, "sensors.bin"));
  });

  it("rejects an erase flag, an NVS overlap, and a merged image that does not match", async () => {
    const { plan } = await samplePlan();
    expect(plan.ok).toBe(true);
    const layout = await loadReferenceLayout(repoRoot, profile);
    const erased = buildWritePlan({
      flasher: { ...flasher(), write_flash_args: ["--flash_mode", "dio", "--flash_size", "4MB", "--flash_freq", "48m", "--erase-all"] },
      artifactDir: "/tmp/pkg",
      port: "/dev/cu.usbmodem1101",
      partitions: layout.partitions,
      bootloaderOffset: 0,
      partitionTableOffset: 0xc000,
      flashSizeBytes: profile.flashSizeBytes,
      files: {},
    });
    expect(erased.ok).toBe(false);
    expect(erased.args).toEqual([]);
    expect(erased.issues.some((item) => item.code === "erase_rejected")).toBe(true);

    const bootloader = Buffer.alloc(0x12000, 1);
    const overlapping = buildWritePlan({
      flasher: flasher(),
      artifactDir: "/tmp/pkg",
      port: "/dev/cu.usbmodem1101",
      partitions: layout.partitions,
      bootloaderOffset: 0,
      partitionTableOffset: 0xc000,
      flashSizeBytes: profile.flashSizeBytes,
      files: {
        "bootloader.bin": bootloader,
        "partition-table.bin": Buffer.from("table"),
        "ota_data_initial.bin": Buffer.from("ota"),
        "sensors.bin": Buffer.from("app"),
        "usb-image.bin": Buffer.alloc(0x21000, 0xff),
      },
    });
    expect(overlapping.issues.some((item) => item.code === "protected_partition")).toBe(true);

    const merged = Buffer.alloc(0x20010, 0xff);
    const mismatch = buildWritePlan({
      flasher: flasher(),
      artifactDir: "/tmp/pkg",
      port: "/dev/cu.usbmodem1101",
      partitions: layout.partitions,
      bootloaderOffset: 0,
      partitionTableOffset: 0xc000,
      flashSizeBytes: profile.flashSizeBytes,
      files: {
        "bootloader.bin": Buffer.from("boot"),
        "partition-table.bin": Buffer.from("table"),
        "ota_data_initial.bin": Buffer.from("ota"),
        "sensors.bin": Buffer.from("app"),
        "usb-image.bin": merged,
      },
    });
    expect(mismatch.issues.some((item) => item.code === "merged_image_mismatch")).toBe(true);
  });

  it("reports progress and a disconnected-port diagnostic", () => {
    expect(flashProgressPercent("Writing at 0x00020000... (40 %)")).toBe(40);
    expect(flashProgressPercent("done")).toBeNull();
    expect(writeDiagnostic("could not open port /dev/cu.usbmodem1101", false)).toMatch(/could not be opened/);
    expect(writeDiagnostic("", true)).toMatch(/timed out/);
  });

  it("redacts pairing material and does not treat a sensor line as commissioning", () => {
    const redacted = redactSerialLog("payload MT:Y.ABCDEF passcode: 12345678 manual 3497-011-2332");
    expect(redacted).not.toContain("MT:Y");
    expect(redacted).not.toContain("12345678");
    expect(redacted).not.toContain("3497-011-2332");

    const checks = startupChecks({
      writeLog: "note: ESP32-H2 responded",
      monitorLog: [
        'I boot: App "sensors" version 1.2.0',
        "OpenThread started",
        "DHT11 read failed: ESP_ERR_TIMEOUT",
      ].join("\n"),
      versionString: "1.2.0",
      writeStatus: "succeeded",
    });
    expect(checks.find((item) => item.id === "matter")?.status).toBe("unknown");
    expect(checks.find((item) => item.id === "openthread")?.status).toBe("passed");
    expect(checks.find((item) => item.id === "dht11")?.status).toBe("passed");
    expect(checks.find((item) => item.id === "version")?.status).toBe("passed");
    expect(checks.find((item) => item.id === "factory_reset")?.status).toBe("unknown");
    expect(checks.find((item) => item.id === "dht11")?.detail).toMatch(/not evidence of Matter commissioning/);

    const other = startupChecks({
      writeLog: "",
      monitorLog: 'App "sensors" version 1.1.0\nGuru Meditation Error',
      versionString: "1.2.0",
      writeStatus: "succeeded",
    });
    expect(other.find((item) => item.id === "version")?.status).toBe("failed");
    expect(other.find((item) => item.id === "boot")?.status).toBe("failed");
  });

  it("stops after a failed chip probe and still refuses an erase command", async () => {
    const calls: string[][] = [];
    const executor: ToolExecutor = {
      async run(args) {
        calls.push(args);
        return { code: 1, text: "Failed to connect to ESP32-H2", cancelled: false };
      },
    };
    const result = await runUsbWrite({
      repoRoot,
      port: "/dev/cu.usbmodem1101",
      writeArgs: ["write-flash", "--port", "/dev/cu.usbmodem1101", "write_flash"],
      signal: new AbortController().signal,
      onLog: () => undefined,
    }, executor);
    expect(result.ok).toBe(false);
    expect(chipProbeAccepted(1, "Failed to connect to ESP32-H2")).toBe(false);
    expect(calls.map((args) => args[0])).toEqual(["chip-id"]);

    const refused = await runUsbWrite({
      repoRoot,
      port: "/dev/cu.usbmodem1101",
      writeArgs: ["write-flash", "--erase-all"],
      signal: new AbortController().signal,
      onLog: () => undefined,
    }, executor);
    expect(refused.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("writes only after the chip probe reports ESP32-H2 and reports a timeout", async () => {
    const calls: string[][] = [];
    const executor: ToolExecutor = {
      async run(args) {
        calls.push(args);
        if (args[0] === "chip-id") return { code: 0, text: "Chip is ESP32-H2", cancelled: false };
        return { code: 0, text: "Hash of data verified", cancelled: false };
      },
    };
    const wrote = await runUsbWrite({
      repoRoot,
      port: "/dev/cu.usbmodem1101",
      writeArgs: ["write-flash", "--port", "/dev/cu.usbmodem1101", "write_flash", "0x20000", "/tmp/sensors.bin"],
      signal: new AbortController().signal,
      onLog: () => undefined,
    }, executor);
    expect(wrote.ok).toBe(true);
    expect(calls.map((args) => args[0])).toEqual(["chip-id", "write-flash"]);

    const hanging: ToolExecutor = {
      run(_args, signal) {
        return new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ code: 0, text: "Chip is ESP32-H2", cancelled: false }), 1000);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve({ code: 1, text: "", cancelled: true });
          });
        });
      },
    };
    const timed = await runUsbWrite({
      repoRoot,
      port: "/dev/cu.usbmodem1101",
      writeArgs: ["write-flash", "write_flash"],
      signal: new AbortController().signal,
      onLog: () => undefined,
      timeoutMs: 20,
    }, hanging);
    expect(timed.ok).toBe(false);
    expect(timed.cancelled).toBe(false);
    expect(timed.diagnostic).toMatch(/timed out/);
  });

  it("keeps a higher version distinct in the startup record", () => {
    const first = startupChecks({
      writeLog: "",
      monitorLog: 'App "sensors" version 1.1.0',
      versionString: "1.1.0",
      writeStatus: "succeeded",
    });
    const second = startupChecks({
      writeLog: "",
      monitorLog: 'App "sensors" version 1.2.0',
      versionString: "1.2.0",
      writeStatus: "succeeded",
    });
    expect(first.find((item) => item.id === "version")?.detail).toContain("1.1.0");
    expect(second.find((item) => item.id === "version")?.detail).toContain("1.2.0");
    expect(first.find((item) => item.id === "version")?.detail).not.toContain("1.2.0");
  });

  it("identifies an ESP32-H2 without starting a flash write", async () => {
    const calls: string[][] = [];
    const executor: ToolExecutor = {
      async run(args) {
        calls.push(args);
        return { code: 0, text: "Detecting chip type... ESP32-H2\n", cancelled: false };
      },
    };
    const result = await probeChip({ repoRoot, port: "/dev/cu.usbmodem101" }, executor);
    expect(result.accepted).toBe(true);
    expect(calls).toEqual([["chip-id", "/dev/cu.usbmodem101"]]);
  });

  it("rejects a probe that does not report ESP32-H2 and does not write", async () => {
    const calls: string[][] = [];
    const executor: ToolExecutor = {
      async run(args) {
        calls.push(args);
        return { code: 2, text: "This chip is ESP32-C6, not ESP32-H2.\n", cancelled: false };
      },
    };
    const rejected = await probeChip({ repoRoot, port: "/dev/cu.usbmodem101" }, executor);
    const skipped = await probeChip({ repoRoot, port: "/tmp/not-a-port" }, executor);
    expect(rejected.accepted).toBe(false);
    expect(skipped.accepted).toBe(false);
    expect(calls).toEqual([["chip-id", "/dev/cu.usbmodem101"]]);
  });
});
