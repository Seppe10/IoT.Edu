import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, readFile, rm, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  libraryComponentSchema,
  type ComponentManifest,
  type LibraryComponent,
  type LibraryCreateRequest,
  type LibraryFile,
  type LibraryUpdateRequest,
  type LibraryValidateRequest,
  type LibraryValidationResponse,
} from "@iotedu/contracts";
import { CatalogueError, catalogueComponent, catalogueEnabled, listValidatedComponents, readCatalogueFile, saveCatalogueRevision } from "./catalogue-store.js";
import {
  approvedLibraryRecords,
  compileLibraryComponent,
  extractSafeZip,
  safeRelativePath,
  safeUploadName,
  UnsafeArchiveError,
  validateLibraryComponent,
  type BoardProfile,
  type LibrarySourceFile,
  type NativeCompileReport,
} from "@iotedu/firmware-builder";

export class FirmwareLibraryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly detail: unknown = null,
  ) {
    super(message);
    this.name = "FirmwareLibraryError";
  }
}

interface StoredFile extends LibrarySourceFile {
  listed: LibraryFile;
}

export class FirmwareLibraryService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dataDir: string,
    private readonly profile: BoardProfile,
    private readonly loadManifests: () => Promise<ComponentManifest[]> = async () => [],
    private readonly options: { failIndexWrite?: boolean; compile?: (files: LibrarySourceFile[]) => Promise<NativeCompileReport> } = {},
  ) {}

  async list(): Promise<LibraryComponent[]> {
    return this.enqueue(async () => this.readPublished());
  }

  async get(id: string): Promise<LibraryComponent | null> {
    return this.enqueue(async () => {
      const components = await this.readPublished();
      const published = components.find((item) => item.id === id);
      if (published || !catalogueEnabled()) return published ?? null;
      try {
        return await catalogueComponent(id);
      } catch (error) {
        this.rethrowCatalogue(error);
      }
    });
  }

  async stage(files: { name: string; contentBase64: string }[]): Promise<{ stageId: string; files: LibraryFile[] }> {
    return this.enqueue(async () => {
      const stored = this.expandUploads(files);
      const stageId = `stage-${randomBytes(6).toString("hex")}`;
      const root = this.stageDir(stageId);
      await this.writeTree(path.join(root, "files"), stored);
      const listed = stored.map((file) => file.listed);
      await this.writeJson(path.join(root, "meta.json"), { id: stageId, files: listed });
      return { stageId, files: listed };
    });
  }

  async validate(input: LibraryValidateRequest): Promise<LibraryValidationResponse> {
    return this.enqueue(async () => this.assess(input));
  }

  async create(input: LibraryCreateRequest): Promise<LibraryComponent> {
    return this.enqueue(async () => {
      const assessed = await this.assess({ ...input, componentId: null });
      this.assertCurrent(assessed, input.fingerprint);
      const id = `custom-${randomBytes(6).toString("hex")}`;
      const now = new Date().toISOString();
      const record = this.record({
        id,
        input,
        assessed,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      const files = await this.mergedFiles({ ...input, componentId: null });
      if (catalogueEnabled()) {
        try {
          await saveCatalogueRevision(record, files);
        } catch (error) {
          this.rethrowCatalogue(error);
        }
      } else {
        const directory = this.componentDir(id);
        const existing = await this.readCustom();
        try {
          await this.writeTree(path.join(directory, "current"), files);
          await this.writeIndex([...existing, record]);
        } catch (error) {
          await rm(directory, { recursive: true, force: true });
          throw error;
        }
      }
      await rm(this.stageDir(input.stageId), { recursive: true, force: true });
      return record;
    });
  }

  async update(id: string, input: LibraryUpdateRequest): Promise<LibraryComponent> {
    return this.enqueue(async () => {
      if ((await this.approved()).some((item) => item.id === id)) {
        throw new FirmwareLibraryError("Approved components cannot be edited.", 403, "approved_readonly");
      }
      this.assertCustomId(id);
      const existing = catalogueEnabled()
        ? await catalogueComponent(id).catch((error: unknown) => this.rethrowCatalogue(error))
        : (await this.readCustom()).find((item) => item.id === id);
      if (!existing) throw new FirmwareLibraryError("Firmware component not found.", 404, "not_found");
      if (existing.revision !== input.baseRevision) {
        throw new FirmwareLibraryError(
          "This component changed after you opened it. Reload it and validate again.",
          409,
          "component_conflict",
        );
      }
      const assessed = await this.assess({ ...input, componentId: id });
      this.assertCurrent(assessed, input.fingerprint);
      const now = new Date().toISOString();
      const record = this.record({
        id,
        input,
        assessed,
        revision: existing.revision + 1,
        createdAt: existing.createdAt,
        updatedAt: now,
      });
      const files = await this.mergedFiles({ ...input, componentId: id });
      if (catalogueEnabled()) {
        try {
          await saveCatalogueRevision(record, files);
        } catch (error) {
          this.rethrowCatalogue(error);
        }
      } else {
        const directory = this.componentDir(id);
        await this.snapshot(directory, existing);
        await rm(path.join(directory, "next"), { recursive: true, force: true });
        try {
          await this.writeTree(path.join(directory, "next"), files);
        } catch (error) {
          await rm(path.join(directory, "next"), { recursive: true, force: true });
          throw error;
        }
        await this.replaceCurrent(directory, async () => {
          const components = await this.readCustom();
          await this.writeIndex(components.map((item) => item.id === id ? record : item));
        });
      }
      if (input.stageId) await rm(this.stageDir(input.stageId), { recursive: true, force: true });
      return record;
    });
  }

  private async assess(input: LibraryValidateRequest): Promise<LibraryValidationResponse> {
    if (input.componentId && (await this.approved()).some((item) => item.id === input.componentId)) {
      throw new FirmwareLibraryError("Approved components cannot be edited.", 403, "approved_readonly");
    }
    if (input.componentId) this.assertCustomId(input.componentId);
    const existing = input.componentId
      ? (await this.readCustom()).find((item) => item.id === input.componentId) ?? null
      : null;
    if (input.componentId && !existing) throw new FirmwareLibraryError("Firmware component not found.", 404, "not_found");
    const stored = await this.mergedFiles(input);
    const names = [...(await this.readCustom()), ...(await this.approved())].map((item) => item.name);
    const preliminary = validateLibraryComponent({
      name: input.name,
      description: input.description,
      type: input.type,
      gpio: input.gpio,
      files: stored,
      profile: this.profile,
      namesTaken: names,
      ownName: existing?.name,
    });
    const structuralError = preliminary.issues.some((issue) => issue.level === "error" && !issue.code.startsWith("native_compile"));
    const componentNames = new Set(preliminary.files.map((file) => file.name));
    const compile = structuralError
      ? { available: true, ran: false, success: false, diagnostics: [] }
      : await (this.options.compile ?? compileLibraryComponent)(stored.filter((file) => componentNames.has(file.name)));
    const result = validateLibraryComponent({
      name: input.name,
      description: input.description,
      type: input.type,
      gpio: input.gpio,
      files: stored,
      profile: this.profile,
      namesTaken: names,
      ownName: existing?.name,
      compile,
    });
    return {
      ok: result.ok,
      fingerprint: result.fingerprint,
      nativeCompile: result.nativeCompile,
      integration: result.integration,
      issues: result.issues,
      files: result.files,
    };
  }

  private assertCurrent(result: LibraryValidationResponse, fingerprint: string): void {
    const warnings = result.issues.filter((issue) => issue.level === "warning");
    if (!result.ok || !result.fingerprint || !result.nativeCompile || warnings.length > 0) {
      const message = warnings.length > 0
        ? `Firmware cannot be saved. Resolve all ${warnings.length} validation warning${warnings.length === 1 ? "" : "s"} and validate again.`
        : result.issues.find((issue) => issue.level === "error")?.message ?? "The component did not pass validation.";
      throw new FirmwareLibraryError(message, 400, "validation_failed", result);
    }
    if (result.fingerprint !== fingerprint) {
      throw new FirmwareLibraryError(
        "Validate the current files and settings before saving. The previous validation does not match this submission.",
        409,
        "stale_validation",
      );
    }
  }

  private record(input: {
    id: string;
    input: LibraryCreateRequest | LibraryUpdateRequest;
    assessed: LibraryValidationResponse;
    revision: number;
    createdAt: string;
    updatedAt: string;
  }): LibraryComponent {
    if (!input.assessed.fingerprint) {
      throw new FirmwareLibraryError("The component did not pass validation.", 400, "validation_failed", input.assessed);
    }
    const contentHash = createHash("sha256")
      .update(input.assessed.files.map((file) => `${file.name}:${file.sha256}`).sort().join("\n"))
      .digest("hex");
    return libraryComponentSchema.parse({
      id: input.id,
      name: input.input.name.trim(),
      description: input.input.description.trim(),
      type: input.input.type,
      provenance: "custom",
      target: "esp32h2",
      compatibility: null,
      gpio: input.input.gpio.map((pin) => ({ ...pin, description: pin.description.trim() })),
      files: input.assessed.files,
      revision: input.revision,
      contentHash,
      validation: {
        fingerprint: input.assessed.fingerprint,
        nativeCompile: input.assessed.nativeCompile,
        validatedAt: input.updatedAt,
        issues: input.assessed.issues,
        integration: input.assessed.integration,
      },
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
  }

  private async mergedFiles(input: { stageId: string | null; componentId: string | null; retain: string[] }): Promise<LibrarySourceFile[]> {
    const retained = new Map<string, LibrarySourceFile>();
    if (input.retain.length > 0) {
      if (!input.componentId) throw new FirmwareLibraryError("Saved files can only be kept while editing a component.", 400, "invalid_input");
      for (const name of input.retain) {
        const safe = safeRelativePath(name);
        if (!safe) throw new FirmwareLibraryError("A saved file path is not allowed.", 400, "unsafe_path");
        retained.set(safe, {
          name: safe,
          data: catalogueEnabled()
            ? await readCatalogueFile(input.componentId, safe).catch((error: unknown) => this.rethrowCatalogue(error))
            : await this.readInside(path.join(this.componentDir(input.componentId), "current"), safe),
        });
      }
    }
    if (input.stageId) {
      const staged = await this.readStage(input.stageId);
      for (const file of staged) retained.set(file.name, file);
    }
    return [...retained.values()];
  }

  private expandUploads(files: { name: string; contentBase64: string }[]): StoredFile[] {
    const decoded = files.map((file) => {
      const name = safeUploadName(file.name);
      if (!name) throw new FirmwareLibraryError(`“${file.name.slice(0, 80)}” is not an allowed source file.`, 400, "unsupported_file");
      const data = decodeBase64(file.contentBase64);
      if (data.length === 0 || data.length > 200_000) {
        throw new FirmwareLibraryError(`${name} is empty or larger than 200 kB.`, 400, "invalid_file");
      }
      return { name, data };
    });
    const zip = decoded.filter((file) => file.name.toLowerCase().endsWith(".zip"));
    if (zip.length > 0 && decoded.length !== 1) {
      throw new FirmwareLibraryError("Upload either one ZIP archive or individual source files.", 400, "unsupported_file");
    }
    const expanded = zip.length === 1 ? this.unpack(zip[0]?.data ?? Buffer.alloc(0)) : decoded.map((file) => {
      const safe = safeRelativePath(file.name);
      if (!safe) throw new FirmwareLibraryError(`“${file.name}” is not an allowed source file.`, 400, "unsupported_file");
      return { name: safe, data: file.data };
    });
    return expanded.map((file) => ({
      ...file,
      listed: {
        name: file.name,
        sha256: createHash("sha256").update(file.data).digest("hex"),
        bytes: file.data.length,
      },
    }));
  }

  private unpack(data: Buffer): LibrarySourceFile[] {
    try {
      return extractSafeZip(data).map((file) => {
        const safe = safeRelativePath(file.name);
        if (!safe) {
          const escaped = file.name.includes("..") || file.name.startsWith("/") || file.name.includes("\\");
          throw new FirmwareLibraryError(
            escaped
              ? "The archive contains a file path that escapes the component directory."
              : `“${file.name.split("/").pop()}” inside the archive is not an allowed source file.`,
            400,
            escaped ? "unsafe_archive" : "unsupported_file",
          );
        }
        return { name: safe, data: file.data };
      });
    } catch (error) {
      if (error instanceof FirmwareLibraryError) throw error;
      if (error instanceof UnsafeArchiveError) throw new FirmwareLibraryError(error.message, 400, "unsafe_archive");
      throw new FirmwareLibraryError("The ZIP archive could not be read.", 400, "unsafe_archive");
    }
  }

  private async readStage(stageId: string): Promise<LibrarySourceFile[]> {
    if (!/^stage-[a-f0-9]{12}$/.test(stageId)) {
      throw new FirmwareLibraryError("Upload the source files again before validating.", 404, "stage_not_found");
    }
    try {
      const meta = JSON.parse(await readFile(path.join(this.stageDir(stageId), "meta.json"), "utf8")) as { files?: LibraryFile[] };
      const files = meta.files ?? [];
      return Promise.all(files.map(async (file) => ({
        name: file.name,
        data: await this.readInside(path.join(this.stageDir(stageId), "files"), file.name),
      })));
    } catch (error) {
      if (error instanceof FirmwareLibraryError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new FirmwareLibraryError("Upload the source files again before validating.", 404, "stage_not_found");
      }
      throw error;
    }
  }

  private async readPublished(): Promise<LibraryComponent[]> {
    const custom = await this.readCustom();
    const approved = await this.approved();
    return [...custom, ...approved].sort((left, right) => left.name.localeCompare(right.name, "en"));
  }

  private async approved(): Promise<LibraryComponent[]> {
    return approvedLibraryRecords(await this.loadManifests()).map((record) => libraryComponentSchema.parse(record));
  }

  private rethrowCatalogue(error: unknown): never {
    if (error instanceof FirmwareLibraryError) throw error;
    if (error instanceof CatalogueError) throw new FirmwareLibraryError(error.message, error.statusCode, error.code);
    throw new FirmwareLibraryError("The firmware catalogue database is unavailable. The component was not saved to the file library.", 503, "catalogue_unavailable");
  }

  private async readCustom(): Promise<LibraryComponent[]> {
    if (catalogueEnabled()) {
      try {
        return await listValidatedComponents();
      } catch (error) {
        this.rethrowCatalogue(error);
      }
    }
    try {
      const parsed = JSON.parse(await readFile(this.indexPath(), "utf8")) as { components?: unknown };
      if (!Array.isArray(parsed.components)) return [];
      return parsed.components.map((record) => libraryComponentSchema.parse(record));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeIndex(components: LibraryComponent[]): Promise<void> {
    if (this.options.failIndexWrite) {
      throw new FirmwareLibraryError("The component could not be saved. No library entry was published.", 500, "save_failed");
    }
    await this.writeJson(this.indexPath(), { components });
  }

  private async snapshot(directory: string, record: LibraryComponent): Promise<void> {
    const destination = path.join(directory, "revisions", String(record.revision));
    try {
      await stat(destination);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(destination, { recursive: true });
    await cp(path.join(directory, "current"), path.join(destination, "files"), { recursive: true });
    await this.writeJson(path.join(destination, "record.json"), record);
  }

  private async replaceCurrent(directory: string, publish: () => Promise<void>): Promise<void> {
    const current = path.join(directory, "current");
    const next = path.join(directory, "next");
    const previous = path.join(directory, "previous");
    await rm(previous, { recursive: true, force: true });
    await rename(current, previous);
    try {
      await rename(next, current);
    } catch (error) {
      await rename(previous, current);
      throw error;
    }
    try {
      await publish();
    } catch (error) {
      await rm(current, { recursive: true, force: true });
      await rename(previous, current);
      throw error;
    }
    await rm(previous, { recursive: true, force: true });
  }

  private async writeTree(root: string, files: LibrarySourceFile[]): Promise<void> {
    const resolvedRoot = this.insideLibrary(root);
    await mkdir(resolvedRoot, { recursive: true });
    for (const file of files) {
      const safe = safeRelativePath(file.name);
      if (!safe) throw new FirmwareLibraryError("A file path is not allowed.", 400, "unsafe_path");
      const target = this.inside(resolvedRoot, safe);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.data, { flag: "wx" });
    }
  }

  private async readInside(root: string, name: string): Promise<Buffer> {
    const safe = safeRelativePath(name);
    if (!safe) throw new FirmwareLibraryError("A file path is not allowed.", 400, "unsafe_path");
    return readFile(this.inside(this.insideLibrary(root), safe));
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    const target = this.insideLibrary(file);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
    await rename(temporary, target);
  }

  private insideLibrary(target: string): string {
    const root = this.libraryRoot();
    const resolved = path.resolve(target);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new FirmwareLibraryError("A file path is not allowed.", 400, "unsafe_path");
    }
    return resolved;
  }

  private inside(root: string, relative: string): string {
    const resolved = path.resolve(root, relative);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new FirmwareLibraryError("A file path is not allowed.", 400, "unsafe_path");
    }
    return resolved;
  }

  private libraryRoot(): string {
    return path.resolve(this.dataDir, "firmware-library");
  }

  private indexPath(): string {
    return path.join(this.libraryRoot(), "index.json");
  }

  private componentDir(id: string): string {
    this.assertCustomId(id);
    return path.join(this.libraryRoot(), "components", id);
  }

  private stageDir(id: string): string {
    if (!/^stage-[a-f0-9]{12}$/.test(id)) {
      throw new FirmwareLibraryError("Upload the source files again before validating.", 404, "stage_not_found");
    }
    return path.join(this.libraryRoot(), "stages", id);
  }

  private assertCustomId(id: string): void {
    const catalogueId = catalogueEnabled() && /^custom-[a-z0-9-]{1,80}$/.test(id);
    if (!catalogueId && !/^custom-[a-f0-9]{12}$/.test(id)) {
      throw new FirmwareLibraryError("The component ID is not valid.", 400, "invalid_id");
    }
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

function decodeBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value)) {
    throw new FirmwareLibraryError("A source file was not encoded as text.", 400, "invalid_file");
  }
  return Buffer.from(value.replace(/\s/g, ""), "base64");
}
