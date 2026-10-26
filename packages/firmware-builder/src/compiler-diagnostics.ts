export interface CompilerDiagnostic {
  origin: "component" | "sdk";
  level: "warning" | "error";
  file: string;
  message: string;
}

const DIAGNOSTIC_LINE = /^(.+?):(\d+):\d+: (warning|error): (.*)$/;

export function classifyCompilerOutput(text: string, workspaceDir: string): CompilerDiagnostic[] {
  const workspace = workspaceDir.replaceAll("\\", "/");
  const diagnostics: CompilerDiagnostic[] = [];
  let inlinedFrom = "";
  for (const line of text.split(/\r?\n/)) {
    const inlined = line.match(/inlined from '.*' at ([^:\s]+):\d+:\d+:/);
    if (inlined?.[1]) inlinedFrom = inlined[1].replaceAll("\\", "/");
    const match = line.match(DIAGNOSTIC_LINE);
    if (match?.[1] && match[3] && match[4]) {
      const file = match[1].replaceAll("\\", "/");
      const context = inlinedFrom ? `Inlined from ${inlinedFrom}. ` : "";
      diagnostics.push({
        origin: componentPath(file, workspace) ? "component" : "sdk",
        level: match[3] === "warning" ? "warning" : "error",
        file,
        message: (context + match[4]).slice(0, 300),
      });
      inlinedFrom = "";
      continue;
    }
    if (line.includes("CMake Error")) {
      diagnostics.push({
        origin: componentPath(line.replaceAll("\\", "/"), workspace) ? "component" : "sdk",
        level: "error",
        file: "",
        message: line.slice(0, 300),
      });
    }
  }
  return diagnostics;
}

export function readIdfVersion(text: string): string | null {
  return text.match(/ESP-IDF v([0-9]+\.[0-9]+\.[0-9]+)/)?.[1]
    ?? text.match(/\.espressif\/v([0-9]+\.[0-9]+\.[0-9]+)\/esp-idf\//)?.[1]
    ?? null;
}

function componentPath(file: string, workspaceDir: string): boolean {
  const marker = workspaceDir.endsWith("/") ? workspaceDir : `${workspaceDir}/`;
  return file.includes(`${marker}main/`) || file.includes(`${marker}components/`);
}
