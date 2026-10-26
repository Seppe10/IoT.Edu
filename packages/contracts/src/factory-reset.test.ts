import { describe, expect, it } from "vitest";
import { onboardingDecision } from "./hardware-installation.js";
import {
  FACTORY_RESET_WATCH_SECONDS,
  GPIO9_LONG_PRESS_MS,
  assessFactoryResetCapture,
  commissioningOverlayFromReset,
  factoryResetConsoleRecovery,
  managedNodeAfterResetDecision,
} from "./factory-reset.js";

const verifiedIdentity = {
  writeCompleted: true,
  bootVerified: true,
  matterReady: true,
  threadReady: true,
  versionVerified: true,
  softwareVersion: 4,
  softwareVersionString: "1.3.0",
  vendorId: 0xfff1,
  productId: 0x8000,
};

describe("factory reset evidence", () => {
  it("keeps the GPIO9 hold at five seconds and the watch long enough for release and reboot", () => {
    expect(GPIO9_LONG_PRESS_MS).toBe(5000);
    expect(FACTORY_RESET_WATCH_SECONDS).toBeGreaterThanOrEqual(30);
    expect(FACTORY_RESET_WATCH_SECONDS).toBeGreaterThan(GPIO9_LONG_PRESS_MS / 1000);
  });

  it("does not treat a five-second hold, or a reboot alone, as a completed reset", () => {
    const held = assessFactoryResetCapture("Factory reset triggered. Release the button to start factory reset.");
    expect(held.stage).toBe("hold_detected");
    expect(held.affectsStoredCredentials).toBe(false);
    expect(commissioningOverlayFromReset({ ...held, mac: "48:31:b7:cf:37:b7" })?.state).toBe("unknown");
    const rebooted = assessFactoryResetCapture("rst:0x1 (POWERON)\nBluetooth MAC: 48:31:b7:cf:37:b7\nVendorId 0x1384\nFabric already commissioned");
    expect(rebooted.stage).toBe("reboot_without_reset");
    expect(commissioningOverlayFromReset(rebooted)).toBeNull();
  });

  it("records a reset event without a following boot as incomplete", () => {
    const started = assessFactoryResetCapture([
      "Factory reset triggered. Release the button to start factory reset.",
      "Starting factory reset",
    ].join("\n"));
    expect(started.stage).toBe("reset_started");
    expect(started.conclusive).toBe(false);
    const restarting = assessFactoryResetCapture("Starting factory reset\nPerforming factory reset\nSystem restarting");
    expect(restarting.stage).toBe("reboot_pending");
  });

  it("accepts a fabric-free boot after reset and still hides an unverified QR", () => {
    const log = [
      "VendorId 0x1384",
      "Fabric already commissioned",
      "Starting factory reset",
      "Performing factory reset",
      "System restarting",
      "rst:0x1 (POWERON)",
      "Bluetooth MAC: 48:31:b7:cf:37:b7",
      "Server Listening...",
      "commissioning mode 1",
      "CHIPoBLE advertising started",
    ].join("\n");
    const assessment = assessFactoryResetCapture(log, "48:31:B7:CF:37:B7");
    expect(assessment.stage).toBe("verified_fabric_free");
    expect(assessment.fabricRetrieved).toBe(false);
    expect(assessment.bleAdvertising).toBe(true);
    expect(assessment.mac).toBe("48:31:b7:cf:37:b7");
    expect(assessment.identityConflict).toBe(false);
    const overlay = commissioningOverlayFromReset(assessment);
    expect(overlay?.state).toBe("uncommissioned");
    expect(overlay?.fabricVendors).toEqual([]);
    expect(onboardingDecision({
      ...verifiedIdentity,
      commissioningState: "uncommissioned",
      commissioningWindowOpen: null,
      onboardingStatus: "not_verified",
      onboardingReason: "Onboarding Payload — Not Verified. The boot log does not contain the discriminator.",
    }).show).toBe(false);
  });

  it("keeps a fabric retrieved after reset as current and does not call the reset successful", () => {
    const log = [
      "Starting factory reset",
      "rst:0x1 (POWERON)",
      "Bluetooth MAC: 48:31:b7:cf:37:b7",
      "Server Listening...",
      "Fabric index 0x2 was retrieved from storage. VendorId 0x1384",
      "Fabric already commissioned",
      "commissioning mode 0",
    ].join("\n");
    const assessment = assessFactoryResetCapture(log);
    expect(assessment.stage).toBe("fabric_still_present");
    expect(assessment.fabricVendors).toEqual(["1384"]);
    expect(assessment.conclusive).toBe(true);
    expect(commissioningOverlayFromReset(assessment)?.state).toBe("commissioned");
  });

  it("does not follow a replacement serial port or mix two ESP32-H2 identities", () => {
    expect(factoryResetConsoleRecovery({
      watchedPort: "/dev/cu.usbmodem5B610393331",
      portsNow: ["/dev/cu.usbmodem143401"],
    })).toEqual({ disconnected: true, followedNewPort: false });
    const mixed = [
      "rst:0x1 (POWERON)",
      "Bluetooth MAC: 48:31:b7:cf:37:5f",
      "Starting factory reset",
      "rst:0x1 (POWERON)",
      "Bluetooth MAC: 48:31:b7:cf:37:b7",
      "Server Listening...",
      "commissioning mode 1",
      "CHIPoBLE advertising started",
    ].join("\n");
    const assessment = assessFactoryResetCapture(mixed, "48:31:b7:cf:37:b7");
    expect(assessment.identityConflict).toBe(true);
    expect(assessment.mac).toBeNull();
    expect(commissioningOverlayFromReset(assessment)).toBeNull();
  });

  it("relinks only the reset board and leaves an unrelated managed node alone", () => {
    const nodes = [
      { id: "board-b7", hardwareMac: "48:31:B7:CF:37:B7", matterNodeId: "2", operationalReverification: "required" as const },
      { id: "board-5f", hardwareMac: "48:31:B7:CF:37:5F", matterNodeId: "3", operationalReverification: null },
      { id: "other", hardwareMac: "48:31:B7:CF:3D:52", matterNodeId: "1", operationalReverification: null },
    ];
    expect(managedNodeAfterResetDecision({ nodes, reportedMac: "4831B7CF37B7", matterNodeId: "9" })).toEqual({ action: "relink", nodeId: "board-b7" });
    expect(managedNodeAfterResetDecision({ nodes, reportedMac: "4831B7CF375F", matterNodeId: "9" })).toEqual({ action: "reject", nodeId: "board-5f" });
    expect(managedNodeAfterResetDecision({ nodes, reportedMac: "4831B7CF3D54", matterNodeId: "9" }).action).toBe("create");
    expect(managedNodeAfterResetDecision({
      nodes: nodes.map((node) => node.id === "board-b7" ? { ...node, operationalReverification: null } : node),
      reportedMac: "4831B7CF37B7",
      matterNodeId: "9",
    })).toEqual({ action: "reject", nodeId: "board-b7" });
  });
});
