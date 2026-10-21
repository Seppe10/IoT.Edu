import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ComponentManifest, ValidationIssue } from "@iotedu/contracts";

export interface PartitionRow {
  name: string;
  type: string;
  subtype: string;
  offset: number | null;
  size: number;
  flags: string;
}

export interface BoardProfile {
  id: string;
  target: string;
  gpioMin: number;
  gpioMax: number;
  reservedGpio: { gpio: number; reason: string }[];
  flashSizeBytes: number;
  bootloaderOffset: number;
  partitionTableOffset: number;
}

export interface PinAssignment {
  componentId: string;
  pinName: string;
  gpio: number;
}

export function parsePartitionCsv(text: string): PartitionRow[] {
  const rows: PartitionRow[] = [];
  let cursor = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(",").map((part) => part.trim());
    const name = parts[0] ?? "";
    const type = parts[1] ?? "";
    const subtype = parts[2] ?? "";
    const offsetText = parts[3] ?? "";
    const sizeText = parts[4] ?? "";
    const flags = parts[5] ?? "";
    if (!name || !sizeText) {
      throw new Error(`Unreadable partition row: ${line}`);
    }
    const size = parseInt(sizeText, 16);
    if (!Number.isFinite(size)) throw new Error(`Bad partition size for ${name}`);
    let offset: number | null = offsetText ? parseInt(offsetText, 16) : null;
    if (offsetText && !Number.isFinite(offset)) throw new Error(`Bad partition offset for ${name}`);
    if (offset === null) {
      offset = cursor;
    }
    rows.push({ name, type, subtype, offset, size, flags });
    cursor = offset + size;
  }
  return rows;
}

export function partitionLayoutId(input: {
  partitions: PartitionRow[];
  flashSizeBytes: number;
  bootloaderOffset: number;
  partitionTableOffset: number;
}): string {
  const canonical = [
    `flash=${input.flashSizeBytes}`,
    `bootloader=${input.bootloaderOffset}`,
    `table=${input.partitionTableOffset}`,
    ...input.partitions.map(
      (row) =>
        `${row.name}|${row.type}|${row.subtype}|${row.offset}|${row.size}|${row.flags}`,
    ),
  ].join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export async function loadReferenceLayout(repoRoot: string, profile: BoardProfile) {
  const text = await readFile(path.join(repoRoot, "reference/matter-dht11/partitions.csv"), "utf8");
  const partitions = parsePartitionCsv(text);
  return {
    partitions,
    layoutId: partitionLayoutId({
      partitions,
      flashSizeBytes: profile.flashSizeBytes,
      bootloaderOffset: profile.bootloaderOffset,
      partitionTableOffset: profile.partitionTableOffset,
    }),
  };
}

export function detectGpioConflicts(profile: BoardProfile, pins: PinAssignment[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Map<number, PinAssignment>();
  for (const pin of pins) {
    if (pin.gpio < profile.gpioMin || pin.gpio > profile.gpioMax) {
      issues.push({
        level: "error",
        code: "gpio_out_of_range",
        message: `${pin.pinName} GPIO${pin.gpio} is outside ESP32-H2 GPIO ${profile.gpioMin}-${profile.gpioMax}`,
      });
      continue;
    }
    const reserved = profile.reservedGpio.find((item) => item.gpio === pin.gpio);
    if (reserved) {
      issues.push({
        level: "error",
        code: "gpio_reserved",
        message: `${pin.pinName} cannot use GPIO${pin.gpio}: ${reserved.reason}`,
      });
    }
    const previous = seen.get(pin.gpio);
    if (previous) {
      issues.push({
        level: "error",
        code: "gpio_conflict",
        message: `GPIO${pin.gpio} is assigned to both ${previous.pinName} (${previous.componentId}) and ${pin.pinName} (${pin.componentId})`,
      });
    } else {
      seen.set(pin.gpio, pin);
    }
  }
  return issues;
}

export function renderVersionSdkconfig(versionNumber: number, versionString: string): string {
  if (!Number.isInteger(versionNumber) || versionNumber <= 0) {
    throw new Error("Software version number must be a positive integer");
  }
  if (!/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/.test(versionString)) {
    throw new Error("Software version string contains unsupported characters");
  }
  return [
    `# One version pair for the application description and Matter Basic Information.`,
    `# CONFIG_APP_PROJECT_VER_FROM_CONFIG makes CONFIG_APP_PROJECT_VER the app-description string`,
    `# and CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER the Matter SoftwareVersion.`,
    `CONFIG_APP_PROJECT_VER_FROM_CONFIG=y`,
    `CONFIG_APP_PROJECT_VER="${versionString}"`,
    `CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER=${versionNumber}`,
    `# CMake must repeat both. ota_image_tool.py reads PROJECT_VER and PROJECT_VER_NUMBER.`,
    `# set(PROJECT_VER "${versionString}")`,
    `# set(PROJECT_VER_NUMBER ${versionNumber})`,
    "",
  ].join("\n");
}

export function selectionIssues(
  manifests: ComponentManifest[],
  componentIds: string[],
  mode: "mock" | "native" | "docker",
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map(manifests.map((item) => [item.id, item]));
  for (const id of componentIds) {
    const manifest = byId.get(id);
    if (!manifest) {
      issues.push({ level: "error", code: "unknown_component", message: `Unknown component ${id}` });
      continue;
    }
    if (!manifest.selectableForBuild || manifest.status === "planned" || manifest.status === "template") {
      issues.push({
        level: "error",
        code: "component_not_buildable",
        message: `${manifest.name} is ${manifest.status} and cannot be included in a firmware package`,
      });
      continue;
    }
    if (mode !== "mock" && manifest.firmware?.registerFunction == null && manifest.type !== "core") {
      issues.push({
        level: "error",
        code: "native_component_not_ready",
        message: `${manifest.name} has no modular register function, so it cannot enter a native build`,
      });
    }
  }
  if (mode === "native" || mode === "docker") {
    issues.push({
      level: "error",
      code: "toolchain_mode_unavailable",
      message: `${mode} builds are not available in this release. Use mock mode for a simulated package only.`,
    });
  }
  return issues;
}

export function appFitsPartition(appBytes: number, slotBytes: number): ValidationIssue[] {
  if (appBytes > slotBytes) {
    return [
      {
        level: "error",
        code: "firmware_too_large",
        message: `Application image ${appBytes} bytes exceeds the OTA slot ${slotBytes} bytes`,
      },
    ];
  }
  if (appBytes > slotBytes * 0.9) {
    return [
      {
        level: "warning",
        code: "firmware_near_capacity",
        message: `Application image uses more than 90% of the ${slotBytes}-byte OTA slot`,
      },
    ];
  }
  return [];
}
