import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  componentManifestSchema,
  type CatalogRepository,
  type ComponentManifest,
  type ComponentStatus,
  type ValidationResult,
} from "@iotedu/contracts";

const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

export class LocalCatalogRepository implements CatalogRepository {
  constructor(
    private readonly manifestDir: string,
    private readonly repoRoot: string,
  ) {}

  async list(): Promise<ComponentManifest[]> {
    const names = (await readdir(this.manifestDir)).filter((name) => name.endsWith(".json")).sort();
    const manifests: ComponentManifest[] = [];
    for (const name of names) {
      manifests.push(await this.readManifest(name));
    }
    return manifests;
  }

  async getById(id: string): Promise<ComponentManifest | null> {
    if (!SAFE_ID.test(id)) return null;
    const all = await this.list();
    return all.find((item) => item.id === id) ?? null;
  }

  async search(query: string, status?: ComponentStatus): Promise<ComponentManifest[]> {
    const needle = query.trim().toLowerCase();
    const all = await this.list();
    return all.filter((item) => {
      if (status && item.status !== status) return false;
      if (!needle) return true;
      const haystack = [
        item.id,
        item.name,
        item.description,
        item.type,
        ...(item.firmware?.matter.clusters ?? []),
        ...(item.firmware?.matter.endpoints ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  async validate(): Promise<ValidationResult> {
    const issues: ValidationResult["issues"] = [];
    let manifests: ComponentManifest[] = [];
    try {
      manifests = await this.list();
    } catch (error) {
      return {
        ok: false,
        issues: [
          {
            level: "error",
            code: "catalog_unreadable",
            message: error instanceof Error ? error.message : "Catalogue could not be read",
          },
        ],
      };
    }

    const ids = new Set<string>();
    for (const manifest of manifests) {
      if (ids.has(manifest.id)) {
        issues.push({
          level: "error",
          code: "duplicate_id",
          message: `Duplicate component id ${manifest.id}`,
        });
      }
      ids.add(manifest.id);

      if ((manifest.status === "verified" || manifest.status === "experimental") && manifest.selectableForBuild) {
        if (!manifest.firmware) {
          issues.push({
            level: "error",
            code: "missing_firmware_binding",
            message: `${manifest.id} is selectable but has no firmware binding`,
          });
          continue;
        }
        const dirIssue = this.checkComponentDir(manifest.id, manifest.firmware.idfComponentDir);
        if (dirIssue) issues.push(dirIssue);
      }

      if (manifest.status === "planned" || manifest.status === "template") {
        if (manifest.selectableForBuild) {
          issues.push({
            level: "error",
            code: "planned_marked_selectable",
            message: `${manifest.id} is ${manifest.status} and must not be selectable`,
          });
        }
      }

      if (manifest.status === "verified" && !manifest.firmware?.registerFunction) {
        issues.push({
          level: "error",
          code: "verified_without_register",
          message: `${manifest.id} cannot be verified without a register function`,
        });
      }
    }

    return { ok: issues.every((issue) => issue.level !== "error"), issues };
  }

  private async readManifest(fileName: string): Promise<ComponentManifest> {
    if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
      throw new Error(`Rejected catalogue file name ${fileName}`);
    }
    const full = path.resolve(this.manifestDir, fileName);
    const root = path.resolve(this.manifestDir);
    if (!full.startsWith(root + path.sep)) {
      throw new Error(`Catalogue path escaped the manifest directory: ${fileName}`);
    }
    const raw = JSON.parse(await readFile(full, "utf8")) as unknown;
    return componentManifestSchema.parse(raw);
  }

  private checkComponentDir(id: string, componentDir: string): ValidationResult["issues"][number] | null {
    if (componentDir.includes("..") || path.isAbsolute(componentDir)) {
      return {
        level: "error",
        code: "unsafe_component_path",
        message: `${id} uses an unsafe component path`,
      };
    }
    const resolved = path.resolve(this.repoRoot, componentDir);
    const root = path.resolve(this.repoRoot);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return {
        level: "error",
        code: "component_path_escape",
        message: `${id} component path escapes the repository`,
      };
    }
    return null;
  }
}
