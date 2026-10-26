import type { LibraryComponent, LibraryValidationResponse } from "@iotedu/contracts";

export interface GpioDraft {
  key: string;
  name: string;
  gpio: string;
  description: string;
}

export interface LibraryUpload {
  name: string;
  contentBase64: string;
}

export interface LibraryFormValidation extends LibraryValidationResponse {
  stageId: string | null;
}

export interface LibraryFormState {
  selectionId: string;
  codeSource: "upload";
  name: string;
  description: string;
  type: "" | "sensor" | "actuator";
  retainedFiles: { name: string; sha256: string }[];
  newFiles: LibraryUpload[];
  gpio: GpioDraft[];
  baseRevision: number | null;
  validation: LibraryFormValidation | null;
}

export type LibraryStatusFilter = "all" | "custom" | "approved";

const GPIO_LIMIT = 16;

function freshGpio(): GpioDraft {
  return { key: crypto.randomUUID(), name: "", gpio: "", description: "" };
}

export function blankLibraryForm(): LibraryFormState {
  return {
    selectionId: "",
    codeSource: "upload",
    name: "",
    description: "",
    type: "",
    retainedFiles: [],
    newFiles: [],
    gpio: [freshGpio()],
    baseRevision: null,
    validation: null,
  };
}

export function libraryFormFromComponent(component: LibraryComponent): LibraryFormState {
  return {
    selectionId: component.id,
    codeSource: "upload",
    name: component.name,
    description: component.description,
    type: component.type,
    retainedFiles: component.files.map((file) => ({ name: file.name, sha256: file.sha256 })),
    newFiles: [],
    gpio: component.gpio.length > 0
      ? component.gpio.map((pin) => ({
        key: crypto.randomUUID(),
        name: pin.name,
        gpio: String(pin.gpio),
        description: pin.description,
      }))
      : [],
    baseRevision: component.revision,
    validation: null,
  };
}

export function withLibraryChange(form: LibraryFormState, patch: Partial<LibraryFormState>): LibraryFormState {
  return { ...form, ...patch, validation: null };
}

export function canSaveLibrary(form: LibraryFormState): boolean {
  const validation = form.validation;
  if (!validation?.ok || !validation.fingerprint || validation.nativeCompile !== true) return false;
  return !validation.issues.some((issue) => issue.level === "error" || issue.level === "warning");
}

export function librarySaveRequirement(form: LibraryFormState, phase: "idle" | "validating" | "saving"): string {
  if (phase === "validating") return "Validation in progress.";
  if (phase === "saving") return "Saving the validated component.";
  const validation = form.validation;
  if (!validation) return "Validate this component before saving it.";
  const errors = validation.issues.filter((issue) => issue.level === "error").length;
  const warnings = validation.issues.filter((issue) => issue.level === "warning").length;
  if (errors === 0 && warnings === 0 && validation.ok && validation.nativeCompile) {
    return "Validation successful. No errors or warnings. Firmware is ready to save to the library.";
  }
  if (warnings > 0 && errors === 0) {
    return `Firmware cannot be saved. Resolve all ${warnings} validation warning${warnings === 1 ? "" : "s"} and validate again.`;
  }
  if (errors > 0) {
    return `Firmware cannot be saved. Resolve all ${errors} validation error${errors === 1 ? "" : "s"}${warnings > 0 ? ` and ${warnings} warning${warnings === 1 ? "" : "s"}` : ""} and validate again.`;
  }
  return "Firmware cannot be saved until validation completes with no errors, no warnings, and a successful ESP32-H2 component compile.";
}

const UPLOAD_EXTENSIONS = new Set([".c", ".h", ".cpp", ".hpp"]);
const UPLOAD_BASENAMES = new Set(["CMakeLists.txt", "Kconfig", "Kconfig.projbuild"]);

export function libraryUploadPath(name: string): string | null {
  if (!name || name.length > 240 || name.includes("\\") || name.includes("\0") || name.includes("..")) return null;
  const parts = name.split("/").filter((part) => part.length > 0);
  if (parts.length === 0 || parts.length > 8) return null;
  if (parts.some((part) => part === "." || part === ".." || part.startsWith("."))) return null;
  const base = parts[parts.length - 1] ?? "";
  if (base.toLowerCase().endsWith(".zip")) {
    return parts.length === 1 && /^[A-Za-z0-9._-]{1,80}$/.test(base) ? base : null;
  }
  const extension = base.includes(".") ? base.slice(base.lastIndexOf(".")).toLowerCase() : "";
  if (!UPLOAD_BASENAMES.has(base) && !UPLOAD_EXTENSIONS.has(extension)) return null;
  if (parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part))) return null;
  return parts.join("/");
}

export function saveLibraryLabel(form: LibraryFormState): "Create Firmware" | "Update Firmware" {
  return form.selectionId ? "Update Firmware" : "Create Firmware";
}

export function customSelectionOptions(components: LibraryComponent[]): LibraryComponent[] {
  return components.filter((component) => component.provenance === "custom");
}

export function filterFirmwareLibrary(
  components: LibraryComponent[],
  query: string,
  status: LibraryStatusFilter,
): LibraryComponent[] {
  const needle = query.trim().toLowerCase();
  return components.filter((component) => {
    if (status === "custom" && component.provenance !== "custom") return false;
    if (status === "approved" && component.provenance !== "approved") return false;
    if (!needle) return true;
    return component.name.toLowerCase().includes(needle)
      || component.description.toLowerCase().includes(needle)
      || component.type.includes(needle);
  });
}

export function duplicateLibraryName(form: LibraryFormState, components: LibraryComponent[]): string | null {
  const name = form.name.trim().toLowerCase();
  if (!name) return null;
  const clash = components.find((component) => component.name.trim().toLowerCase() === name && component.id !== form.selectionId);
  return clash ? `A firmware component named “${form.name.trim()}” already exists.` : null;
}

export function localLibraryIssues(form: LibraryFormState): string[] {
  const issues: string[] = [];
  if (!form.name.trim()) issues.push("Firmware Name is required.");
  else if (form.name.trim().length > 80) issues.push("Firmware Name must be 80 characters or fewer.");
  if (!form.description.trim()) issues.push("Description is required.");
  else if (form.description.trim().length > 600) issues.push("Description must be 600 characters or fewer.");
  if (form.type !== "sensor" && form.type !== "actuator") issues.push("Component Type is required.");
  if (form.retainedFiles.length + form.newFiles.length === 0) issues.push("Upload source files or keep the saved files.");
  const names = new Set<string>();
  const pins = new Set<string>();
  form.gpio.forEach((row, index) => {
    const label = `GPIO connection ${index + 1}`;
    const name = row.name.trim();
    if (!name) issues.push(`${label}: connection name is required.`);
    else if (names.has(name.toLowerCase())) issues.push(`Connection “${name}” is used more than once.`);
    if (name) names.add(name.toLowerCase());
    if (!/^\d+$/.test(row.gpio.trim())) issues.push(`${label}: pin number must be a whole number.`);
    else if (Number(row.gpio) > 27) issues.push(`${label}: ${row.gpio.trim()} is outside ESP32-H2 pins 0 to 27.`);
    else if (pins.has(row.gpio.trim())) issues.push(`GPIO ${row.gpio.trim()} is assigned more than once.`);
    else pins.add(row.gpio.trim());
  });
  return issues;
}

export function addLibraryFiles(form: LibraryFormState, files: LibraryUpload[]): LibraryFormState {
  const names = new Set(files.map((file) => file.name));
  return withLibraryChange(form, {
    newFiles: [...form.newFiles.filter((file) => !names.has(file.name)), ...files],
    retainedFiles: form.retainedFiles.filter((file) => !names.has(file.name)),
  });
}

export function removeNewFile(form: LibraryFormState, name: string): LibraryFormState {
  return withLibraryChange(form, { newFiles: form.newFiles.filter((file) => file.name !== name) });
}

export function removeRetainedFile(form: LibraryFormState, name: string): LibraryFormState {
  return withLibraryChange(form, { retainedFiles: form.retainedFiles.filter((file) => file.name !== name) });
}

export function addGpioRow(form: LibraryFormState): LibraryFormState {
  if (form.gpio.length >= GPIO_LIMIT) return form;
  return withLibraryChange(form, { gpio: [...form.gpio, freshGpio()] });
}

export function removeGpioRow(form: LibraryFormState, key: string): LibraryFormState {
  return withLibraryChange(form, { gpio: form.gpio.filter((row) => row.key !== key) });
}

export function updateGpioRow(form: LibraryFormState, key: string, patch: Partial<GpioDraft>): LibraryFormState {
  return withLibraryChange(form, {
    gpio: form.gpio.map((row) => row.key === key ? { ...row, ...patch, key: row.key } : row),
  });
}

export function scrollBuilderForm(target: { scrollIntoView: (options?: ScrollIntoViewOptions) => void } | null): void {
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}
