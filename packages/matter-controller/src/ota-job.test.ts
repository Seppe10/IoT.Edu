import { describe, expect, it } from "vitest";
import type { OtaJob } from "@iotedu/contracts";
import { applyProviderEvent, confirmInstalledVersion, initialOtaStages, interruptRunningJob, reconcileObservedFirmware } from "./ota-job.js";

function job(): OtaJob {
  const now = "2026-10-22T00:00:00.000Z";
  return {
    id: "job-1",
    simulated: false,
    status: "running",
    request: { nodeId: "node-1", buildId: "build-1", artifactName: "sensors.ota", userApproved: true, confirm: true },
    preflight: { allowed: true, checks: [], message: "Preflight passed." },
    stages: initialOtaStages(),
    matterNodeId: "42",
    expectedSoftwareVersion: 3,
    previousSoftwareVersion: 2,
    installedVersionConfirmed: false,
    message: "Running.",
    createdAt: now,
    updatedAt: now,
  };
}

describe("OTA deployment states", () => {
  it("keeps a finished transfer incomplete until the new SoftwareVersion is read", () => {
    const record = job();
    applyProviderEvent(record, { type: "bdx-start", matterNodeId: "42", detail: "BDX session started." });
    applyProviderEvent(record, { type: "bdx-complete", matterNodeId: "42", detail: "BDX finished." });
    expect(record.status).toBe("running");
    expect(record.installedVersionConfirmed).toBe(false);
    expect(record.stages.find((stage) => stage.id === "transfer_completed")?.state).toBe("observed");
    expect(record.stages.find((stage) => stage.id === "version_verified")?.state).toBe("not_observed");
    confirmInstalledVersion(record, 2, null);
    expect(record.status).toBe("running");
    applyProviderEvent(record, { type: "applying", matterNodeId: "42", detail: "ApplyUpdateRequest received." });
    confirmInstalledVersion(record, 2, null);
    expect(record.status).toBe("running");
    expect(record.message).toMatch(/still reports SoftwareVersion 2/);
    confirmInstalledVersion(record, 3, null);
    expect(record.status).toBe("succeeded");
    const progress = job();
    applyProviderEvent(progress, { type: "bdx-start", matterNodeId: "42", detail: "BDX session started." });
    applyProviderEvent(progress, { type: "bdx-progress", matterNodeId: "42", detail: "progress", bytesTransferred: 4096, totalBytes: 8192 });
    expect(progress.status).toBe("running");
    expect(progress.stages.find((stage) => stage.id === "transfer_started")?.detail).toMatch(/4096 of 8192 bytes/);
    expect(progress.installedVersionConfirmed).toBe(false);
    expect(record.installedVersionConfirmed).toBe(true);
    expect(record.stages.find((stage) => stage.id === "version_verified")?.state).toBe("observed");
  });

  it("records an interrupted transfer without retrying it", () => {
    const record = job();
    applyProviderEvent(record, { type: "bdx-start", matterNodeId: "42", detail: "BDX session started." });
    applyProviderEvent(record, { type: "bdx-interrupted", matterNodeId: "42", detail: "BDX timed out." });
    expect(record.status).toBe("interrupted");
    expect(record.installedVersionConfirmed).toBe(false);
    expect(record.message).toMatch(/not started again/);
  });

  it("marks a restart as interrupted and does not call the update a success", () => {
    const record = job();
    interruptRunningJob(record, "The controller restarted. The image was not offered again.");
    expect(record.status).toBe("interrupted");
    expect(record.installedVersionConfirmed).toBe(false);
    expect(JSON.stringify(record)).not.toMatch(/MT:|passcode|PRIVATE KEY/);
  });

  it("records an unread device as unknown and does not offer the image again", () => {
    const record = job();
    record.status = "interrupted";
    reconcileObservedFirmware(record, {
      reachable: false,
      softwareVersion: null,
      softwareVersionString: null,
      vendorId: null,
      productId: null,
      endpoints: null,
    }, { vendorId: 0xfff1, productId: 0x8002, deviceTypes: [0x0106] });
    expect(record.status).toBe("interrupted");
    expect(record.verification?.state).toBe("unavailable");
    expect(record.installedVersionConfirmed).toBe(false);
    expect(record.message).toMatch(/not offered again/);
  });

  it("records the previous SoftwareVersion as not installed", () => {
    const record = job();
    record.status = "interrupted";
    record.previousSoftwareVersion = 10;
    record.expectedSoftwareVersion = 12;
    reconcileObservedFirmware(record, {
      reachable: true,
      softwareVersion: 10,
      softwareVersionString: "1.9.0",
      vendorId: 0xfff1,
      productId: 0x8002,
      endpoints: [{ endpointId: 0, deviceTypes: [0x0016], serverClusters: [0x002a] }, { endpointId: 1, deviceTypes: [0x010d], serverClusters: [] }],
    }, { vendorId: 0xfff1, productId: 0x8002, deviceTypes: [0x0106] });
    expect(record.status).not.toBe("succeeded");
    expect(record.verification?.state).toBe("not_installed");
    expect(record.installedVersionConfirmed).toBe(false);
  });

  it("confirms installation only when the version, identity and device type match", () => {
    const record = job();
    record.expectedSoftwareVersion = 12;
    record.previousSoftwareVersion = 10;
    reconcileObservedFirmware(record, {
      reachable: true,
      softwareVersion: 12,
      softwareVersionString: "1.11.0",
      vendorId: 0xfff1,
      productId: 0x8002,
      endpoints: [{ endpointId: 0, deviceTypes: [0x0016], serverClusters: [0x002a] }, { endpointId: 2, deviceTypes: [0x0106], serverClusters: [] }],
    }, { vendorId: 0xfff1, productId: 0x8002, deviceTypes: [0x0106] });
    expect(record.status).toBe("succeeded");
    expect(record.verification?.state).toBe("installed");
    expect(record.installedVersionConfirmed).toBe(true);
  });
});
