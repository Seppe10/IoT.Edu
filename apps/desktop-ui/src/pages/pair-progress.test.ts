import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { appleHomeStepStates, existingFabricStepStates, initialDeviceSetupState, managedRecordMessage, pairingCodeVisible, planDeviceSetup, PRIMARY_SETUP_ACTION, recoveryFor } from "./pair-progress";

describe("Apple Home secondary commissioning progress", () => {
  it("waits for a pairing code before any network step", () => {
    const states = appleHomeStepStates({
      submitted: false,
      stage: null,
      verified: false,
      simulated: false,
      failed: false,
      failureCode: null,
    });
    expect(states.code).toBe("active");
    expect(states.discover).toBe("pending");
    expect(states.ready).toBe("pending");
  });

  it("keeps discovery, pairing, and fabric active together until the controller reports the read", () => {
    const states = appleHomeStepStates({
      submitted: true,
      stage: "discovering",
      verified: false,
      simulated: false,
      failed: false,
      failureCode: null,
    });
    expect(states.discover).toBe("active");
    expect(states.session).toBe("active");
    expect(states.fabric).toBe("active");
    expect(states.case).toBe("pending");
    expect(states.ready).toBe("pending");
  });

  it("marks every step done only after firmware verification", () => {
    const states = appleHomeStepStates({
      submitted: true,
      stage: "ready",
      verified: true,
      simulated: false,
      failed: false,
      failureCode: null,
    });
    expect(Object.values(states).every((state) => state === "done")).toBe(true);
  });

  it("does not mark a simulated record as commissioned", () => {
    const states = appleHomeStepStates({
      submitted: true,
      stage: null,
      verified: false,
      simulated: true,
      failed: false,
      failureCode: null,
    });
    expect(states.discover).toBe("pending");
    expect(states.ready).toBe("pending");
  });

  it("shows an expired window on the pairing step", () => {
    const states = appleHomeStepStates({
      submitted: true,
      stage: "discovering",
      verified: false,
      simulated: false,
      failed: true,
      failureCode: "commissioning_window_expired",
    });
    expect(states.session).toBe("failed");
    expect(states.fabric).toBe("pending");
    expect(recoveryFor("commissioning_window_expired")).toMatch(/turn pairing mode on again/);
    expect(recoveryFor("commissioning_window_expired")).toMatch(/factory-reset/);
  });

  it("marks Basic Information failure separately from CASE", () => {
    const states = appleHomeStepStates({
      submitted: true,
      stage: "verifying_firmware",
      verified: false,
      simulated: false,
      failed: true,
      failureCode: "identity_read_failed",
    });
    expect(states.case).toBe("done");
    expect(states.version).toBe("failed");
    expect(states.ready).toBe("pending");
    expect(recoveryFor("identity_read_failed")).toMatch(/Try verification again/);
    expect(recoveryFor("existing_fabric")).toMatch(/unverified Matter peer/);
    expect(recoveryFor("connection_failed", "recover")).toMatch(/Could not reconnect/);
    expect(recoveryFor("connection_failed", "recover")).not.toMatch(/pairing mode/);
  });

  it("shows a failed CASE session without marking the node ready", () => {
    const states = appleHomeStepStates({
      submitted: true,
      stage: "verifying_firmware",
      verified: false,
      simulated: false,
      failed: true,
      failureCode: "connection_failed",
    });
    expect(states.case).toBe("failed");
    expect(states.version).toBe("pending");
    expect(states.ready).toBe("pending");
    expect(recoveryFor("connection_failed")).toMatch(/did not remove the Apple Home fabric/);
  });

  it("maps an existing-fabric Basic Information failure without blaming discovery", () => {
    const states = existingFabricStepStates({
      started: true,
      verified: false,
      active: null,
      completed: ["locate_peer", "discover_operational", "case_session"],
      failed: "read_basic_information",
    });
    expect(states.locate_peer).toBe("done");
    expect(states.discover_operational).toBe("done");
    expect(states.case_session).toBe("done");
    expect(states.read_basic_information).toBe("failed");
    expect(states.verify_identity).toBe("pending");
    expect(states.register_node).toBe("pending");
    expect(recoveryFor("peer_mismatch")).toMatch(/different board/);
    expect(managedRecordMessage({
      matterNodeId: "1",
      softwareVersion: 4,
      hardwareMac: "48:31:B7:CF:3D:52",
    }, "48:31:b7:cf:37:5f")).toMatch(/new Apple Home pairing code can add the selected board/);
    expect(managedRecordMessage({
      matterNodeId: "1",
      softwareVersion: 4,
      hardwareMac: "48:31:B7:CF:37:5F",
    }, "48:31:b7:cf:37:5f")).toMatch(/not required/);
  });

  it("does not mark later existing-fabric stages done before they run", () => {
    const waiting = existingFabricStepStates({
      started: false,
      verified: false,
      active: null,
      completed: [],
      failed: null,
    });
    expect(waiting.locate_peer).toBe("pending");
    expect(waiting.case_session).toBe("pending");
    const verified = existingFabricStepStates({
      started: true,
      verified: true,
      active: null,
      completed: [],
      failed: null,
    });
    expect(Object.values(verified).every((state) => state === "done")).toBe(true);
  });

  it("chooses one operation from the stored peers and selected board", () => {
    expect(planDeviceSetup({ selectedMac: "48:31:b7:cf:37:5f", nodes: [], peers: [] })).toMatchObject({
      operation: "commission",
      ambiguous: false,
    });
    expect(pairingCodeVisible("commission")).toBe(true);
    expect(pairingCodeVisible("recover")).toBe(false);
    expect(planDeviceSetup({
      selectedMac: "48:31:b7:cf:37:5f",
      nodes: [{ matterNodeId: "4", hardwareMac: "48:31:B7:CF:37:5F" }],
      peers: [],
    }).operation).toBe("recover");
    expect(planDeviceSetup({
      selectedMac: "48:31:b7:cf:37:5f",
      nodes: [{ matterNodeId: "1", hardwareMac: "48:31:B7:CF:3D:52" }],
      peers: [],
    })).toMatchObject({ operation: "commission", ambiguous: false });
    expect(planDeviceSetup({
      selectedMac: "48:31:b7:cf:37:5f",
      nodes: [],
      peers: [{ matterNodeId: "1" }],
    })).toMatchObject({ operation: "recover", ambiguous: true });
    expect(initialDeviceSetupState()).toEqual({ started: false, operation: null });
    expect(PRIMARY_SETUP_ACTION).toBe("Continue Device Setup");
  });

  it("keeps one primary action and does not commission while the page loads", async () => {
    const page = await readFile(new URL("./PairPage.tsx", import.meta.url), "utf8");
    expect(page.split("PRIMARY_SETUP_ACTION")).toHaveLength(3);
    expect(page).not.toContain("Verify existing IoT.Edu fabric");
    const effect = page.slice(page.indexOf("useEffect(() => {"), page.indexOf("}, []);"));
    expect(effect).not.toContain("/api/nodes/recover");
    expect(effect).not.toContain("/api/nodes/commission");
  });
});
