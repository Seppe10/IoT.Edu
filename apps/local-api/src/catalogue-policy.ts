export const STORAGE_LIMIT_BYTES = 1_073_741_824;
export const STORAGE_WARNING_BYTES = 700 * 1024 * 1024;
export const STORAGE_CRITICAL_BYTES = 800 * 1024 * 1024;
export const STORAGE_STOP_BYTES = 850 * 1024 * 1024;

export type StorageLevel = "ok" | "warning" | "critical" | "stopped" | "unknown";

export function storageDecision(currentBytes: number | null, additionalBytes: number): { allow: boolean; level: StorageLevel; message: string } {
  if (currentBytes == null || !Number.isFinite(currentBytes)) {
    return {
      allow: false,
      level: "unknown",
      message: "Database storage could not be measured. The import was not started.",
    };
  }
  const projected = currentBytes + Math.max(0, additionalBytes);
  const level: StorageLevel = projected >= STORAGE_STOP_BYTES
    ? "stopped"
    : projected >= STORAGE_CRITICAL_BYTES
      ? "critical"
      : projected >= STORAGE_WARNING_BYTES
        ? "warning"
        : "ok";
  if (level === "stopped") {
    return {
      allow: false,
      level,
      message: "This write would pass the 850 MB safeguard. It was rejected so the 1 GB Neon allowance is not exhausted.",
    };
  }
  return { allow: true, level, message: level === "ok" ? "Storage is within the normal budget." : "Storage is above the warning threshold." };
}

export function deduplicatedSize(files: { hash: string; bytes: number }[]): { uniqueCount: number; uniqueBytes: number; duplicateBytes: number } {
  const seen = new Map<string, number>();
  let duplicateBytes = 0;
  for (const file of files) {
    const existing = seen.get(file.hash);
    if (existing == null) seen.set(file.hash, file.bytes);
    else duplicateBytes += file.bytes;
  }
  let uniqueBytes = 0;
  for (const bytes of seen.values()) uniqueBytes += bytes;
  return { uniqueCount: seen.size, uniqueBytes, duplicateBytes };
}

export interface PinChoice {
  componentName: string;
  connectionName: string;
  gpio: number | null;
}

export function gpioAssignmentIssues(pins: PinChoice[], reserved: { gpio: number; reason: string }[]): string[] {
  const issues: string[] = [];
  const used = new Map<number, string>();
  for (const pin of pins) {
    if (pin.gpio == null) {
      issues.push(`${pin.componentName} ${pin.connectionName} has no GPIO assignment.`);
      continue;
    }
    const reservedPin = reserved.find((item) => item.gpio === pin.gpio);
    if (reservedPin) issues.push(`${pin.componentName} cannot use GPIO ${pin.gpio}: ${reservedPin.reason}.`);
    const previous = used.get(pin.gpio);
    const label = `${pin.componentName} ${pin.connectionName}`;
    if (previous) issues.push(`GPIO ${pin.gpio} is required by both ${previous} and ${label}.`);
    else used.set(pin.gpio, label);
  }
  return issues;
}
