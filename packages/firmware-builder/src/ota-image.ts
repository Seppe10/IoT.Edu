import { createHash } from "node:crypto";

const MATTER_OTA_MAGIC = 0x1beef11e;
const ESP_IMAGE_MAGIC = 0xe9;
/** ESP-IDF chip id for ESP32-H2. Read from the application image header. */
export const ESP32H2_CHIP_ID = 16;

export interface MatterOtaInspection {
  ok: boolean;
  error: string | null;
  vendorId: number | null;
  productId: number | null;
  softwareVersion: number | null;
  softwareVersionString: string | null;
  payloadSize: number | null;
  digestValid: boolean;
  chipId: number | null;
  targetsEsp32h2: boolean;
}

/**
 * Read a Matter OTA software image (magic, TLV header, payload digest, ESP image chip id).
 * A failed digest or a truncated header is not reported as a valid image.
 */
export function inspectMatterOtaImage(bytes: Uint8Array): MatterOtaInspection {
  const empty: MatterOtaInspection = {
    ok: false,
    error: null,
    vendorId: null,
    productId: null,
    softwareVersion: null,
    softwareVersionString: null,
    payloadSize: null,
    digestValid: false,
    chipId: null,
    targetsEsp32h2: false,
  };
  if (bytes.length < 16) return { ...empty, error: "The file is too short to be a Matter OTA image." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== MATTER_OTA_MAGIC) {
    return { ...empty, error: "The file does not start with the Matter OTA image identifier." };
  }
  const totalSize = Number(view.getBigUint64(4, true));
  const headerSize = view.getUint32(12, true);
  if (!Number.isSafeInteger(totalSize) || totalSize !== bytes.length) {
    return { ...empty, error: "The Matter OTA total-size field does not match the file length." };
  }
  if (headerSize < 2 || 16 + headerSize > bytes.length) {
    return { ...empty, error: "The Matter OTA header size is outside the file." };
  }
  let fields: HeaderFields;
  try {
    fields = readHeader(bytes.subarray(16, 16 + headerSize));
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : "The Matter OTA header could not be read." };
  }
  if (fields.vendorId == null || fields.productId == null || fields.softwareVersion == null || !fields.softwareVersionString || fields.payloadSize == null || fields.digest == null) {
    return { ...empty, error: "The Matter OTA header is missing vendor, product, version, payload size, or digest." };
  }
  if (fields.digestType !== 1 || fields.digest.length !== 32) {
    return {
      ...empty,
      vendorId: fields.vendorId,
      productId: fields.productId,
      softwareVersion: fields.softwareVersion,
      softwareVersionString: fields.softwareVersionString,
      payloadSize: fields.payloadSize,
      error: "The image digest is not a SHA-256 value.",
    };
  }
  const payloadStart = 16 + headerSize;
  if (payloadStart + fields.payloadSize !== bytes.length) {
    return { ...empty, error: "The payload size does not account for every byte after the header." };
  }
  const payload = bytes.subarray(payloadStart, payloadStart + fields.payloadSize);
  const digest = createHash("sha256").update(payload).digest();
  const digestValid = digest.length === fields.digest.length && digest.every((byte, index) => byte === fields.digest?.[index]);
  const chipId = payload.length >= 14 && payload[0] === ESP_IMAGE_MAGIC ? payload[12]! | (payload[13]! << 8) : null;
  const targetsEsp32h2 = chipId === ESP32H2_CHIP_ID;
  const error = !digestValid
    ? "The payload digest does not match the SHA-256 in the Matter OTA header."
    : chipId == null
      ? "The payload is not an ESP application image."
      : null;
  return {
    ok: digestValid && targetsEsp32h2 && error == null,
    error,
    vendorId: fields.vendorId,
    productId: fields.productId,
    softwareVersion: fields.softwareVersion,
    softwareVersionString: fields.softwareVersionString,
    payloadSize: fields.payloadSize,
    digestValid,
    chipId,
    targetsEsp32h2,
  };
}

/** Build a small Matter OTA image for tests. The payload is an ESP image header, not a bootable firmware. */
export function encodeMatterOtaImage(input: {
  vendorId: number;
  productId: number;
  softwareVersion: number;
  softwareVersionString: string;
  chipId?: number;
  corruptDigest?: boolean;
}): Uint8Array {
  const payload = new Uint8Array(64);
  payload[0] = ESP_IMAGE_MAGIC;
  const chipId = input.chipId ?? ESP32H2_CHIP_ID;
  payload[12] = chipId & 0xff;
  payload[13] = (chipId >> 8) & 0xff;
  const digest = createHash("sha256").update(payload).digest();
  if (input.corruptDigest) digest[0] = (digest[0] ?? 0) ^ 0xff;
  const version = Buffer.from(input.softwareVersionString, "utf8");
  const header = Buffer.concat([
    Buffer.from([0x15]),
    Buffer.from([0x25, 0x00, input.vendorId & 0xff, (input.vendorId >> 8) & 0xff]),
    Buffer.from([0x25, 0x01, input.productId & 0xff, (input.productId >> 8) & 0xff]),
    uint32Field(0x02, input.softwareVersion),
    Buffer.from([0x2c, 0x03, version.length]),
    version,
    uint32Field(0x04, payload.length),
    Buffer.from([0x24, 0x08, 0x01, 0x30, 0x09, digest.length]),
    digest,
    Buffer.from([0x18]),
  ]);
  const file = Buffer.alloc(16 + header.length + payload.length);
  file.writeUInt32LE(MATTER_OTA_MAGIC, 0);
  file.writeBigUInt64LE(BigInt(file.length), 4);
  file.writeUInt32LE(header.length, 12);
  header.copy(file, 16);
  Buffer.from(payload).copy(file, 16 + header.length);
  return file;
}

interface HeaderFields {
  vendorId: number | null;
  productId: number | null;
  softwareVersion: number | null;
  softwareVersionString: string | null;
  payloadSize: number | null;
  digestType: number | null;
  digest: Uint8Array | null;
}

function readHeader(header: Uint8Array): HeaderFields {
  let offset = 0;
  const control = header[offset];
  if (control !== 0x15) throw new Error("The Matter OTA header is not a TLV structure.");
  offset += 1;
  const fields: HeaderFields = {
    vendorId: null,
    productId: null,
    softwareVersion: null,
    softwareVersionString: null,
    payloadSize: null,
    digestType: null,
    digest: null,
  };
  while (offset < header.length) {
    const element = header[offset];
    if (element === undefined) break;
    if (element === 0x18) return fields;
    const tagControl = element & 0xe0;
    const kind = element & 0x1f;
    offset += 1;
    if (tagControl !== 0x20) throw new Error("The Matter OTA header uses a TLV tag this reader does not accept.");
    const tag = header[offset];
    if (tag === undefined) throw new Error("The Matter OTA header ended inside a TLV tag.");
    offset += 1;
    const value = readValue(header, kind, offset);
    offset = value.next;
    if (tag === 0) fields.vendorId = value.number;
    if (tag === 1) fields.productId = value.number;
    if (tag === 2) fields.softwareVersion = value.number;
    if (tag === 3) fields.softwareVersionString = value.text;
    if (tag === 4) fields.payloadSize = value.number;
    if (tag === 8) fields.digestType = value.number;
    if (tag === 9) fields.digest = value.bytes;
  }
  throw new Error("The Matter OTA header did not end.");
}

function readValue(bytes: Uint8Array, kind: number, offset: number): { next: number; number: number | null; text: string | null; bytes: Uint8Array | null } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const unsigned = (width: number) => {
    if (offset + width > bytes.length) throw new Error("The Matter OTA header ended inside a number.");
    if (width === 1) return { next: offset + 1, number: bytes[offset] ?? null, text: null, bytes: null };
    if (width === 2) return { next: offset + 2, number: view.getUint16(offset, true), text: null, bytes: null };
    if (width === 4) return { next: offset + 4, number: view.getUint32(offset, true), text: null, bytes: null };
    const wide = view.getBigUint64(offset, true);
    if (wide > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("A Matter OTA header number does not fit a safe integer.");
    return { next: offset + 8, number: Number(wide), text: null, bytes: null };
  };
  if (kind === 0x04) return unsigned(1);
  if (kind === 0x05) return unsigned(2);
  if (kind === 0x06) return unsigned(4);
  if (kind === 0x07) return unsigned(8);
  if (kind === 0x0c || kind === 0x10) {
    const length = bytes[offset];
    if (length === undefined || offset + 1 + length > bytes.length) throw new Error("The Matter OTA header ended inside a string.");
    const slice = bytes.subarray(offset + 1, offset + 1 + length);
    return {
      next: offset + 1 + length,
      number: null,
      text: kind === 0x0c ? Buffer.from(slice).toString("utf8") : null,
      bytes: kind === 0x10 ? slice : null,
    };
  }
  throw new Error(`The Matter OTA header contains an unsupported TLV type ${kind}.`);
}

function uint32Field(tag: number, value: number): Buffer {
  const buffer = Buffer.alloc(6);
  buffer[0] = 0x26;
  buffer[1] = tag;
  buffer.writeUInt32LE(value, 2);
  return buffer;
}
