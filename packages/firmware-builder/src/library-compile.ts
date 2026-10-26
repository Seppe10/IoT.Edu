import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { LibrarySourceFile, NativeCompileReport } from "./library-validation.js";

const execFileAsync = promisify(execFile);
const COMPILE_TIMEOUT_MS = 1_200_000;

export async function compileLibraryComponent(
  files: LibrarySourceFile[],
  overrides: { idfPath?: string | null; run?: (project: string) => Promise<{ code: number; text: string }> } = {},
): Promise<NativeCompileReport> {
  const idfPath = overrides.idfPath === undefined ? await findTool("IDF_PATH", "esp/esp-idf") : overrides.idfPath;
  if (!idfPath) {
    return { available: false, ran: false, success: false, diagnostics: [] };
  }
  const hash = createHash("sha256").update(files.map((file) => `${file.name}:${createHash("sha256").update(file.data).digest("hex")}`).sort().join("\n")).digest("hex");
  const cachePath = path.join(tmpdir(), "iotedu-component-compile", `${hash}.json`);
  if (!overrides.run) {
    try {
      return JSON.parse(await readFile(cachePath, "utf8")) as NativeCompileReport;
    } catch {
      // A cache miss runs the compiler. Failures are not cached.
    }
  }
  const project = await mkdtemp(path.join(tmpdir(), "iotedu-idf-"));
  try {
    await writeHarness(project, files);
    const script = [
      `source "${idfPath}/export.sh" >/dev/null`,
      `cd "${project}"`,
      `idf.py -B "${path.join(project, "build")}" set-target esp32h2`,
      `idf.py -B "${path.join(project, "build")}" build`,
    ].join(" && ");
    const matterPath = await findTool("ESP_MATTER_PATH", "esp/esp-matter");
    const result = overrides.run
      ? await overrides.run(project)
      : await execFileAsync("bash", ["-lc", script], {
        timeout: COMPILE_TIMEOUT_MS,
        maxBuffer: 2_000_000,
        env: { ...process.env, IDF_PATH: idfPath, ...(matterPath ? { ESP_MATTER_PATH: matterPath } : {}) },
      }).then((output) => ({ code: 0, text: `${output.stdout}\n${output.stderr}` }), (error: { code?: number; stdout?: string; stderr?: string; killed?: boolean }) => ({
        code: error.killed ? 124 : error.code ?? 1,
        text: `${error.killed ? "The ESP-IDF component check exceeded its time limit and was stopped before it could finish.\n" : ""}${error.stdout ?? ""}\n${error.stderr ?? ""}`,
      }));
    const diagnostics = compilerDiagnostics(result.text);
    if (result.code !== 0 && diagnostics.length === 0) {
      const summary = result.text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).slice(-6).join(" ");
      diagnostics.push({ level: "error", message: (summary || "The ESP-IDF component check failed.").slice(0, 500) });
    }
    if (result.code !== 0 && /zap-generated|data_model\/generated/.test(result.text)) {
      diagnostics.unshift({
        level: "error",
        message: "ESP-Matter integration compilation did not finish. This driver includes ESP-Matter headers, and the ESP-Matter component needs generated data-model sources from a host application configure. This check did not build or flash a device image.",
      });
    }
    const report: NativeCompileReport = {
      available: true,
      ran: true,
      success: result.code === 0 && diagnostics.every((item) => item.level !== "error"),
      diagnostics,
    };
    if (!overrides.run && report.success && report.diagnostics.length === 0) {
      await mkdir(path.dirname(cachePath), { recursive: true });
      await writeFile(cachePath, JSON.stringify(report)).catch(() => undefined);
    }
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The ESP-IDF component check could not start.";
    return {
      available: true,
      ran: true,
      success: false,
      diagnostics: [{ level: "error", message }],
    };
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

async function writeHarness(project: string, files: LibrarySourceFile[]): Promise<void> {
  const component = path.join(project, "components/uploaded");
  await mkdir(path.join(project, "main"), { recursive: true });
  await mkdir(component, { recursive: true });
  for (const file of files) {
    if (file.name.endsWith("CMakeLists.txt")) continue;
    const destination = path.join(component, file.name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.data);
  }
  const matter = files.some((file) => file.data.includes("esp_matter.h"));
  const matterPath = matter ? await findTool("ESP_MATTER_PATH", "esp/esp-matter") : null;
  await writeFile(path.join(component, "CMakeLists.txt"), `${componentRegister(files, matter)}\n`);
  await writeFile(path.join(project, "main/CMakeLists.txt"), `idf_component_register(SRCS "main.c" REQUIRES uploaded)\n`);
  await writeFile(path.join(project, "main/main.c"), "void app_main(void) {}\n");
  const extra = matterPath
    ? `set(ESP_MATTER_PATH "${matterPath}")\nset(MATTER_SDK_PATH "\${ESP_MATTER_PATH}/connectedhomeip/connectedhomeip")\nset(EXTRA_COMPONENT_DIRS "\${ESP_MATTER_PATH}/components" "\${MATTER_SDK_PATH}/config/esp32/components")\n`
    : "";
  await writeFile(path.join(project, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.16)\n${extra}include($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(iotedu_component_check)\n`);
  if (matterPath) {
    await writeFile(path.join(project, "sdkconfig.defaults"), [
      "CONFIG_ENABLE_WIFI_STATION=n",
      "CONFIG_ENABLE_WIFI_AP=n",
      "CONFIG_ENABLE_MATTER_OVER_THREAD=y",
      "CONFIG_OPENTHREAD_ENABLED=y",
      "CONFIG_OPENTHREAD_SRP_CLIENT=y",
      "",
    ].join("\n"));
  }
}

export function componentRegister(files: LibrarySourceFile[], matter: boolean): string {
  const cmake = files.find((file) => /(^|\/)CMakeLists\.txt$/.test(file.name)
    && /idf_component_register\s*\(/.test(file.data.toString("utf8"))
    && !/\bproject\s*\(/.test(file.data.toString("utf8")));
  const body = cmake?.data.toString("utf8").match(/idf_component_register\s*\(([\s\S]*?)\)/)?.[1] ?? "";
  const values = (key: string) => {
    const match = body.match(new RegExp(`\\b${key}\\s+([\\s\\S]*?)(?=\\b(?:SRCS|SRC_DIRS|INCLUDE_DIRS|REQUIRES|PRIV_REQUIRES|EMBED)\\b|$)`));
    return [...(match?.[1] ?? "").matchAll(/"([^"]+)"|([A-Za-z0-9_./+-]+)/g)].map((item) => item[1] || item[2] || "").filter((item) => item.length > 0);
  };
  const root = cmake?.name.includes("/") ? cmake.name.slice(0, cmake.name.lastIndexOf("/") + 1) : "";
  const fromDirs = values("SRC_DIRS").flatMap((directory) => {
    const dir = directory === "." ? root.replace(/\/$/, "") : `${root}${directory}`.replace(/\/$/, "");
    return files.filter((file) => /\.(c|cpp)$/i.test(file.name) && (dir === "" ? !file.name.includes("/") : file.name.startsWith(`${dir}/`))).map((file) => file.name);
  });
  const listed = values("SRCS").map((source) => `${root}${source.replace(/^\.\//, "")}`);
  const chosen = (listed.length > 0 ? listed : fromDirs);
  const sources = (chosen.length > 0 ? chosen : files.filter((file) => /\.(c|cpp)$/i.test(file.name)).map((file) => file.name))
    .map((name) => `"${name}"`)
    .join(" ");
  const includes = (values("INCLUDE_DIRS").length > 0 ? values("INCLUDE_DIRS") : ["."]).map((dir) => `"${dir}"`).join(" ");
  const requires = [...new Set([...values("REQUIRES"), ...values("PRIV_REQUIRES"), "esp_adc", ...(matter ? ["esp_matter"] : [])])];
  return `idf_component_register(SRCS ${sources} INCLUDE_DIRS ${includes} REQUIRES ${requires.join(" ")})`;
}

function compilerDiagnostics(text: string): NativeCompileReport["diagnostics"] {
  const diagnostics: NativeCompileReport["diagnostics"] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/([^/\s][^:]*\.(?:c|cc|cpp|h|hpp)):(\d+):\d+:\s+(error|warning):\s+(.+)$/);
    if (!match) continue;
    diagnostics.push({
      level: match[3] === "warning" ? "warning" : "error",
      file: match[1],
      line: Number(match[2]),
      message: `${match[3] === "warning" ? "Compiler warning" : "Compiler error"} in ${match[1]}:${match[2]}: ${match[4]}`,
    });
    if (diagnostics.length >= 12) break;
  }
  if (diagnostics.length === 0 && /error:/i.test(text)) {
    const summary = text.split(/\r?\n/).filter((line) => /error:/i.test(line)).slice(-3).join(" ");
    diagnostics.push({ level: "error", message: summary.slice(0, 500) || "The ESP-IDF component check failed." });
  }
  return diagnostics;
}

async function findTool(envName: string, fallback: string): Promise<string | null> {
  const candidates = [process.env[envName], path.join(homedir(), fallback)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next location.
    }
  }
  return null;
}
