import { describe, expect, it } from "vitest";
import { firmwareOptionLabel, firmwareVersionLabel, otaHistoryEntry, otaProgress, otaStartEnabled, selectionStatus, type OtaJobView } from "./ota-plan";

function transferred(status: OtaJobView["status"]): OtaJobView {
  return {
    status,
    message: "Download finished.",
    previousSoftwareVersion: 10,
    expectedSoftwareVersion: 12,
    installedVersionConfirmed: false,
    createdAt: "2026-10-25T09:24:18.289Z",
    stages: [
      { id: "transfer_started", state: "observed", detail: "1602754 of 1602754 bytes transferred (100% of the length reported by the BDX session)." },
      { id: "transfer_completed", state: "observed", detail: "The BDX session reported that the offered byte count was transferred." },
      { id: "applying", state: "interrupted", detail: "The controller restarted." },
    ],
  };
}

describe("OTA firmware labels", () => {
  it("names the keep option from the live version", () => {
    expect(firmwareOptionLabel({
      id: "keep",
      group: "current",
      softwareVersion: 10,
      softwareVersionString: "1.9.0",
      state: "release_candidate",
      productId: 0x8002,
      compatible: true,
      detail: "matched",
    })).toBe("Keep current firmware — 1.9.0 / SoftwareVersion 10");
  });

  it("labels newer and older releases from the catalogue", () => {
    expect(firmwareOptionLabel({
      id: "build",
      group: "older",
      softwareVersion: 9,
      softwareVersionString: "1.8.0",
      state: "release_candidate",
      productId: 0x8002,
      compatible: false,
      detail: "historical",
    })).toBe("Older · 1.8.0 / SoftwareVersion 9 · release candidate");
    expect(firmwareVersionLabel(12)).toBe("1.11.0");
  });

  it("starts an update only for an eligible package after approval and preflight", () => {
    expect(otaStartEnabled({ eligible: false, approved: true, preflightAllowed: true, busy: false, needsVerification: false })).toBe(false);
    expect(otaStartEnabled({ eligible: true, approved: false, preflightAllowed: true, busy: false, needsVerification: false })).toBe(false);
    expect(otaStartEnabled({ eligible: true, approved: true, preflightAllowed: false, busy: false, needsVerification: false })).toBe(false);
    expect(otaStartEnabled({ eligible: true, approved: true, preflightAllowed: true, busy: true, needsVerification: false })).toBe(false);
    expect(otaStartEnabled({ eligible: true, approved: true, preflightAllowed: true, busy: false, needsVerification: true })).toBe(false);
    expect(otaStartEnabled({ eligible: true, approved: true, preflightAllowed: true, busy: false, needsVerification: false })).toBe(true);
  });

  it("keeps a finished download out of the completed state until the device is read", () => {
    const progress = otaProgress(transferred("interrupted"));
    expect(progress.phase).toBe("needs_verification");
    expect(progress.title).toBe("Update status needs checking.");
    expect(progress.percent).toBeNull();
    expect(progress.checkable).toBe(true);
    expect(otaHistoryEntry(transferred("interrupted"))).toMatchObject({
      status: "Needs verification",
      detail: "Download completed; installation confirmation was interrupted.",
    });
    expect(selectionStatus({ id: "keep", group: "current", softwareVersion: 10, softwareVersionString: "1.9.0", state: null, productId: 0x8002, compatible: true, detail: "" }, true))
      .toBe("Unable to update — previous update outcome requires verification.");
  });

  it("shows a transfer percentage only while bytes are moving", () => {
    const job = transferred("running");
    job.stages = job.stages.filter((stage) => stage.id === "transfer_started");
    expect(otaProgress(job)).toMatchObject({ phase: "downloading", percent: 100 });
  });
});
