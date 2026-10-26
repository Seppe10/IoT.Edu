import type { EraseAssessment } from "@iotedu/contracts";
import { describe, expect, it } from "vitest";
import { recoveryChecks } from "./recovery-checks.js";

const empty = {
  enabled: false,
  blockers: [],
  downloadModeWarning: "download",
  port: null,
  consolePort: null,
  device: null,
  security: null,
  backup: null,
  firmware: { ready: false, buildId: null, detail: "No package.", credentialMode: "unknown" },
  toolchain: { available: false, detail: "ESP-IDF v5.4.1 is not installed." },
  previouslyCommissionedBlocksErase: false,
} as EraseAssessment;

describe("recovery checks", () => {
  it("keeps unread security and a missing backup unverified", () => {
    const checks = recoveryChecks(empty);
    expect(checks.find((item) => item.id === "secure-boot")?.status).toBe("Not Verified");
    expect(checks.find((item) => item.id === "integrity")?.status).toBe("Not Verified");
    expect(checks.find((item) => item.id === "toolchain")?.status).toBe("Blocked");
    expect(checks.every((item) => item.status !== "Verified" || item.id === "unused")).toBe(true);
  });

  it("blocks an enabled secure-boot fuse and does not treat a command success as backup integrity", () => {
    const checks = recoveryChecks({
      ...empty,
      toolchain: { available: true, detail: "ready" },
      security: {
        known: true,
        secureBoot: "enabled",
        flashEncryption: "disabled",
        downloadMode: "allowed",
        usbDownload: "allowed",
        reflashable: false,
        detail: "Secure Boot is enabled.",
      },
      backup: {
        id: "backup-1",
        mac: "48:31:b7:cf:3d:52",
        chip: "ESP32-H2",
        revision: "v0.1",
        flashSizeBytes: 4_194_304,
        flashMode: "dio",
        flashFrequency: "48m",
        createdAt: "2026-10-23T12:00:00.000Z",
        location: "/backups/example",
        verified: false,
        suitableForRestore: false,
        complete: false,
        credentialMode: "example_dac",
        firmwareBuildId: "build",
        regions: [],
        partitionTableSha256: "abc",
      },
    });
    expect(checks.find((item) => item.id === "secure-boot")?.status).toBe("Blocked");
    expect(checks.find((item) => item.id === "encryption")?.status).toBe("Verified");
    expect(checks.find((item) => item.id === "integrity")?.status).toBe("Blocked");
    expect(checks.find((item) => item.id === "factory")?.status).toBe("Not Verified");
  });

  it("treats factory data as preserved only after a verified backup, not because a backup can be created", () => {
    const unverified = recoveryChecks({
      ...empty,
      firmware: { ready: true, buildId: "build", detail: "Ready.", credentialMode: "example_dac" },
      backup: {
        id: "backup-1",
        mac: "48:31:b7:cf:3d:52",
        chip: "ESP32-H2",
        revision: "v0.1",
        flashSizeBytes: 4_194_304,
        flashMode: "dio",
        flashFrequency: "48m",
        createdAt: "2026-10-23T12:00:00.000Z",
        location: "/backups/example",
        verified: false,
        suitableForRestore: false,
        complete: true,
        credentialMode: "example_dac",
        firmwareBuildId: "build",
        regions: [],
        partitionTableSha256: "abc",
      },
    });
    expect(unverified.find((item) => item.id === "factory")?.status).toBe("Not Verified");
    const verified = recoveryChecks({
      ...empty,
      enabled: true,
      firmware: { ready: true, buildId: "build", detail: "Ready.", credentialMode: "example_dac" },
      backup: {
        id: "backup-1",
        mac: "48:31:b7:cf:3d:52",
        chip: "ESP32-H2",
        revision: "v0.1",
        flashSizeBytes: 4_194_304,
        flashMode: "dio",
        flashFrequency: "48m",
        createdAt: "2026-10-23T12:00:00.000Z",
        location: "/backups/example",
        verified: true,
        suitableForRestore: true,
        complete: true,
        credentialMode: "example_dac",
        firmwareBuildId: "build",
        regions: [],
        partitionTableSha256: "abc",
      },
    });
    expect(verified.find((item) => item.id === "factory")?.status).toBe("Verified");
    expect(verified.find((item) => item.id === "factory")?.detail).toMatch(/verified backup/);
  });
});
