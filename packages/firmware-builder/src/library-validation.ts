import { createHash } from "node:crypto";
import type { ComponentManifest, LibraryIntegration } from "@iotedu/contracts";
import { safeRelativePath } from "./library-paths.js";

export interface LibraryIssue {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
  file?: string;
  line?: number;
}

export interface LibraryBoardProfile {
  gpioMin: number;
  gpioMax: number;
  reservedGpio: { gpio: number; reason: string }[];
  adc1Channels?: { channel: number; gpio: number }[];
}

export interface NativeCompileReport {
  available: boolean;
  ran: boolean;
  success: boolean;
  diagnostics: { level: "error" | "warning"; message: string; file?: string; line?: number }[];
}

export interface LibrarySourceFile {
  name: string;
  data: Buffer;
}

export interface LibraryGpioInput {
  name: string;
  gpio: number;
  description: string;
}

export interface LibraryCheckInput {
  name: string;
  description: string;
  type: string;
  gpio: LibraryGpioInput[];
  files: LibrarySourceFile[];
  profile: LibraryBoardProfile;
  namesTaken: string[];
  ownName?: string;
  compile?: NativeCompileReport | null;
}

export interface LibraryCheckedFile {
  name: string;
  sha256: string;
  bytes: number;
}

export interface LibraryCheckResult {
  ok: boolean;
  fingerprint: string | null;
  contentHash: string | null;
  nativeCompile: boolean;
  integration: LibraryIntegration | null;
  issues: LibraryIssue[];
  files: LibraryCheckedFile[];
}

export function libraryFingerprint(input: {
  name: string;
  description: string;
  type: "sensor" | "actuator";
  gpio: LibraryGpioInput[];
  files: LibraryCheckedFile[];
}): string {
  const body = JSON.stringify({
    name: input.name.trim(),
    description: input.description.trim(),
    type: input.type,
    gpio: input.gpio.map((pin) => ({
      name: pin.name.trim(),
      gpio: pin.gpio,
      description: pin.description.trim(),
    })),
    files: [...input.files]
      .map((file) => ({ name: file.name, sha256: file.sha256 }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  });
  return createHash("sha256").update(body).digest("hex");
}

export function sourceContentHash(files: LibraryCheckedFile[]): string {
  const body = [...files]
    .map((file) => `${file.name}:${file.sha256}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(body).digest("hex");
}

export function validateLibraryComponent(input: LibraryCheckInput): LibraryCheckResult {
  const issues: LibraryIssue[] = [];
  const name = input.name.trim();
  const description = input.description.trim();
  if (!name) issues.push({ level: "error", code: "invalid_name", message: "Firmware Name is required." });
  else if (name.length > 80) issues.push({ level: "error", code: "invalid_name", message: "Firmware Name must be 80 characters or fewer." });
  if (!description) issues.push({ level: "error", code: "invalid_description", message: "Description is required." });
  else if (description.length > 600) issues.push({ level: "error", code: "invalid_description", message: "Description must be 600 characters or fewer." });
  if (input.type !== "sensor" && input.type !== "actuator") {
    issues.push({ level: "error", code: "invalid_type", message: "Component Type must be Sensor or Actuator." });
  }
  const own = input.ownName?.trim().toLowerCase() ?? "";
  if (name && input.namesTaken.some((taken) => taken.trim().toLowerCase() === name.toLowerCase() && taken.trim().toLowerCase() !== own)) {
    issues.push({ level: "error", code: "duplicate_name", message: `A firmware component named “${name}” already exists.` });
  }

  const files: LibraryCheckedFile[] = [];
  if (input.files.length === 0) {
    issues.push({ level: "error", code: "missing_source", message: "Upload at least one C or C++ source file." });
  }
  for (const file of input.files) {
    const safe = safeRelativePath(file.name);
    if (!safe) {
      issues.push({ level: "error", code: "unsupported_file", message: `“${file.name.split(/[/\\]/).pop()}” is not an allowed source file.` });
      continue;
    }
    if (file.data.length === 0 || file.data.length > 200_000) {
      issues.push({ level: "error", code: "invalid_file", message: `${safe} is empty or larger than 200 kB.` });
      continue;
    }
    if (!isUtf8Text(file.data)) {
      issues.push({ level: "error", code: "binary_source", message: `${safe} is not a text source file.` });
      continue;
    }
    files.push({
      name: safe,
      sha256: createHash("sha256").update(file.data).digest("hex"),
      bytes: file.data.length,
    });
  }
  if (files.length > 0 && !files.some((file) => /\.(c|cpp)$/i.test(file.name))) {
    issues.push({ level: "error", code: "missing_source", message: "The component needs at least one .c or .cpp file." });
  }
  const duplicateNames = files.map((file) => file.name).filter((fileName, index, all) => all.indexOf(fileName) !== index);
  for (const fileName of new Set(duplicateNames)) {
    issues.push({ level: "error", code: "duplicate_file", message: `${fileName} is included more than once.` });
  }
  const bounded = componentBoundary(input.files.filter((file) => files.some((accepted) => accepted.name === safeRelativePath(file.name))));
  issues.push(...bounded.issues);
  const componentNames = new Set(bounded.files.map((file) => file.name));
  const componentFiles = files.filter((file) => componentNames.has(file.name));
  const componentTexts = bounded.files.map((file) => file.data.toString("utf8"));
  issues.push(...cmakeIssues(input.files.filter((file) => files.some((accepted) => accepted.name === safeRelativePath(file.name)))));
  const integration = integrationContract(bounded.files);
  if (integration) {
    issues.push({
      level: "info",
      code: "integration_verified",
      message: `Integration interface ${integration.signature} is declared and defined. The ${integration.endpointOwnedBy === "host" ? "host application creates the Matter endpoint and passes its ID" : "component owns its setup"}.`,
    });
  } else if (componentFiles.some((file) => /\.(c|cpp)$/i.test(file.name))) {
    issues.push({
      level: "error",
      code: "integration_missing",
      message: "No supported integration function was found. A reusable component needs a declared and defined initialisation function such as esp_err_t component_init(uint16_t endpoint_id), or a register function with the same shape. A name that only appears in a comment is not an interface.",
    });
  }
  const source = componentTexts.join("\n");
  const target = source.match(/CONFIG_IDF_TARGET="([A-Za-z0-9]+)"/);
  if (target && target[1] !== "esp32h2") {
    issues.push({ level: "error", code: "unsupported_target", message: `The source targets ${target[1]}. IoT.Edu components must target ESP32-H2.` });
  }

  if (input.gpio.length > 16) {
    issues.push({ level: "error", code: "too_many_gpio", message: "A component can configure at most 16 GPIO connections." });
  }
  issues.push(...gpioIssues(input.profile, input.gpio, source));
  const nativeCompile = applyCompile(issues, input.compile ?? null);

  const type = input.type === "sensor" || input.type === "actuator" ? input.type : null;
  const blocking = issues.some((issue) => issue.level === "error" || issue.level === "warning");
  const fingerprint = !blocking && nativeCompile && type
    ? libraryFingerprint({ name, description, type, gpio: normalGpio(input.gpio), files: componentFiles })
    : null;
  return {
    ok: !blocking && nativeCompile,
    fingerprint,
    contentHash: componentFiles.length > 0 ? sourceContentHash(componentFiles) : null,
    nativeCompile,
    integration,
    issues,
    files: componentFiles,
  };
}

export function approvedLibraryRecords(manifests: ComponentManifest[]) {
  return manifests.flatMap((manifest) => {
    if (manifest.status !== "verified" || (manifest.type !== "sensor" && manifest.type !== "actuator")) return [];
    const digest = createHash("sha256").update(`approved:${manifest.id}`).digest("hex");
    return [{
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      type: manifest.type,
      provenance: "approved" as const,
      target: "esp32h2" as const,
      compatibility: `ESP-IDF ${manifest.idfCompatibility} for ${manifest.target}.`,
      gpio: (manifest.firmware?.kconfig ?? []).map((pin) => ({
        name: pin.pinName,
        gpio: pin.default,
        description: pin.key,
      })),
      files: [],
      revision: 1,
      contentHash: digest,
      validation: {
        fingerprint: digest,
        nativeCompile: false,
        validatedAt: "",
        issues: [],
        integration: null,
      },
      createdAt: "",
      updatedAt: "",
    }];
  });
}

function normalGpio(gpio: LibraryGpioInput[]): LibraryGpioInput[] {
  return gpio.map((pin) => ({
    name: pin.name.trim(),
    gpio: pin.gpio,
    description: pin.description.trim(),
  }));
}

function gpioIssues(profile: LibraryBoardProfile, gpio: LibraryGpioInput[], source: string): LibraryIssue[] {
  const issues: LibraryIssue[] = [];
  if (gpio.length === 0) {
    issues.push({
      level: "warning",
      code: "gpio_none",
      message: "No GPIO pins are configured. Create Firmware stays disabled until the component declares its connections or the source shows that it needs none.",
    });
    return issues;
  }
  const names = new Set<string>();
  const pins = new Map<number, string>();
  gpio.forEach((pin, index) => {
    const label = `GPIO connection ${index + 1}`;
    const name = pin.name.trim();
    if (!/^[A-Za-z][A-Za-z0-9_ ]{0,39}$/.test(name)) {
      issues.push({ level: "error", code: "gpio_name", message: `${label} needs a connection name such as Data or Red.` });
      return;
    }
    const key = name.toLowerCase();
    if (names.has(key)) {
      issues.push({ level: "error", code: "gpio_duplicate_name", message: `Connection “${name}” is used more than once.` });
    }
    names.add(key);
    if (!Number.isInteger(pin.gpio) || pin.gpio < profile.gpioMin || pin.gpio > profile.gpioMax) {
      issues.push({
        level: "error",
        code: "gpio_out_of_range",
        message: `${name} GPIO ${pin.gpio} is outside ESP32-H2 GPIO ${profile.gpioMin}–${profile.gpioMax}.`,
      });
      return;
    }
    const reserved = profile.reservedGpio.find((item) => item.gpio === pin.gpio);
    if (reserved) {
      issues.push({
        level: "error",
        code: "gpio_reserved",
        message: `${name} cannot use GPIO ${pin.gpio}: ${reserved.reason}.`,
      });
    }
    const previous = pins.get(pin.gpio);
    if (previous) {
      issues.push({
        level: "error",
        code: "gpio_conflict",
        message: `GPIO ${pin.gpio} is assigned to both ${previous} and ${name}.`,
      });
    } else {
      pins.set(pin.gpio, name);
    }
    const fixed = fixedConnections(profile, source);
    const fixedMatch = fixed.find((item) => item.gpio === pin.gpio);
    const nameFound = sourceHasName(source, name);
    const numberFound = new RegExp(`(?<!\\d)${pin.gpio}(?!\\d)`).test(source);
    const gpioContext = /\b(gpio|pin|adc)\b/i.test(source);
    if (fixed.length > 0 && !fixed.some((item) => gpio.some((entry) => entry.gpio === item.gpio)) && index === 0) {
      issues.push({
        level: "error",
        code: "gpio_fixed_mismatch",
        message: `The source fixes ${fixed.map((item) => `${item.label} (GPIO ${item.gpio} on ESP32-H2)`).join(", ")}. The GPIO configuration does not include that pin, so the saved mapping would not match the compiled driver.`,
      });
    }
    if (fixed.length > 0 && !fixedMatch && !nameFound) {
      issues.push({
        level: "error",
        code: "gpio_fixed_mismatch",
        message: `${name} selects GPIO ${pin.gpio}, but the source fixes ${fixed.map((item) => `${item.label} = GPIO ${item.gpio}`).join(", ")}.`,
      });
    } else if (!fixedMatch && !nameFound && !(numberFound && gpioContext)) {
      issues.push({
        level: "error",
        code: "gpio_unreferenced",
        message: `Connection “${name}” (GPIO ${pin.gpio}) is not referenced by the uploaded source, so this pin would not affect the component.`,
      });
    } else if (nameFound && !numberFound) {
      issues.push({
        level: "warning",
        code: "gpio_not_in_source",
        message: `GPIO ${pin.gpio} for ${name} is not present in the source. The source names this connection but the saved mapping would not change the compiled code, so Create Firmware stays disabled.`,
      });
    }
  });
  return issues;
}

function sourceHasName(source: string, name: string): boolean {
  if (name.includes(" ")) return source.includes(name);
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(source);
}

function cmakeIssues(raw: LibrarySourceFile[]): LibraryIssue[] {
  const issues: LibraryIssue[] = [];
  const cmakeFiles = raw.filter((file) => file.name === "CMakeLists.txt" || file.name.endsWith("/CMakeLists.txt"));
  const componentCmake = cmakeFiles.find((file) => !isApplicationCmake(file.data.toString("utf8"), raw, file.name));
  if (!componentCmake) {
    const application = cmakeFiles.find((file) => isApplicationCmake(file.data.toString("utf8"), raw, file.name));
    issues.push({
      level: "error",
      code: "missing_cmake",
      file: application?.name,
      message: application
        ? `${application.name} belongs to the host application. It is not used as the reusable component manifest. Add a component CMakeLists.txt that calls idf_component_register() for the driver sources only.`
        : "No component CMakeLists.txt was uploaded. The component needs idf_component_register() listing its source files, include directory, and required components.",
    });
    return issues;
  }
  const text = componentCmake.data.toString("utf8");
  if (!/idf_component_register\s*\(/.test(text)) {
    issues.push({
      level: "error",
      code: "invalid_cmake",
      file: componentCmake.name,
      message: `${componentCmake.name} does not call idf_component_register(). A filename alone is not a component build configuration.`,
    });
    return issues;
  }
  const root = componentCmake.name.includes("/") ? componentCmake.name.slice(0, componentCmake.name.lastIndexOf("/") + 1) : "";
  for (const match of text.matchAll(/"([^"]+\.(?:c|cpp|h|hpp))"/g)) {
    const referenced = match[1]?.replace(/^\.\//, "");
    if (!referenced || referenced.includes("..")) continue;
    const full = `${root}${referenced}`;
    const present = raw.some((file) => file.name === full || file.name === referenced || file.name.endsWith(`/${referenced}`));
    if (!present) {
      issues.push({
        level: "error",
        code: "missing_file",
        file: componentCmake.name,
        message: `${componentCmake.name} references ${referenced}, but that file was not uploaded.`,
      });
    }
  }
  for (const directory of cmakeDirectories(text, "SRC_DIRS")) {
    const dir = directory === "." ? root.replace(/\/$/, "") : `${root}${directory}`.replace(/\/$/, "");
    const sources = raw.filter((file) => /\.(c|cpp)$/i.test(file.name) && (dir === "" ? !file.name.includes("/") : file.name.startsWith(`${dir}/`)));
    if (sources.length === 0) {
      issues.push({
        level: "error",
        code: "missing_file",
        file: componentCmake.name,
        message: `${componentCmake.name} lists SRC_DIRS "${directory}", but no C or C++ source was uploaded there.`,
      });
    }
  }
  return issues;
}

function applyCompile(issues: LibraryIssue[], compile: NativeCompileReport | null): boolean {
  const structuralErrors = issues.some((issue) => issue.level === "error");
  if (!compile) {
    if (!structuralErrors) {
      issues.push({
        level: "error",
        code: "native_compile_not_run",
        message: "ESP-IDF was not run. A component cannot be saved until the native ESP32-H2 compile check completes with no errors and no warnings. This check does not build or flash a complete device image.",
      });
    } else {
      issues.push({
        level: "info",
        code: "native_compile_skipped",
        message: "Native ESP-IDF compilation was not started because the component structure is not valid yet. This is separate from a complete device firmware build.",
      });
    }
    return false;
  }
  if (!compile.available) {
    issues.push({
      level: "error",
      code: "native_compile_unavailable",
      message: "The ESP-IDF toolchain is not available, so the ESP32-H2 component compile check cannot run. Create Firmware stays disabled.",
    });
    return false;
  }
  if (!compile.ran) {
    issues.push({
      level: structuralErrors ? "info" : "error",
      code: "native_compile_not_run",
      message: structuralErrors
        ? "Native ESP-IDF compilation was not started because the component structure is not valid yet."
        : "ESP-IDF did not compile this component. A component cannot be saved until that ESP32-H2 compile check completes.",
    });
    return false;
  }
  for (const diagnostic of compile.diagnostics) {
    issues.push({
      level: diagnostic.level,
      code: diagnostic.level === "warning" ? "native_compile_warning" : "native_compile_error",
      message: diagnostic.message,
      file: diagnostic.file,
      line: diagnostic.line,
    });
  }
  if (!compile.success) {
    if (!compile.diagnostics.some((diagnostic) => diagnostic.level === "error")) {
      issues.push({
        level: "error",
        code: "native_compile_error",
        message: "The ESP32-H2 component compile check failed. This is a component compilation result, not a flashed device test.",
      });
    }
    return false;
  }
  return compile.success && compile.diagnostics.every((diagnostic) => diagnostic.level !== "error" && diagnostic.level !== "warning");
}

function componentBoundary(files: LibrarySourceFile[]): { files: LibrarySourceFile[]; issues: LibraryIssue[] } {
  const issues: LibraryIssue[] = [];
  const host = files.filter((file) => isHostApplicationFile(file));
  const drivers = files.filter((file) => !host.includes(file) && !isApplicationCmake(file.data.toString("utf8"), files, file.name));
  if (host.length === 0) return { files, issues };
  const driverSources = drivers.filter((file) => /\.(c|cpp)$/i.test(file.name));
  if (driverSources.length === 0) {
    issues.push({
      level: "error",
      code: "host_application",
      file: host[0]?.name,
      message: `${host.map((file) => file.name).join(", ")} is the host Matter application, not a reusable component. Remove app_main and upload the driver sources with their own CMakeLists.txt.`,
    });
    return { files, issues };
  }
  issues.push({
    level: "info",
    code: "host_application_excluded",
      message: `${host.map((file) => file.name).join(", ")} ${host.length === 1 ? "belongs" : "belong"} to the host application and ${host.length === 1 ? "is" : "are"} not part of the reusable component. The component files are ${drivers.map((file) => file.name).join(", ")}.`,
  });
  return { files: drivers, issues };
}

function isHostApplicationFile(file: LibrarySourceFile): boolean {
  const base = file.name.split("/").pop() ?? file.name;
  if (base === "app_main.c" || base === "app_main.cpp") return true;
  return /\bvoid\s+app_main\s*\(/.test(file.data.toString("utf8")) && /\.(c|cpp)$/i.test(base);
}

function isApplicationCmake(text: string, files: LibrarySourceFile[], name: string): boolean {
  if (/\bproject\s*\(/.test(text) || /cmake_minimum_required\s*\(/.test(text)) return true;
  const root = name.includes("/") ? name.slice(0, name.lastIndexOf("/") + 1) : "";
  return cmakeDirectories(text, "SRC_DIRS").some((directory) => {
    const dir = directory === "." ? root.replace(/\/$/, "") : `${root}${directory}`.replace(/\/$/, "");
    return files.some((file) => isHostApplicationFile(file) && (dir === "" ? !file.name.includes("/") : file.name.startsWith(`${dir}/`) || file.name === dir));
  });
}

function cmakeDirectories(text: string, key: string): string[] {
  const match = text.match(new RegExp(`${key}\\s+([^)]*)`, "s"));
  if (!match?.[1]) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1] ?? "").filter((item) => item.length > 0);
}

function integrationContract(files: LibrarySourceFile[]): LibraryIntegration | null {
  const headers = files.filter((file) => /\.(h|hpp)$/i.test(file.name));
  const sources = files.filter((file) => /\.(c|cpp)$/i.test(file.name));
  const pattern = /(?:esp_err_t|void)\s+([A-Za-z_][A-Za-z0-9_]*(?:_init|_register))\s*\(([^)]*)\)/g;
  for (const header of headers) {
    const text = header.data.toString("utf8");
    for (const match of text.matchAll(pattern)) {
      const functionName = match[1] ?? "";
      const params = (match[2] ?? "").trim();
      if (!supportedParameters(params)) continue;
      const defined = sources.some((file) => new RegExp(`(?:esp_err_t|void)\\s+${functionName}\\s*\\(`).test(file.data.toString("utf8")));
      if (!defined) continue;
      const endpointOwnedBy = /uint16_t/.test(params) ? "host" as const : "component" as const;
      const signature = `${match[0].startsWith("void") ? "void" : "esp_err_t"} ${functionName}(${params || "void"})`;
      return { functionName, signature, endpointOwnedBy };
    }
  }
  return null;
}

function supportedParameters(params: string): boolean {
  if (params === "" || params === "void") return true;
  return params.split(",").every((param) => /^\s*(?:const\s+)?(?:uint16_t|uint8_t|int|gpio_num_t)(?:\s+[A-Za-z_][A-Za-z0-9_]*)?\s*$/.test(param));
}

function fixedConnections(profile: LibraryBoardProfile, source: string): { gpio: number; label: string }[] {
  const found: { gpio: number; label: string }[] = [];
  for (const match of source.matchAll(/\bADC_CHANNEL_(\d+)\b/g)) {
    const channel = Number(match[1]);
    const mapped = profile.adc1Channels?.find((item) => item.channel === channel);
    if (!mapped) continue;
    if (!found.some((item) => item.gpio === mapped.gpio)) {
      found.push({ gpio: mapped.gpio, label: `ADC_CHANNEL_${channel}` });
    }
  }
  return found;
}

function isUtf8Text(data: Buffer): boolean {
  if (data.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}
