import { describe, expect, it } from "vitest";
import {
  compilationDecision,
  firmwareVersionString,
  flashPackageFit,
  recipeFingerprint,
  type ReleaseIdentity,
} from "./firmware-release.js";
import { assessCompilerDiagnostics } from "./sdk-warning-baseline.js";

const recipe = recipeFingerprint([
  { versionId: "matter-core-iotedu-r2", gpio: null },
  { versionId: "custom-dht11-r2", gpio: 4 },
]);

const candidate: ReleaseIdentity = {
  state: "release_candidate",
  softwareVersion: 5,
  softwareVersionString: "1.4.0",
  recipeFingerprint: recipe,
  buildId: "87e7ff73-5342-42d9-9fdf-25e7c57dac1f",
  applicationSha256: "4261e4fd1c59d4b2b3235bf20be19ca0c2a1baa8c3fbadfd56098e5baebe7efb",
};

describe("firmware release versions", () => {
  it("reuses 1.4.0 for the same recipe and ignores a failed attempt", () => {
    const failed: ReleaseIdentity = { ...candidate, state: "build_failed", softwareVersion: 9, applicationSha256: null, buildId: "failed" };
    const decision = compilationDecision({
      recipeFingerprint: recipe,
      releases: [candidate, failed],
      buildRunning: false,
      intent: "reuse",
    });
    expect(decision).toEqual({ action: "reuse", release: candidate });
    expect(firmwareVersionString(5)).toBe("1.4.0");
  });

  it("assigns the next version only when a new release is requested", () => {
    const rejected = compilationDecision({
      recipeFingerprint: recipe,
      releases: [candidate],
      buildRunning: false,
      intent: "new-release",
    });
    expect(rejected.action).toBe("reject");
    const allocated = compilationDecision({
      recipeFingerprint: recipe,
      releases: [candidate],
      buildRunning: false,
      intent: "new-release",
      requestedSoftwareVersion: 6,
    });
    expect(allocated).toEqual({ action: "allocate", softwareVersion: 6, softwareVersionString: "1.5.0" });
  });

  it("does not assign a version while a build is running", () => {
    const decision = compilationDecision({
      recipeFingerprint: recipe,
      releases: [candidate],
      buildRunning: true,
      intent: "new-release",
      requestedSoftwareVersion: 6,
    });
    expect(decision.action).toBe("busy");
  });

  it("accepts the recorded SDK warnings and blocks a new component warning", () => {
    const baseline = assessCompilerDiagnostics([
      { origin: "sdk", level: "warning", file: "OpenthreadLauncher.cpp", message: "defined but not used" },
      { origin: "sdk", level: "warning", file: "esp_matter_core.cpp", message: "nodiscard" },
    ]);
    expect(baseline.blocksDeployment).toBe(false);
    const introduced = assessCompilerDiagnostics([
      { origin: "component", level: "warning", file: "main/dht11_matter.cpp", message: "unused" },
    ]);
    expect(introduced.blocksDeployment).toBe(true);
  });

  it("checks the 1.4.0 image against the ESP32-H2 flash map", () => {
    const fit = flashPackageFit({
      appBytes: 1_592_992,
      otaSlotBytes: 0x1e0000,
      bootloaderBytes: 21_696,
      bootloaderLimit: 0xc000,
      partitionEnd: 0x3e6000,
      flashBytes: 4_194_304,
    });
    expect(fit.ok).toBe(true);
  });
});
