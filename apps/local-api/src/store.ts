import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BuildJob, ManagedNode, NodeRepository, OtaJob } from "@iotedu/contracts";

const writers = new Map<string, Promise<void>>();

/** Run read-modify-write steps for one file one at a time. A rejected write does not block the next one. */
export function withFileLock<T>(file: string, work: () => Promise<T>): Promise<T> {
  const previous = writers.get(file) ?? Promise.resolve();
  const run = previous.then(work, work);
  writers.set(file, run.then(() => undefined, () => undefined));
  return run;
}

async function atomicWrite(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, "utf8");
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function removeOrphanTemporaryFiles(directory: string): Promise<void> {
  const entries = await readdir(directory).catch(() => []);
  await Promise.all(entries.filter((name) => name.endsWith(".tmp")).map((name) => rm(path.join(directory, name), { force: true })));
}

async function readArray<T>(file: string): Promise<T[]> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export class JsonNodeRepository implements NodeRepository {
  constructor(private readonly file: string) {}

  async list(): Promise<ManagedNode[]> {
    return readArray<ManagedNode>(this.file);
  }

  async getById(id: string): Promise<ManagedNode | null> {
    const nodes = await this.list();
    return nodes.find((node) => node.id === id) ?? null;
  }

  async save(node: ManagedNode): Promise<void> {
    await withFileLock(this.file, async () => {
      const nodes = await this.list();
      const index = nodes.findIndex((item) => item.id === node.id);
      if (index >= 0) nodes[index] = node;
      else nodes.push(node);
      await atomicWrite(this.file, JSON.stringify(nodes, null, 2) + "\n");
    });
  }

  async delete(id: string): Promise<void> {
    await withFileLock(this.file, async () => {
      const nodes = (await this.list()).filter((node) => node.id !== id);
      await atomicWrite(this.file, JSON.stringify(nodes, null, 2) + "\n");
    });
  }
}

export class JsonJobRepository<T extends { id: string }> {
  constructor(private readonly file: string) {}

  async list(): Promise<T[]> {
    return readArray<T>(this.file);
  }

  async get(id: string): Promise<T | null> {
    const jobs = await this.list();
    return jobs.find((job) => job.id === id) ?? null;
  }

  async save(job: T): Promise<void> {
    await withFileLock(this.file, async () => {
      const jobs = await this.list();
      const index = jobs.findIndex((item) => item.id === job.id);
      if (index >= 0) jobs[index] = job;
      else jobs.push(job);
      await atomicWrite(this.file, JSON.stringify(jobs, null, 2) + "\n");
    });
  }
}

export type BuildRepository = JsonJobRepository<BuildJob>;
export type OtaRepository = JsonJobRepository<OtaJob>;

const SECRET_PATTERNS = [
  /pairingCode/gi,
  /\b\d{4}-\d{3}-\d{4}\b/g,
  /https?:\/\/\S*qrcode\.html\?\S+/gi,
  /MT%3A[A-Z0-9.%_-]+/gi,
  /MT:[A-Z0-9.-]+/gi,
  /Manual pairing code:\s*\[[0-9-]+\]/gi,
];

export function redact(text: string, options?: { keepOnboarding?: boolean }): string {
  const preserved: string[] = [];
  const held = text.replace(/"(manualPairingCode|qrPairingCode|qrPayload|manualCode)"\s*:\s*"([^"\\]*)"/g, (_match, key: string, value: string) => {
    const keep = key === "manualPairingCode" || key === "qrPairingCode" || options?.keepOnboarding === true;
    preserved.push(keep ? value : "[redacted]");
    return `"${key}":"__IOTEDU_KEEP_${preserved.length - 1}__"`;
  });
  let output = held;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, "[redacted]");
  }
  return output.replace(/__IOTEDU_KEEP_(\d+)__/g, (_match, index: string) => preserved[Number(index)] ?? "[redacted]");
}

export async function appendAudit(file: string, event: Record<string, unknown>): Promise<void> {
  const line = redact(JSON.stringify({ at: new Date().toISOString(), ...event })) + "\n";
  await withFileLock(file, async () => {
    await mkdir(path.dirname(file), { recursive: true });
    const previous = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    await atomicWrite(file, previous + line);
  });
}
