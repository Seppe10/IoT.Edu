import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { MatterOperationError } from "./errors.js";

export const IDENTITY_FILE = "identity.json";
const STORAGE_DIR_NAME = "matter-controller";

export interface StoredIdentity {
  version: 1;
  createdAt: string;
  fabricLabel: string;
  matterJsVersion: string;
  fabricId: string | null;
  credentialId: string | null;
  controllerNodeId: string | null;
}

export type IdentityInspection =
  | { state: "absent"; directory: string }
  | { state: "ready"; directory: string; identity: StoredIdentity }
  | { state: "corrupt"; directory: string; message: string }
  | { state: "blocked"; directory: string; message: string };

export function controllerStorageDir(dataDir: string): string {
  return path.join(dataDir, STORAGE_DIR_NAME);
}

export async function inspectIdentity(dataDir: string, fabricLabel: string): Promise<IdentityInspection> {
  const directory = controllerStorageDir(dataDir);
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "absent", directory };
    throw error;
  }
  const identityPath = path.join(directory, IDENTITY_FILE);
  let raw: string;
  try {
    raw = await readFile(identityPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const stray = names.filter((name) => name !== IDENTITY_FILE);
      if (stray.length > 0) {
        return {
          state: "blocked",
          directory,
          message: "Matter storage exists without an identity record. IoT.Edu will not generate a replacement identity.",
        };
      }
      return { state: "absent", directory };
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { state: "corrupt", directory, message: "The controller identity file is not valid JSON and was not replaced." };
  }
  if (!isIdentity(parsed) || parsed.fabricLabel !== fabricLabel) {
    return {
      state: "corrupt",
      directory,
      message: "The controller identity file does not match this application and was not replaced.",
    };
  }
  return { state: "ready", directory, identity: parsed };
}

export async function writeIdentity(directory: string, identity: StoredIdentity): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const file = path.join(directory, IDENTITY_FILE);
  await writeFile(file, JSON.stringify(identity, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await chmod(file, 0o600);
  await protectStorage(directory);
}

export async function protectStorage(directory: string): Promise<void> {
  await chmod(directory, 0o700);
  const entries = await readdir(directory, { recursive: true });
  for (const entry of entries) {
    const relative = String(entry);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    const full = path.join(directory, relative);
    try {
      const info = await stat(full);
      await chmod(full, info.isDirectory() ? 0o700 : 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function assertCreateAllowed(inspection: IdentityInspection): void {
  if (inspection.state === "corrupt") throw new MatterOperationError("identity_corrupt", inspection.message);
  if (inspection.state === "blocked") throw new MatterOperationError("regeneration_refused", inspection.message);
}

function isIdentity(value: unknown): value is StoredIdentity {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.version === 1
    && typeof record.createdAt === "string"
    && typeof record.fabricLabel === "string"
    && typeof record.matterJsVersion === "string"
    && (record.fabricId === null || typeof record.fabricId === "string")
    && (record.credentialId === null || typeof record.credentialId === "string")
    && (record.controllerNodeId === null || typeof record.controllerNodeId === "string");
}
