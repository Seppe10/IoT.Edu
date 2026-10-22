import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BuildJob, ManagedNode, NodeRepository, OtaJob } from "@iotedu/contracts";

async function atomicWrite(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, file);
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
    const nodes = await this.list();
    const index = nodes.findIndex((item) => item.id === node.id);
    if (index >= 0) nodes[index] = node;
    else nodes.push(node);
    await atomicWrite(this.file, JSON.stringify(nodes, null, 2) + "\n");
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
    const jobs = await this.list();
    const index = jobs.findIndex((item) => item.id === job.id);
    if (index >= 0) jobs[index] = job;
    else jobs.push(job);
    await atomicWrite(this.file, JSON.stringify(jobs, null, 2) + "\n");
  }
}

export type BuildRepository = JsonJobRepository<BuildJob>;
export type OtaRepository = JsonJobRepository<OtaJob>;

const SECRET_PATTERNS = [
  /pairingCode/gi,
  /\b\d{4}-\d{3}-\d{4}\b/g,
  /MT:[A-Z0-9.-]+/gi,
];

export function redact(text: string): string {
  const preserved: string[] = [];
  const held = text.replace(/"(manualPairingCode|qrPairingCode)"\s*:\s*"([^"\\]*)"/g, (_match, key: string, value: string) => {
    preserved.push(value);
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
  await mkdir(path.dirname(file), { recursive: true });
  const previous = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  await atomicWrite(file, previous + line);
}
