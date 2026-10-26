import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DOWNLOAD_MODE_WARNING,
  ERASE_WARNING,
  type DeviceSecurity,
  type EraseAssessment,
  type FlashBackupRecord,
  type FlashRegionBackup,
  type RecoveryBlocker,
} from "@iotedu/contracts";

const PARTITION_MAGIC = 0x50aa;
const ESP32H2_IMAGE_CHIP_ID = 16;

export interface NamedPartition {
  name: string;
  type: number;
  subtype: number;
  offset: number;
  size: number;
}

export interface DeviceEvidence {
  chip: string;
  revision: string;
  mac: string | null;
  flashSizeBytes: number | null;
  flashMode: string;
  flashFrequency: string;
  partitions: NamedPartition[] | null;
  security: DeviceSecurity;
  bootloaderCompatible: boolean | null;
}

export interface PackageReadiness {
  ready: boolean;
  buildId: string | null;
  detail: string;
  credentialMode: "example_dac" | "secure_cert" | "unknown";
  issues: RecoveryBlocker[];
}

export function macFromChipText(text: string): string | null {
  const base = text.match(/BASE MAC:\s*([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i)?.[1];
  if (base) return normalizeMac(base);
  for (const line of text.split("\n")) {
    if (/MAC_EXT|ff:fe/i.test(line)) continue;
    const match = line.match(/MAC:\s*([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i);
    if (match?.[1]) return normalizeMac(match[1]);
  }
  return null;
}

export function normalizeMac(value: string): string | null {
  const compact = value.trim().toLowerCase().replace(/-/g, "");
  if (/^[0-9a-f]{12}$/.test(compact)) return compact.match(/.{2}/g)!.join(":");
  if (/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(value.trim().toLowerCase())) return value.trim().toLowerCase();
  return null;
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function classifyPartition(name: string): FlashRegionBackup["classification"] {
  if (name === "nvs_keys") return "provisioning";
  if (name === "phy_init") return "calibration";
  if (name === "esp_secure_cert" || name === "fctry" || /secure.?cert|factory|provision/i.test(name)) return "factory";
  if (name === "bootloader" || name === "partition-table") return "firmware";
  return "operational";
}

export function regionIsBlank(bytes: Buffer): boolean {
  for (const value of bytes) {
    if (value !== 0xff) return false;
  }
  return true;
}

export function encodeBootHeader(input: { mode: number; speed: number; size: number; chipId?: number }): Buffer {
  const bytes = Buffer.alloc(24, 0xff);
  bytes[0] = 0xe9;
  bytes[1] = 1;
  bytes[2] = input.mode;
  bytes[3] = ((input.size & 0x0f) << 4) | (input.speed & 0x0f);
  bytes.writeUInt16LE(input.chipId ?? ESP32H2_IMAGE_CHIP_ID, 12);
  return bytes;
}

export function parseBootHeader(bytes: Buffer): { mode: string; frequency: string; sizeBytes: number | null; chipId: number | null; compatible: boolean } {
  if (bytes.length < 16 || bytes[0] !== 0xe9) {
    return { mode: "unknown", frequency: "unknown", sizeBytes: null, chipId: null, compatible: false };
  }
  const mode = ({ 0: "qio", 1: "qout", 2: "dio", 3: "dout" } as Record<number, string>)[bytes[2]!] ?? "unknown";
  const speedNibble = bytes[3]! & 0x0f;
  const sizeNibble = (bytes[3]! >> 4) & 0x0f;
  const frequency = ({ 0: "64m", 1: "32m", 2: "16m", 0xf: "48m" } as Record<number, string>)[speedNibble] ?? "unknown";
  const sizeBytes = ({ 0: 1, 1: 2, 2: 4, 3: 8, 4: 16 } as Record<number, number>)[sizeNibble];
  const chipId = bytes.readUInt16LE(12);
  return {
    mode,
    frequency,
    sizeBytes: sizeBytes ? sizeBytes * 1024 * 1024 : null,
    chipId,
    compatible: chipId === ESP32H2_IMAGE_CHIP_ID,
  };
}

export function encodePartitionTable(rows: NamedPartition[]): Buffer {
  const bytes = Buffer.alloc((rows.length + 1) * 32, 0xff);
  rows.forEach((row, index) => {
    const entry = bytes.subarray(index * 32, (index + 1) * 32);
    entry.writeUInt16LE(PARTITION_MAGIC, 0);
    entry.writeUInt8(row.type, 2);
    entry.writeUInt8(row.subtype, 3);
    entry.writeUInt32LE(row.offset, 4);
    entry.writeUInt32LE(row.size, 8);
    entry.fill(0, 12, 28);
    entry.write(row.name, 12, 16, "utf8");
  });
  return bytes;
}

export function parsePartitionTable(bytes: Buffer): NamedPartition[] | null {
  if (bytes.length < 32) return null;
  const rows: NamedPartition[] = [];
  for (let offset = 0; offset + 32 <= bytes.length; offset += 32) {
    const magic = bytes.readUInt16LE(offset);
    if (magic === 0xffff || bytes[offset] === 0xff) break;
    if (magic !== PARTITION_MAGIC) return rows.length > 0 ? rows : null;
    const label = bytes.subarray(offset + 12, offset + 28);
    const labelEnd = label.findIndex((value) => value === 0 || value === 0xff);
    const name = label.subarray(0, labelEnd === -1 ? label.length : labelEnd).toString("utf8").trim();
    const size = bytes.readUInt32LE(offset + 8);
    const start = bytes.readUInt32LE(offset + 4);
    if (!name || size === 0 || !Number.isSafeInteger(start)) return null;
    rows.push({
      name,
      type: bytes[offset + 2]!,
      subtype: bytes[offset + 3]!,
      offset: start,
      size,
    });
    if (rows.length > 32) return null;
  }
  return rows.length > 0 ? rows : null;
}

function fuseValue(text: string, name: string): string | null {
  return fuseRecord(text, name)?.value ?? null;
}

function fuseRecord(text: string, name: string): { value: string; bits: string | null } | null {
  const match = text.match(new RegExp(`^\\s*${name}\\b[^\\n]*=\\s*(\\S+)([^\\n]*)$`, "im"));
  if (!match?.[1]) return null;
  return { value: match[1], bits: match[2]?.match(/\(0b([01]+)\)/)?.[1] ?? null };
}

function fuseDisabled(value: string | null): boolean | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "false" || normalized === "0" || /^0b0+$/.test(normalized)) return true;
  if (normalized === "true" || /^0b0*1/.test(normalized)) return false;
  const numeric = Number(normalized);
  if (Number.isInteger(numeric)) return numeric === 0;
  return null;
}

function encryptionDisabled(record: { value: string; bits: string | null } | null): boolean | null {
  if (!record) return null;
  const bits = record.bits ?? (/^[0-9]+$/.test(record.value) ? Number(record.value).toString(2) : null);
  if (bits && /^[01]+$/.test(bits)) {
    const ones = [...bits].filter((bit) => bit === "1").length;
    return ones % 2 === 0;
  }
  const word = record.value.toLowerCase();
  if (word === "disable" || word === "disabled") return true;
  if (word === "enable" || word === "enabled") return false;
  return fuseDisabled(record.value);
}

export function parseSecuritySummary(text: string): DeviceSecurity {
  const secureOff = fuseDisabled(fuseValue(text, "SECURE_BOOT_EN"));
  const cryptOff = encryptionDisabled(fuseRecord(text, "SPI_BOOT_CRYPT_CNT"));
  const downloadOff = fuseDisabled(fuseValue(text, "DIS_DOWNLOAD_MODE"));
  const usbOff = fuseDisabled(fuseValue(text, "DIS_USB_JTAG") ?? fuseValue(text, "DIS_USB_SERIAL_JTAG"));
  const secureBoot = secureOff == null ? "unknown" : secureOff ? "disabled" : "enabled";
  const flashEncryption = cryptOff == null ? "unknown" : cryptOff ? "disabled" : "enabled";
  const downloadMode = downloadOff == null ? "unknown" : downloadOff ? "allowed" : "disabled";
  const usbDownload = usbOff == null ? "unknown" : usbOff ? "allowed" : "disabled";
  const known = [secureBoot, flashEncryption, downloadMode, usbDownload].every((item) => item !== "unknown");
  const reflashable = known && secureBoot === "disabled" && flashEncryption === "disabled" && downloadMode === "allowed" && usbDownload === "allowed";
  const detail = reflashable
    ? "Secure Boot is disabled, flash encryption is disabled, and USB download mode is allowed. No eFuse was changed."
    : !known
      ? "Security fuses were not fully readable. sdkconfig is not used as a substitute. Full Flash Erase stays unavailable."
      : "This chip cannot be safely erased and reflashed with a plaintext package. No eFuse was changed.";
  return { known, secureBoot, flashEncryption, downloadMode, usbDownload, reflashable, detail };
}

export function parseDeviceEvidence(input: {
  chipText: string;
  flashText: string;
  securityText: string;
  partitionTable: Buffer | null;
  bootHeader: Buffer | null;
}): DeviceEvidence {
  const chip = input.chipText.match(/Chip is\s+([A-Za-z0-9-]+)/)?.[1] ?? "unknown";
  const revision = input.chipText.match(/revision\s+(v[\d.]+)/i)?.[1] ?? "unknown";
  const mac = macFromChipText(input.chipText);
  const flashMb = input.flashText.match(/(?:Detected flash size|Flash size)\s*:\s*(\d+)\s*MB/i)?.[1];
  const header = input.bootHeader ? parseBootHeader(input.bootHeader) : null;
  const flashFromHeader = header?.sizeBytes ?? null;
  const flashSizeBytes = flashMb ? Number(flashMb) * 1024 * 1024 : flashFromHeader;
  return {
    chip,
    revision,
    mac,
    flashSizeBytes,
    flashMode: header?.mode ?? "unknown",
    flashFrequency: header?.frequency ?? "unknown",
    partitions: input.partitionTable ? parsePartitionTable(input.partitionTable) : null,
    security: parseSecuritySummary(input.securityText),
    bootloaderCompatible: header ? header.compatible : null,
  };
}

export function credentialMode(sdkconfig: string | null): PackageReadiness["credentialMode"] {
  if (!sdkconfig) return "unknown";
  if (/^CONFIG_SEC_CERT_DAC_PROVIDER=y$/m.test(sdkconfig)) return "secure_cert";
  if (/^CONFIG_EXAMPLE_DAC_PROVIDER=y$/m.test(sdkconfig) && /^# CONFIG_SEC_CERT_DAC_PROVIDER is not set$/m.test(sdkconfig)) {
    return "example_dac";
  }
  return "unknown";
}

export function inspectPackageForRecovery(input: {
  buildId: string | null;
  planOk: boolean;
  planDetail: string;
  bootloader: Buffer | null;
  application: Buffer | null;
  sdkconfig: string | null;
  hashesOk: boolean;
  hashDetail: string;
  packageFlashBytes: number;
  deviceFlashBytes: number | null;
  partitionEnd: number | null;
}): PackageReadiness {
  const issues: RecoveryBlocker[] = [];
  const mode = credentialMode(input.sdkconfig);
  const boot = input.bootloader ? parseBootHeader(input.bootloader) : null;
  const appHeader = input.application ? parseBootHeader(input.application) : null;
  if (!input.buildId) {
    issues.push({ code: "firmware_package", message: "No firmware package is selected.", action: "Select firmware 1.3.0 or another compiled ESP32-H2 package." });
  }
  if (!input.hashesOk) {
    issues.push({ code: "firmware_checksum", message: input.hashDetail, action: "Select a package whose files match the recorded checksums." });
  }
  if (!input.planOk) {
    issues.push({ code: "firmware_plan", message: input.planDetail, action: "Select a complete four-image ESP32-H2 package." });
  }
  if (!boot?.compatible) {
    issues.push({ code: "bootloader_incompatible", message: "The package bootloader is not an ESP32-H2 image.", action: "Select a package built for ESP32-H2." });
  }
  if (!appHeader || appHeader.chipId !== ESP32H2_IMAGE_CHIP_ID) {
    issues.push({ code: "application_incompatible", message: "The application image is not an ESP32-H2 image.", action: "Select a package whose application image matches this chip." });
  }
  if (input.deviceFlashBytes != null && input.deviceFlashBytes !== input.packageFlashBytes) {
    issues.push({
      code: "flash_size_mismatch",
      message: `The chip reports ${input.deviceFlashBytes} bytes and the package expects ${input.packageFlashBytes} bytes.`,
      action: "Connect the ESP32-H2 this package was built for.",
    });
  }
  if (input.partitionEnd != null && input.deviceFlashBytes != null && input.partitionEnd > input.deviceFlashBytes) {
    issues.push({
      code: "partition_exceeds_flash",
      message: "The package partition table extends past the chip flash.",
      action: "Select a package whose partition table fits this flash.",
    });
  }
  if (mode === "secure_cert") {
    issues.push({
      code: "secure_cert_required",
      message: "This package reads manufacturing credentials from the secure-cert partition. First-time installation does not restore that partition.",
      action: "Select a package that carries its own development credentials, or restore the backed-up partition with a separate confirmed write.",
    });
  } else if (mode === "unknown") {
    issues.push({
      code: "credential_mode_unknown",
      message: "The package does not say whether it uses embedded development credentials or the secure-cert partition.",
      action: "Select a package whose credential source is recorded in its sdkconfig.",
    });
  }
  const ready = issues.length === 0;
  const detail = ready
    ? mode === "example_dac"
      ? "The four-image package matches ESP32-H2 and embeds example Device Attestation Credentials. The secure-cert partition is not used by this firmware."
      : "The package is ready to reinstall."
    : issues[0]?.message ?? "The package cannot be reinstalled.";
  return { ready, buildId: input.buildId, detail, credentialMode: mode, issues };
}

function blocker(code: string, message: string, action: string): RecoveryBlocker {
  return { code, message, action };
}

export function assessEraseReadiness(input: {
  portConnected: boolean;
  port: string | null;
  consolePort: string | null;
  toolchainAvailable: boolean;
  toolchainDetail: string;
  evidence: DeviceEvidence | null;
  backup: FlashBackupRecord | null;
  packageReady: PackageReadiness;
  previouslyCommissioned?: boolean;
}): EraseAssessment {
  const blockers: RecoveryBlocker[] = [];
  void input.previouslyCommissioned;
  if (!input.portConnected || !input.port) {
    blockers.push(blocker("device_disconnected", "No programming port is connected.", "Connect the ESP32-H2 and choose its programming port."));
  }
  if (input.port && input.consolePort && input.port === input.consolePort) {
    blockers.push(blocker("port_conflict", "The programming port and the console port are the same device.", "Choose the USB programming port and a different console port."));
  }
  if (!input.toolchainAvailable) {
    blockers.push(blocker("toolchain_not_configured", input.toolchainDetail, "Install ESP-IDF v5.4.1 or start IoT.Edu where that toolchain can be discovered."));
  }
  const evidence = input.evidence;
  if (!evidence || evidence.chip !== "ESP32-H2" || !evidence.mac || !evidence.flashSizeBytes) {
    blockers.push(blocker(
      "device_unidentified",
      evidence ? `The connected chip is ${evidence.chip}. A base MAC and flash size are required.` : "The chip has not been identified.",
      "Inspect the connected ESP32-H2 again and choose the programming port.",
    ));
  }
  if (!evidence || !evidence.security.reflashable) {
    blockers.push(blocker(
      "security_unknown",
      evidence?.security.detail ?? "Security status is unknown, so the chip was not treated as recoverable.",
      "Read the eFuse summary again. IoT.Edu will not burn eFuses, and it will not erase while any required fuse is unknown or set.",
    ));
  }
  blockers.push(...input.packageReady.issues);
  const backup = input.backup;
  const protectedRegions = (evidence?.partitions ?? []).filter((row) => {
    const kind = classifyPartition(row.name);
    return kind === "factory" || kind === "provisioning" || kind === "calibration" || kind === "operational";
  });
  const backupMatches = Boolean(
    backup?.verified
    && backup.suitableForRestore
    && evidence?.mac
    && backup.mac === evidence.mac
    && evidence.flashSizeBytes
    && backup.flashSizeBytes === evidence.flashSizeBytes,
  );
  if (!backupMatches) {
    blockers.push(blocker(
      "backup_missing",
      "There is no verified backup for this chip.",
      "Create a backup before erase. The backup must match this MAC address and pass its integrity check.",
    ));
  } else if (backup && evidence?.partitions) {
    for (const region of protectedRegions) {
      const saved = backup.regions.find((item) => item.name === region.name && item.offset === region.offset && item.size === region.size);
      if (!saved) {
        blockers.push(blocker(
          "backup_incomplete",
          `The backup does not include ${region.name} at 0x${region.offset.toString(16)}.`,
          "Create a new backup from the current partition layout.",
        ));
      }
    }
    if (!backup.complete && evidence.partitions == null) {
      blockers.push(blocker(
        "layout_unknown",
        "The partition table could not be read and the backup is not a complete flash image.",
        "Read the whole flash, or stop. Unnamed factory data cannot be declared disposable.",
      ));
    }
  } else if (backupMatches && evidence && evidence.partitions == null && !backup?.complete) {
    blockers.push(blocker(
      "layout_unknown",
      "The partition table could not be read and the backup is not a complete flash image.",
      "Read the whole flash before erase.",
    ));
  }
  const device = evidence && input.port ? {
    connected: input.portConnected,
    chip: evidence.chip,
    revision: evidence.revision,
    mac: evidence.mac,
    flashSizeBytes: evidence.flashSizeBytes,
    flashMode: evidence.flashMode,
    flashFrequency: evidence.flashFrequency,
    partitionLabels: evidence.partitions?.map((row) => row.name) ?? [],
    partitionLayoutKnown: evidence.partitions != null,
    programmingPort: input.port,
  } : null;
  return {
    enabled: blockers.length === 0,
    blockers,
    downloadModeWarning: DOWNLOAD_MODE_WARNING,
    port: input.port,
    consolePort: input.consolePort,
    device,
    security: evidence?.security ?? null,
    backup: backupMatches ? backup : backup?.mac === evidence?.mac ? backup : null,
    firmware: {
      ready: input.packageReady.ready,
      buildId: input.packageReady.buildId,
      detail: input.packageReady.detail,
      credentialMode: input.packageReady.credentialMode,
    },
    toolchain: { available: input.toolchainAvailable, detail: input.toolchainDetail },
    previouslyCommissionedBlocksErase: false,
  };
}

export function flashBackupRoot(home: string, platform = process.platform): string {
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "IoT.Edu", "flash-backups");
  if (platform === "win32") return path.join(home, "AppData", "Roaming", "IoT.Edu", "flash-backups");
  return path.join(home, ".local", "share", "iotedu", "flash-backups");
}

function regionRecord(name: string, offset: number, size: number, bytes: Buffer, credentialModeName: PackageReadiness["credentialMode"]): FlashRegionBackup {
  const classification = classifyPartition(name);
  const state = regionIsBlank(bytes) ? "blank" : "present";
  const requiredForPackage = classification === "factory" && credentialModeName === "secure_cert" && name === "esp_secure_cert";
  return { name, offset, size, sha256: sha256(bytes), classification, state, requiredForPackage };
}

export async function createFlashBackup(input: {
  evidence: DeviceEvidence;
  packageReady: PackageReadiness;
  backupRoot: string;
  buildId: string;
  image: Buffer;
  now?: string;
}): Promise<FlashBackupRecord> {
  if (!input.evidence.mac || !input.evidence.flashSizeBytes) {
    throw new Error("A backup needs a verified MAC address and flash size.");
  }
  if (input.image.length !== input.evidence.flashSizeBytes) {
    throw new Error("The flash image length does not match the detected flash size.");
  }
  const id = randomUUID();
  const directory = path.join(input.backupRoot, input.evidence.mac.replace(/:/g, ""), id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const imageHash = sha256(input.image);
  await writeFile(path.join(directory, "flash.bin"), input.image, { mode: 0o600 });
  const savedImage = await readFile(path.join(directory, "flash.bin"));
  if (sha256(savedImage) !== imageHash || savedImage.length !== input.image.length) {
    throw new Error("The saved flash image failed its integrity check.");
  }
  const partitions = input.evidence.partitions ?? [];
  const regions = partitions.map((row) => {
    if (row.offset + row.size > input.image.length) {
      throw new Error(`Partition ${row.name} extends past the flash image.`);
    }
    return regionRecord(row.name, row.offset, row.size, input.image.subarray(row.offset, row.offset + row.size), input.packageReady.credentialMode);
  });
  for (const region of regions) {
    const file = path.join(directory, `${region.name}.bin`);
    const bytes = input.image.subarray(region.offset, region.offset + region.size);
    await writeFile(file, bytes, { mode: 0o600 });
    const reread = await readFile(file);
    if (sha256(reread) !== region.sha256) throw new Error(`The saved ${region.name} region failed its integrity check.`);
  }
  const tableBytes = input.evidence.partitions ? encodePartitionTable(input.evidence.partitions) : Buffer.alloc(0);
  const record: FlashBackupRecord = {
    id,
    mac: input.evidence.mac,
    chip: input.evidence.chip,
    revision: input.evidence.revision,
    flashSizeBytes: input.evidence.flashSizeBytes,
    flashMode: input.evidence.flashMode,
    flashFrequency: input.evidence.flashFrequency,
    createdAt: input.now ?? new Date().toISOString(),
    location: directory,
    verified: true,
    suitableForRestore: true,
    complete: true,
    credentialMode: input.packageReady.credentialMode,
    firmwareBuildId: input.buildId,
    regions,
    partitionTableSha256: sha256(tableBytes),
  };
  const manifest = `${JSON.stringify(record, null, 2)}\n`;
  if (/private key|passcode|spake2p|thread dataset/i.test(manifest)) {
    throw new Error("The backup manifest included sensitive text and was not saved.");
  }
  await writeFile(path.join(directory, "manifest.json"), manifest, { mode: 0o600 });
  const checked = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as FlashBackupRecord;
  if (checked.id !== id || checked.mac !== record.mac || checked.regions.some((region, index) => region.sha256 !== regions[index]?.sha256)) {
    throw new Error("The backup manifest did not match the saved flash image.");
  }
  return checked;
}

export async function loadBackup(directory: string): Promise<FlashBackupRecord | null> {
  try {
    const record = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as FlashBackupRecord;
    const image = await readFile(path.join(directory, "flash.bin"));
    if (image.length !== record.flashSizeBytes) return { ...record, verified: false, suitableForRestore: false };
    for (const region of record.regions) {
      const slice = image.subarray(region.offset, region.offset + region.size);
      if (slice.length !== region.size || sha256(slice) !== region.sha256) {
        return { ...record, verified: false, suitableForRestore: false };
      }
    }
    return { ...record, verified: true, suitableForRestore: record.complete };
  } catch {
    return null;
  }
}

export async function latestBackupForMac(root: string, mac: string): Promise<FlashBackupRecord | null> {
  const directory = path.join(root, mac.replace(/:/g, ""));
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch {
    return null;
  }
  const records: FlashBackupRecord[] = [];
  for (const name of names) {
    if (name.includes("..") || name.includes("/")) continue;
    const loaded = await loadBackup(path.join(directory, name));
    if (loaded && loaded.mac === mac) records.push(loaded);
  }
  records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return records.find((record) => record.verified) ?? records[0] ?? null;
}

export function samplesAreBlank(samples: Buffer[]): boolean {
  return samples.length > 0 && samples.every(regionIsBlank);
}

export function eraseWarning(): string {
  return ERASE_WARNING;
}

export async function archiveBackup(directory: string): Promise<Buffer> {
  const names = (await readdir(directory)).filter((name) => !name.includes("..") && !name.includes("/") && !name.startsWith(".")).sort();
  const chunks: Buffer[] = [];
  for (const name of names) {
    const bytes = await readFile(path.join(directory, name));
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, Math.min(name.length, 100), "utf8");
    octal(0o600, 8).copy(header, 100);
    octal(0, 8).copy(header, 108);
    octal(0, 8).copy(header, 116);
    octal(bytes.length, 12).copy(header, 124);
    octal(0, 12).copy(header, 136);
    header.write("        ", 148, 8, "utf8");
    header[156] = "0".charCodeAt(0);
    let sum = 0;
    for (const value of header) sum += value;
    const checksum = Buffer.alloc(8, 0);
    checksum.write(sum.toString(8).padStart(6, "0"));
    checksum[6] = 0;
    checksum[7] = 0x20;
    checksum.copy(header, 148);
    const pad = (512 - (bytes.length % 512)) % 512;
    chunks.push(header, bytes, Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

function octal(value: number, length: number): Buffer {
  const bytes = Buffer.alloc(length, 0);
  bytes.write(value.toString(8).padStart(length - 1, "0"));
  return bytes;
}

export async function findBackup(root: string, id: string): Promise<FlashBackupRecord | null> {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) return null;
  let macDirs: string[] = [];
  try {
    macDirs = await readdir(root);
  } catch {
    return null;
  }
  for (const macDir of macDirs) {
    if (macDir.includes("..")) continue;
    const loaded = await loadBackup(path.join(root, macDir, id));
    if (loaded?.id === id) return loaded;
  }
  return null;
}
