import { describe, expect, it } from "vitest";
import {
  BASIC_INFORMATION_ATTRIBUTES,
  BASIC_INFORMATION_CLUSTER_ID,
  basicInformationAttributePaths,
  classifyIdentityThrown,
  compareFirmwareIdentity,
  interpretBasicInformation,
  linkHardware,
  normaliseAttributeReport,
} from "./identity-read.js";

const context = { matterNodeId: "1", elapsedMs: 25, attempts: 1, sessionOnline: true };

function value(attributeId: number, attributeValue: unknown) {
  return {
    kind: "value" as const,
    endpointId: 0,
    clusterId: BASIC_INFORMATION_CLUSTER_ID,
    attributeId,
    value: attributeValue,
  };
}

describe("Basic Information attribute reads", () => {
  it("requests the endpoint 0 Basic Information attributes instead of the whole endpoint", () => {
    const paths = basicInformationAttributePaths();
    expect(paths.every((path) => path.endpointId === 0 && path.clusterId === 0x0028 && path.attributeId != null)).toBe(true);
    expect(paths.map((path) => path.attributeId)).toEqual([
      BASIC_INFORMATION_ATTRIBUTES.vendorId,
      BASIC_INFORMATION_ATTRIBUTES.productId,
      BASIC_INFORMATION_ATTRIBUTES.hardwareVersion,
      BASIC_INFORMATION_ATTRIBUTES.hardwareVersionString,
      BASIC_INFORMATION_ATTRIBUTES.softwareVersion,
      BASIC_INFORMATION_ATTRIBUTES.softwareVersionString,
      BASIC_INFORMATION_ATTRIBUTES.serialNumber,
    ]);
  });

  it("decodes a Matter.js attribute report for the installed controller", () => {
    const report = normaliseAttributeReport({
      kind: "attr-value",
      path: { endpointId: 0, clusterId: 0x0028, attributeId: 0x0009 },
      value: 4,
    });
    expect(report).toMatchObject({ kind: "value", attributeId: 0x0009, value: 4 });
    const read = interpretBasicInformation([
      value(0x0002, 0xfff1),
      value(0x0004, 0x8000),
      value(0x0009, 4),
      value(0x000a, "1.3.0"),
      value(0x000f, "4831B7CF375F"),
    ], context);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.facts.softwareVersion).toBe(4);
    expect(read.facts.softwareVersionString).toBe("1.3.0");
    expect(read.facts.vendorId).toBe(0xfff1);
    expect(read.facts.productId).toBe(0x8000);
    expect(compareFirmwareIdentity(read.facts, {
      vendorId: 0xfff1,
      productId: 0x8000,
      softwareVersion: 4,
      softwareVersionString: "1.3.0",
    }).match).toBe(true);
  });

  it("keeps a CASE session successful when the attribute read is aborted", () => {
    const error = classifyIdentityThrown(Object.assign(new Error("Operation aborted"), { name: "AbortedError" }), {
      stageHint: "case_session",
      sessionOnline: true,
      matterNodeId: "1",
      elapsedMs: 40,
      attempts: 3,
    });
    expect(error.code).toBe("identity_read_failed");
    expect(error.detail).toMatchObject({
      stage: "read_basic_information",
      completed: ["discover_operational", "case_session"],
      errorClass: "aborted",
      endpointId: 0,
      clusterId: 0x0028,
      attributeId: 0x0009,
      attempts: 3,
    });
    expect(error.message).toMatch(/CASE session/);
    expect(error.message).toMatch(/aborted/);
  });

  it("does not claim CASE succeeded when the session never came up", () => {
    const error = classifyIdentityThrown(new Error("Operation aborted"), {
      stageHint: "case_session",
      sessionOnline: false,
      matterNodeId: "1",
      elapsedMs: 12,
      attempts: 1,
    });
    expect(error.code).toBe("connection_failed");
    expect(error.detail?.stage).toBe("discover_operational");
    expect(error.detail?.errorClass).toBe("discovery_timeout");
    expect(error.detail?.completed).toEqual([]);
    expect(error.message).toMatch(/Could not reconnect to the stored Matter device/);
    expect(error.message).not.toMatch(/pairing mode/);
    expect(error.message).not.toMatch(/CASE session for Matter node 1 is available/);
  });

  it("keeps a stored-address timeout separate from a CASE handshake and a pairing code", () => {
    const error = classifyIdentityThrown(new Error("Operational reconnect timed out"), {
      stageHint: "case_session",
      sessionOnline: false,
      matterNodeId: "1",
      elapsedMs: 45006,
      attempts: 1,
      phase: "read",
      storedAddress: true,
    });
    expect(error.detail).toMatchObject({ stage: "discover_operational", errorClass: "reachability", completed: [] });
    expect(error.message).toMatch(/45006/);
    expect(error.message).toMatch(/does not show which board/);
    expect(error.message).not.toMatch(/pairing mode/);
  });

  it("reports endpoint, cluster, missing attribute, timeout, access, and parse failures separately", () => {
    expect(interpretBasicInformation([{ kind: "status", endpointId: 0, clusterId: null, attributeId: null, status: 127 }], context).ok).toBe(false);
    const endpoint = interpretBasicInformation([{ kind: "status", endpointId: 0, clusterId: null, attributeId: null, status: 127 }], context);
    if (endpoint.ok) throw new Error("expected endpoint failure");
    expect(endpoint.error.detail?.errorClass).toBe("endpoint_unavailable");

    const cluster = interpretBasicInformation([{ kind: "status", endpointId: 0, clusterId: 0x28, attributeId: null, status: 195 }], context);
    if (cluster.ok) throw new Error("expected cluster failure");
    expect(cluster.error.detail?.errorClass).toBe("cluster_unavailable");

    const missing = interpretBasicInformation([value(0x0002, 0xfff1)], context);
    if (missing.ok) throw new Error("expected missing SoftwareVersion");
    expect(missing.error.detail?.errorClass).toBe("attribute_missing");

    const unexpected = interpretBasicInformation([value(0x0009, 3), value(0x000a, "1.2.0")], context);
    if (!unexpected.ok) throw new Error("a readable unexpected version is still a successful read");
    expect(compareFirmwareIdentity(unexpected.facts, { softwareVersion: 4, softwareVersionString: "1.3.0" }).match).toBe(false);

    const timeout = interpretBasicInformation([{ kind: "status", endpointId: 0, clusterId: 0x28, attributeId: 0x0009, status: 148 }], context);
    if (timeout.ok) throw new Error("expected timeout");
    expect(timeout.error.detail?.errorClass).toBe("timeout");

    const denied = interpretBasicInformation([{ kind: "status", endpointId: 0, clusterId: 0x28, attributeId: 0x0009, status: 126 }], context);
    if (denied.ok) throw new Error("expected access denial");
    expect(denied.error.detail).toMatchObject({ errorClass: "access_denied", status: 126 });
    expect(denied.error.message).toMatch(/access-control entry was not changed/);

    const restricted = interpretBasicInformation([{ kind: "status", endpointId: 0, clusterId: 0x28, attributeId: 0x0009, status: 157 }], context);
    if (restricted.ok) throw new Error("expected restriction");
    expect(restricted.error.detail?.errorClass).toBe("access_denied");

    const parsed = interpretBasicInformation([value(0x0009, { unexpected: true })], context);
    if (parsed.ok) throw new Error("expected parse failure");
    expect(parsed.error.detail?.errorClass).toBe("parse_failure");
  });

  it("matches a serial number to one hardware MAC and refuses the previous board", () => {
    expect(linkHardware("4831B7CF375F", "48:31:b7:cf:37:5f")).toEqual({ result: "matched", mac: "4831B7CF375F" });
    expect(linkHardware("48:31:B7:CF:3D:52", "48:31:b7:cf:37:5f")).toMatchObject({
      result: "mismatched",
      reportedMac: "4831B7CF3D52",
      expectedMac: "4831B7CF375F",
    });
    expect(linkHardware(null, "48:31:b7:cf:37:5f").result).toBe("unproven");
    expect(linkHardware("4831B7CF375F", null)).toEqual({ result: "not_requested" });
  });
});
