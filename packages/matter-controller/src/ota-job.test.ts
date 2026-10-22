import { describe, expect, it } from "vitest";
import type { OtaJob } from "@iotedu/contracts";
import { applyProviderEvent, confirmInstalledVersion, initialOtaStages, interruptRunningJob } from "./ota-job.js";

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
});
