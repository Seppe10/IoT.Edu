/**
 * Third-party diagnostics accepted for ESP-IDF 5.4.1, ESP-Matter 2cb668c95de4f24786d20b7cb03c171d6e27b79e,
 * and connectedhomeip 8f943388af4d12dc5c484eae21b22723e03c3616.
 * These warnings are compiled into SDK translation units. They are not IoT.Edu component diagnostics.
 */
export const SDK_WARNING_BASELINE = {
  idf: "5.4.1",
  espMatter: "2cb668c95de4f24786d20b7cb03c171d6e27b79e",
  connectedhomeip: "8f943388af4d12dc5c484eae21b22723e03c3616",
  acceptedFragments: [
    "OpenthreadLauncher.cpp",
    "esp_netif_next",
    "esp_matter_core.cpp",
    "CameraAvSettingsUserLevelManagementCluster.cpp",
    "color-control-server.cpp",
    "Encode.h",
  ],
} as const;

export interface WarningClass {
  file: string;
  message: string;
  origin: "component" | "sdk";
  level: "warning" | "error";
}

export interface WarningAssessment {
  accepted: WarningClass[];
  unexpected: WarningClass[];
  blocksDeployment: boolean;
  reason: string;
}

export function assessCompilerDiagnostics(diagnostics: WarningClass[]): WarningAssessment {
  const accepted: WarningClass[] = [];
  const unexpected: WarningClass[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.origin === "sdk" && diagnostic.level === "warning" && baselineWarning(diagnostic)) {
      accepted.push(diagnostic);
    } else {
      unexpected.push(diagnostic);
    }
  }
  const blocksDeployment = unexpected.length > 0;
  return {
    accepted,
    unexpected,
    blocksDeployment,
    reason: blocksDeployment
      ? "A component diagnostic or an SDK diagnostic outside the recorded toolchain baseline blocks deployment."
      : "The remaining warnings match the recorded third-party toolchain baseline. They do not block this development release.",
  };
}

function baselineWarning(diagnostic: WarningClass): boolean {
  const text = `${diagnostic.file}\n${diagnostic.message}`;
  return SDK_WARNING_BASELINE.acceptedFragments.some((fragment) => text.includes(fragment));
}
