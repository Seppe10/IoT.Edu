import { inflateRawSync } from "node:zlib";
import { safeRelativePath } from "./library-paths.js";

const MAX_ARCHIVE_BYTES = 2_000_000;
const MAX_ENTRIES = 64;
const MAX_FILE_BYTES = 200_000;
const MAX_TOTAL_BYTES = 2_000_000;
const REJECTED_EXTENSIONS = new Set([".sh", ".py", ".exe", ".bat", ".command", ".ps1", ".bin", ".elf", ".so", ".dylib"]);

export class UnsafeArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeArchiveError";
  }
}

export function zipCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

export interface ExtractedArchiveFile {
  name: string;
  data: Buffer;
}

export function extractSafeZip(archive: Buffer): ExtractedArchiveFile[] {
  if (archive.length === 0 || archive.length > MAX_ARCHIVE_BYTES) {
    throw new UnsafeArchiveError("The ZIP archive is empty or larger than 2 MB. Upload source files only. ESP-IDF build output and managed components are not a reusable component.");
  }
  const eocd = findEocd(archive);
  if (eocd < 0) throw new UnsafeArchiveError("The ZIP archive has no central directory.");
  const entries = archive.readUInt16LE(eocd + 10);
  const directorySize = archive.readUInt32LE(eocd + 12);
  const directoryOffset = archive.readUInt32LE(eocd + 16);
  if (entries === 0) throw new UnsafeArchiveError("The ZIP archive contains no files.");
  if (entries > MAX_ENTRIES) throw new UnsafeArchiveError("The ZIP archive contains too many files.");
  if (directoryOffset > archive.length || directorySize > archive.length - directoryOffset) {
    throw new UnsafeArchiveError("The ZIP central directory is outside the archive.");
  }

  const files: ExtractedArchiveFile[] = [];
  let cursor = directoryOffset;
  let total = 0;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new UnsafeArchiveError("The ZIP central directory is incomplete.");
    }
    const versionMade = archive.readUInt16LE(cursor + 4);
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const crc = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const external = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > archive.length) throw new UnsafeArchiveError("A ZIP entry name is outside the archive.");
    const name = archive.toString("utf8", nameStart, nameEnd);
    cursor = nameEnd + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    const decision = archiveDecision(name);
    if (decision === "skip") continue;
    if (decision === "reject") {
      const escaped = name.includes("..") || name.startsWith("/") || name.includes("\\") || name.includes("\0");
      throw new UnsafeArchiveError(
        escaped
          ? "The archive contains a file path that escapes the component directory."
          : `“${name.split("/").pop()}” inside the archive is not an allowed source file.`,
      );
    }
    if ((flags & 0x1) !== 0) throw new UnsafeArchiveError("Encrypted ZIP entries are not allowed.");
    if ((flags & 0x8) !== 0) throw new UnsafeArchiveError("ZIP data descriptors are not allowed.");
    if (method !== 0 && method !== 8) throw new UnsafeArchiveError("Only stored and deflated ZIP entries are allowed.");
    const operatingSystem = versionMade >>> 8;
    if (operatingSystem === 3 && ((external >>> 16) & 0o170000) === 0o120000) {
      throw new UnsafeArchiveError("Symbolic links inside a ZIP archive are not allowed.");
    }
    if (uncompressedSize > MAX_FILE_BYTES || compressedSize > MAX_ARCHIVE_BYTES) {
      throw new UnsafeArchiveError("A ZIP entry is larger than 200 kB.");
    }
    total += uncompressedSize;
    if (total > MAX_TOTAL_BYTES) throw new UnsafeArchiveError("The unpacked ZIP archive is larger than 2 MB.");
    files.push(readLocal(archive, localOffset, name, method, crc, compressedSize, uncompressedSize));
  }
  if (files.length === 0) throw new UnsafeArchiveError("The ZIP archive contains no source files.");
  return files;
}

function archiveDecision(name: string): "keep" | "skip" | "reject" {
  const normalised = name.replace(/\\/g, "/");
  if (normalised.includes("..") || normalised.startsWith("/") || normalised.includes("\0")) return "reject";
  const parts = normalised.split("/").filter((part) => part.length > 0);
  if (parts.some((part) => part === "__MACOSX" || part === "build" || part === "managed_components" || part === ".git" || part === ".vscode" || part === "backup" || part.startsWith("."))) {
    return "skip";
  }
  const base = parts[parts.length - 1] ?? "";
  const extension = base.includes(".") ? base.slice(base.lastIndexOf(".")).toLowerCase() : "";
  if (REJECTED_EXTENSIONS.has(extension)) return "reject";
  return safeRelativePath(normalised) ? "keep" : "skip";
}

function readLocal(
  archive: Buffer,
  offset: number,
  name: string,
  method: number,
  crc: number,
  compressedSize: number,
  uncompressedSize: number,
): ExtractedArchiveFile {
  if (offset + 30 > archive.length || archive.readUInt32LE(offset) !== 0x04034b50) {
    throw new UnsafeArchiveError("A ZIP local header is missing.");
  }
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const localName = archive.toString("utf8", offset + 30, offset + 30 + nameLength);
  if (localName !== name) throw new UnsafeArchiveError("A ZIP entry name does not match its local header.");
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > archive.length) throw new UnsafeArchiveError("A ZIP entry extends outside the archive.");
  const compressed = archive.subarray(dataStart, dataEnd);
  const data = method === 0 ? Buffer.from(compressed) : inflate(compressed, uncompressedSize);
  if (data.length !== uncompressedSize) throw new UnsafeArchiveError("A ZIP entry expanded to an unexpected size.");
  if (zipCrc32(data) !== crc) throw new UnsafeArchiveError("A ZIP entry failed its checksum.");
  return { name, data };
}

function inflate(compressed: Buffer, expected: number): Buffer {
  try {
    const data = inflateRawSync(compressed);
    if (data.length > expected || data.length > MAX_FILE_BYTES) {
      throw new UnsafeArchiveError("A ZIP entry expanded beyond its declared size.");
    }
    return data;
  } catch (error) {
    if (error instanceof UnsafeArchiveError) throw error;
    throw new UnsafeArchiveError("A ZIP entry could not be unpacked.");
  }
}

function findEocd(archive: Buffer): number {
  const minimum = Math.max(0, archive.length - 22 - 65_535);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}
