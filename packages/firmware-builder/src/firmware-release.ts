import { createHash } from "node:crypto";

export const RELEASE_STATES = [
  "draft",
  "build_failed",
  "build_successful",
  "release_candidate",
  "published",
  "superseded",
] as const;

export type ReleaseState = (typeof RELEASE_STATES)[number];

export interface ReleaseIdentity {
  state: ReleaseState;
  softwareVersion: number;
  softwareVersionString: string;
  recipeFingerprint: string;
  buildId: string;
  applicationSha256: string | null;
}

export type CompilationDecision =
  | { action: "reuse"; release: ReleaseIdentity }
  | { action: "busy"; message: string }
  | { action: "allocate"; softwareVersion: number; softwareVersionString: string }
  | { action: "reject"; message: string };

const HELD_STATES = new Set<ReleaseState>(["draft", "build_successful", "release_candidate", "published"]);

export function recipeFingerprint(parts: { versionId: string; gpio: number | null }[]): string {
  const lines = parts
    .map((part) => `${part.versionId}:${part.gpio ?? ""}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function firmwareVersionString(softwareVersion: number): string {
  if (!Number.isInteger(softwareVersion) || softwareVersion < 1) {
    throw new Error("Matter SoftwareVersion must be a positive integer");
  }
  return `1.${softwareVersion - 1}.0`;
}

export function versionIsHeld(release: ReleaseIdentity): boolean {
  if (HELD_STATES.has(release.state)) return true;
  return release.state === "build_failed" && Boolean(release.applicationSha256);
}

export function nextSoftwareVersion(releases: ReleaseIdentity[]): number {
  const held = releases.filter(versionIsHeld).map((release) => release.softwareVersion);
  return Math.max(4, ...held) + 1;
}

export function compilationDecision(input: {
  recipeFingerprint: string;
  releases: ReleaseIdentity[];
  buildRunning: boolean;
  intent: "reuse" | "new-release";
  requestedSoftwareVersion?: number;
}): CompilationDecision {
  const reusable = input.releases
    .filter((release) => release.recipeFingerprint === input.recipeFingerprint)
    .filter((release) => release.state === "release_candidate" || release.state === "published" || release.state === "build_successful")
    .filter((release) => Boolean(release.applicationSha256))
    .sort((left, right) => right.softwareVersion - left.softwareVersion);
  if (input.intent === "reuse") {
    const existing = reusable[0];
    if (existing) return { action: "reuse", release: existing };
    if (input.buildRunning) {
      return { action: "busy", message: "A firmware build is already running. It was not given another SoftwareVersion." };
    }
    const softwareVersion = nextSoftwareVersion(input.releases);
    return { action: "allocate", softwareVersion, softwareVersionString: firmwareVersionString(softwareVersion) };
  }
  if (input.buildRunning) {
    return { action: "busy", message: "A firmware build is already running. A new release version was not assigned." };
  }
  const softwareVersion = nextSoftwareVersion(input.releases);
  if (input.requestedSoftwareVersion !== softwareVersion) {
    return {
      action: "reject",
      message: `The next Matter SoftwareVersion is ${softwareVersion}. Recompiling the current recipe does not choose a version automatically.`,
    };
  }
  return { action: "allocate", softwareVersion, softwareVersionString: firmwareVersionString(softwareVersion) };
}

export interface FlashFit {
  ok: boolean;
  issues: string[];
}

export function flashPackageFit(input: {
  appBytes: number;
  otaSlotBytes: number;
  bootloaderBytes: number;
  bootloaderLimit: number;
  partitionEnd: number;
  flashBytes: number;
}): FlashFit {
  const issues: string[] = [];
  if (input.appBytes <= 0 || input.appBytes > input.otaSlotBytes) {
    issues.push(`The application is ${input.appBytes} bytes and the OTA slot is ${input.otaSlotBytes} bytes.`);
  }
  if (input.bootloaderBytes <= 0 || input.bootloaderBytes > input.bootloaderLimit) {
    issues.push(`The bootloader is ${input.bootloaderBytes} bytes and must fit below offset ${input.bootloaderLimit}.`);
  }
  if (input.partitionEnd > input.flashBytes) {
    issues.push(`The partition table ends at ${input.partitionEnd}, past the ${input.flashBytes}-byte flash.`);
  }
  return { ok: issues.length === 0, issues };
}
