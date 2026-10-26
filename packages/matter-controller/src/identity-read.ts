import { MatterOperationError, type IdentityDiagnostic, type IdentityStage } from "./errors.js";

/** Basic Information cluster, Matter core specification. */
export const BASIC_INFORMATION_CLUSTER_ID = 0x0028;
export const BASIC_INFORMATION_ATTRIBUTES = {
  vendorId: 0x0002,
  productId: 0x0004,
  hardwareVersion: 0x0007,
  hardwareVersionString: 0x0008,
  softwareVersion: 0x0009,
  softwareVersionString: 0x000a,
  serialNumber: 0x000f,
} as const;

const STATUS_UNSUPPORTED_ACCESS = 126;
const STATUS_UNSUPPORTED_ENDPOINT = 127;
const STATUS_UNSUPPORTED_ATTRIBUTE = 134;
const STATUS_NOT_FOUND = 139;
const STATUS_TIMEOUT = 148;
const STATUS_ACCESS_RESTRICTED = 157;
const STATUS_UNSUPPORTED_CLUSTER = 195;

export interface AttributePath {
  endpointId: number;
  clusterId: number;
  attributeId: number;
}

export interface AttributeObservation {
  kind: "value" | "status";
  endpointId: number | null;
  clusterId: number | null;
  attributeId: number | null;
  value?: unknown;
  status?: number;
}

export interface BasicInformationFacts {
  vendorId: number | null;
  productId: number | null;
  hardwareVersion: number | null;
  hardwareVersionString: string | null;
  softwareVersion: number | null;
  softwareVersionString: string | null;
  serialNumber: string | null;
}

export function basicInformationAttributePaths(): AttributePath[] {
  return Object.values(BASIC_INFORMATION_ATTRIBUTES).map((attributeId) => ({
    endpointId: 0,
    clusterId: BASIC_INFORMATION_CLUSTER_ID,
    attributeId,
  }));
}

export function normaliseMac(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  return hex.length === 12 ? hex : null;
}

export function formatMac(hex: string): string {
  return hex.match(/.{2}/g)?.join(":") ?? hex;
}

export function normaliseAttributeReport(report: unknown): AttributeObservation | null {
  if (!report || typeof report !== "object") return null;
  const record = report as Record<string, unknown>;
  const path = record.path && typeof record.path === "object" ? record.path as Record<string, unknown> : record;
  const endpointId = numberOrNull(path.endpointId ?? record.endpointId);
  const clusterId = numberOrNull(path.clusterId ?? record.clusterId);
  const attributeId = numberOrNull(path.attributeId ?? record.attributeId);
  if (record.kind === "attr-status" || record.status != null && record.kind !== "attr-value") {
    const status = numberOrNull(record.status);
    if (status == null) return null;
    return { kind: "status", endpointId, clusterId, attributeId, status };
  }
  if (record.kind === "attr-value" || "value" in record) {
    return { kind: "value", endpointId, clusterId, attributeId, value: record.value };
  }
  return null;
}

export function interpretBasicInformation(
  reports: AttributeObservation[],
  context: { matterNodeId: string | null; elapsedMs: number; attempts: number; sessionOnline: boolean },
): { ok: true; facts: BasicInformationFacts } | { ok: false; error: MatterOperationError } {
  const relevant = reports.filter((report) => report.endpointId == null || report.endpointId === 0);
  const versionReport = attributeReport(relevant, BASIC_INFORMATION_ATTRIBUTES.softwareVersion);
  const versionStatus = statusFor(relevant, BASIC_INFORMATION_ATTRIBUTES.softwareVersion);
  const endpointStatus = relevant.find((report) => report.kind === "status" && report.status === STATUS_UNSUPPORTED_ENDPOINT);
  const clusterStatus = relevant.find((report) =>
    report.kind === "status"
    && report.status === STATUS_UNSUPPORTED_CLUSTER
    && (report.clusterId == null || report.clusterId === BASIC_INFORMATION_CLUSTER_ID));
  const accessStatus = [versionStatus, ...relevant.filter((report) => report.kind === "status")]
    .find((report) => report?.kind === "status" && (report.status === STATUS_UNSUPPORTED_ACCESS || report.status === STATUS_ACCESS_RESTRICTED));

  const base = {
    matterNodeId: context.matterNodeId,
    elapsedMs: context.elapsedMs,
    attempts: context.attempts,
    sessionOnline: context.sessionOnline,
  };

  if (accessStatus?.kind === "status" && (versionStatus === accessStatus || versionReport == null)) {
    return { ok: false, error: identityError("access_denied", accessStatus.status ?? null, BASIC_INFORMATION_ATTRIBUTES.softwareVersion, base,
      `Matter node ${label(context.matterNodeId)} rejected the Basic Information read on endpoint 0, cluster 0x0028, attribute SoftwareVersion 0x0009 (${statusName(accessStatus.status)}). The controller's access-control entry was not changed. Ask an existing administrator to grant this fabric view privilege, then try verification again. The Apple Home fabric was not removed.`) };
  }
  if (endpointStatus?.kind === "status") {
    return { ok: false, error: identityError("endpoint_unavailable", endpointStatus.status ?? null, null, base,
      `Endpoint 0 is not available on Matter node ${label(context.matterNodeId)}. Basic Information was not read and no node record was stored. The Apple Home fabric was not removed.`) };
  }
  if (clusterStatus?.kind === "status") {
    return { ok: false, error: identityError("cluster_unavailable", clusterStatus.status ?? null, null, base,
      `Basic Information cluster 0x0028 is not available on endpoint 0 of Matter node ${label(context.matterNodeId)}. No node record was stored. The Apple Home fabric was not removed.`) };
  }
  if (versionStatus?.kind === "status" && (versionStatus.status === STATUS_UNSUPPORTED_ATTRIBUTE || versionStatus.status === STATUS_NOT_FOUND)) {
    return { ok: false, error: identityError("attribute_missing", versionStatus.status, BASIC_INFORMATION_ATTRIBUTES.softwareVersion, base,
      `SoftwareVersion attribute 0x0009 is missing from Basic Information on endpoint 0 of Matter node ${label(context.matterNodeId)}. No node record was stored.`) };
  }
  if (versionStatus?.kind === "status" && versionStatus.status === STATUS_TIMEOUT) {
    return { ok: false, error: identityError("timeout", versionStatus.status, BASIC_INFORMATION_ATTRIBUTES.softwareVersion, base,
      `The SoftwareVersion read on endpoint 0 timed out for Matter node ${label(context.matterNodeId)}. No node record was stored. Try verification again. The board was not reset.`) };
  }
  if (versionStatus?.kind === "status" && versionReport == null) {
    return { ok: false, error: identityError("protocol_status", versionStatus.status ?? null, BASIC_INFORMATION_ATTRIBUTES.softwareVersion, base,
      `SoftwareVersion 0x0009 returned Matter status ${versionStatus.status} (${statusName(versionStatus.status)}) for Matter node ${label(context.matterNodeId)}. No node record was stored.`) };
  }
  if (versionReport == null) {
    return { ok: false, error: identityError("attribute_missing", null, BASIC_INFORMATION_ATTRIBUTES.softwareVersion, base,
      `The Basic Information read for Matter node ${label(context.matterNodeId)} returned no SoftwareVersion attribute 0x0009. An empty report was not treated as success. No node record was stored.`) };
  }
  const softwareVersion = numberOrNull(versionReport.value);
  if (softwareVersion == null) {
    return { ok: false, error: identityError("parse_failure", null, BASIC_INFORMATION_ATTRIBUTES.softwareVersion, base,
      `SoftwareVersion 0x0009 was returned for Matter node ${label(context.matterNodeId)} but the value could not be decoded as a number. No node record was stored.`) };
  }
  return {
    ok: true,
    facts: {
      vendorId: attributeNumber(relevant, BASIC_INFORMATION_ATTRIBUTES.vendorId),
      productId: attributeNumber(relevant, BASIC_INFORMATION_ATTRIBUTES.productId),
      hardwareVersion: attributeNumber(relevant, BASIC_INFORMATION_ATTRIBUTES.hardwareVersion),
      hardwareVersionString: attributeString(relevant, BASIC_INFORMATION_ATTRIBUTES.hardwareVersionString),
      softwareVersion,
      softwareVersionString: attributeString(relevant, BASIC_INFORMATION_ATTRIBUTES.softwareVersionString),
      serialNumber: attributeString(relevant, BASIC_INFORMATION_ATTRIBUTES.serialNumber),
    },
  };
}

export function serialHardwareMac(serialNumber: string | null): string | null {
  const hex = normaliseMac(serialNumber);
  return hex ? formatMac(hex) : null;
}

export function classifyIdentityThrown(
  error: unknown,
  context: {
    stageHint: IdentityStage;
    sessionOnline: boolean;
    matterNodeId: string | null;
    elapsedMs: number;
    attempts: number;
    phase?: "prepare" | "read";
    storedAddress?: boolean;
  },
): MatterOperationError {
  if (error instanceof MatterOperationError) return error;
  const errorClass = error instanceof Error ? error.name || "Error" : "unknown";
  const message = error instanceof Error ? error.message : "The Matter controller reported a failure.";
  const timedOut = errorClass === "TimeoutError" || /timed out/i.test(message);
  const aborted = errorClass === "AbortedError" || /operation aborted/i.test(message);
  const credential = /certificate|signature|\bnoc\b|fabric mismatch/i.test(message);
  const stage: IdentityStage = context.phase === "prepare"
    ? "locate_peer"
    : credential
      ? "case_session"
    : timedOut || aborted
      ? (context.sessionOnline ? "read_basic_information" : "discover_operational")
      : /discover|not found|no address|mdns|unreachable/i.test(message)
        ? "discover_operational"
        : context.stageHint;
  const completed: IdentityStage[] = context.sessionOnline && stage === "read_basic_information"
    ? ["discover_operational", "case_session"]
    : [];
  const diagnostic: IdentityDiagnostic = {
    stage,
    completed,
    matterNodeId: context.matterNodeId,
    endpointId: stage === "read_basic_information" ? 0 : null,
    clusterId: stage === "read_basic_information" ? BASIC_INFORMATION_CLUSTER_ID : null,
    attributeId: stage === "read_basic_information" ? BASIC_INFORMATION_ATTRIBUTES.softwareVersion : null,
    errorClass: context.phase === "prepare"
      ? "controller_prepare"
      : credential
        ? "credential"
        : !context.sessionOnline && (timedOut || aborted)
          ? (context.storedAddress ? "reachability" : "discovery_timeout")
          : timedOut ? "timeout" : aborted ? "aborted" : errorClass,
    status: null,
    elapsedMs: context.elapsedMs,
    attempts: context.attempts,
  };
  if (context.phase === "prepare") {
    return new MatterOperationError("connection_failed",
      `The stored peer for Matter node ${label(context.matterNodeId)} was not prepared (${context.elapsedMs} ms). This did not start a CASE handshake and did not read Basic Information. No node record was stored. A new Apple Home pairing code was not required. The Apple Home fabric was not removed.`,
      400, diagnostic);
  }
  if (credential && !context.sessionOnline) {
    return new MatterOperationError("connection_failed",
      `Operational credentials were not accepted for Matter node ${label(context.matterNodeId)}. ${message} No node record was stored. A new Apple Home pairing code was not requested and the Apple Home fabric was not removed.`,
      400, diagnostic);
  }
  if (timedOut && context.sessionOnline) {
    return new MatterOperationError("identity_read_failed",
      `The CASE session for Matter node ${label(context.matterNodeId)} is available, but reading SoftwareVersion 0x0009 on endpoint 0, cluster 0x0028 timed out after ${context.attempts} attempt${context.attempts === 1 ? "" : "s"} (${context.elapsedMs} ms). No node record was stored. Try verification again. The board was not reset and the Apple Home fabric was not removed.`,
      400, diagnostic);
  }
  if ((timedOut || aborted) && !context.sessionOnline) {
    return new MatterOperationError("connection_failed",
      `Could not reconnect to the stored Matter device. The device may be offline, unreachable through the Thread network, or associated with a different physical board. Matter node ${label(context.matterNodeId)} produced no CASE session and no Basic Information report after ${context.elapsedMs} ms. A timeout does not show which board this peer belongs to. No node record was stored. The Apple Home fabric was not removed.`,
      400, { ...diagnostic, stage: "discover_operational", completed: [], endpointId: null, clusterId: null, attributeId: null });
  }
  if (aborted && context.sessionOnline) {
    return new MatterOperationError("identity_read_failed",
      `The CASE session for Matter node ${label(context.matterNodeId)} is available, but the Basic Information read on endpoint 0, cluster 0x0028, attribute SoftwareVersion 0x0009 was aborted before a value was decoded (${context.attempts} attempt${context.attempts === 1 ? "" : "s"}, ${context.elapsedMs} ms). No node record was stored. Try verification again. A new Apple Home pairing code was not requested and the Apple Home fabric was not removed.`,
      400, diagnostic);
  }
  if (stage === "discover_operational") {
    return new MatterOperationError("discovery_failed",
      `Operational discovery failed for Matter node ${label(context.matterNodeId)}. ${message} Basic Information was not read and no node record was stored.`,
      400, diagnostic);
  }
  return new MatterOperationError("identity_read_failed",
    `Basic Information on endpoint 0 was not read for Matter node ${label(context.matterNodeId)}. ${message} No node record was stored.`,
    400, diagnostic);
}

export function compareFirmwareIdentity(
  facts: BasicInformationFacts,
  expected: {
    vendorId?: number | null;
    productId?: number | null;
    softwareVersion?: number | null;
    softwareVersionString?: string | null;
  },
): { match: true } | { match: false; message: string } {
  if (expected.softwareVersion != null && facts.softwareVersion !== expected.softwareVersion) {
    return { match: false, message: `The device reported SoftwareVersion ${facts.softwareVersion}. The selected installation expects ${expected.softwareVersion}. The node was not registered.` };
  }
  if (expected.softwareVersionString && facts.softwareVersionString == null) {
    return { match: false, message: `The device reported SoftwareVersion ${facts.softwareVersion} without SoftwareVersionString. The selected installation expects ${expected.softwareVersionString}. The node was not registered.` };
  }
  if (expected.softwareVersionString && facts.softwareVersionString !== expected.softwareVersionString) {
    return { match: false, message: `The device reported firmware ${facts.softwareVersionString}. The selected installation expects ${expected.softwareVersionString}. The node was not registered.` };
  }
  if (expected.vendorId != null && facts.vendorId == null) {
    return { match: false, message: "VendorID 0x0002 was not in the Basic Information report. The node was not registered." };
  }
  if (expected.vendorId != null && facts.vendorId !== expected.vendorId) {
    return { match: false, message: `The device reported VendorID ${facts.vendorId}. The selected installation expects ${expected.vendorId}. The node was not registered.` };
  }
  if (expected.productId != null && facts.productId == null) {
    return { match: false, message: "ProductID 0x0004 was not in the Basic Information report. The node was not registered." };
  }
  if (expected.productId != null && facts.productId !== expected.productId) {
    return { match: false, message: `The device reported ProductID ${facts.productId}. The selected installation expects ${expected.productId}. The node was not registered.` };
  }
  return { match: true };
}

export type HardwareLink =
  | { result: "not_requested" }
  | { result: "matched"; mac: string }
  | { result: "mismatched"; reportedMac: string; expectedMac: string }
  | { result: "unproven"; reason: string };

export function linkHardware(serialNumber: string | null, expectedMac: string | null | undefined): HardwareLink {
  if (expectedMac == null || expectedMac.trim() === "") return { result: "not_requested" };
  const expected = normaliseMac(expectedMac);
  if (!expected) return { result: "unproven", reason: "The selected hardware MAC is not a 48-bit address." };
  const reported = normaliseMac(serialNumber);
  if (!reported) {
    return { result: "unproven", reason: "Basic Information did not include a serial number that matches a hardware MAC." };
  }
  if (reported === expected) return { result: "matched", mac: reported };
  return { result: "mismatched", reportedMac: reported, expectedMac: expected };
}

export function logIdentityDiagnostic(detail: IdentityDiagnostic | null, message: string): void {
  if (!detail) return;
  console.info(JSON.stringify({
    source: "iotedu-identity-read",
    message,
    stage: detail.stage,
    completed: detail.completed,
    matterNodeId: detail.matterNodeId,
    endpointId: detail.endpointId,
    clusterId: detail.clusterId,
    attributeId: detail.attributeId,
    errorClass: detail.errorClass,
    status: detail.status,
    elapsedMs: detail.elapsedMs,
    attempts: detail.attempts,
  }));
}

function identityError(
  errorClass: string,
  status: number | null,
  attributeId: number | null,
  context: { matterNodeId: string | null; elapsedMs: number; attempts: number; sessionOnline: boolean },
  message: string,
): MatterOperationError {
  const completed: IdentityStage[] = context.sessionOnline ? ["discover_operational", "case_session"] : [];
  return new MatterOperationError("identity_read_failed", message, 400, {
    stage: "read_basic_information",
    completed,
    matterNodeId: context.matterNodeId,
    endpointId: 0,
    clusterId: BASIC_INFORMATION_CLUSTER_ID,
    attributeId,
    errorClass,
    status,
    elapsedMs: context.elapsedMs,
    attempts: context.attempts,
  });
}

function attributeReport(reports: AttributeObservation[], attributeId: number): AttributeObservation | null {
  return reports.find((report) =>
    report.kind === "value"
    && report.clusterId === BASIC_INFORMATION_CLUSTER_ID
    && report.attributeId === attributeId) ?? null;
}

function statusFor(reports: AttributeObservation[], attributeId: number): AttributeObservation | null {
  return reports.find((report) =>
    report.kind === "status"
    && (report.clusterId == null || report.clusterId === BASIC_INFORMATION_CLUSTER_ID)
    && (report.attributeId == null || report.attributeId === attributeId)) ?? null;
}

function attributeNumber(reports: AttributeObservation[], attributeId: number): number | null {
  return numberOrNull(attributeReport(reports, attributeId)?.value);
}

function attributeString(reports: AttributeObservation[], attributeId: number): string | null {
  const value = attributeReport(reports, attributeId)?.value;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "value" in value) return numberOrNull((value as { value: unknown }).value);
  if (value && typeof value === "object" && "valueOf" in value) {
    const primitive = value.valueOf();
    if (primitive !== value) return numberOrNull(primitive);
  }
  return null;
}

function statusName(status: number | null | undefined): string {
  switch (status) {
    case STATUS_UNSUPPORTED_ACCESS: return "Unsupported Access";
    case STATUS_ACCESS_RESTRICTED: return "Access Restricted";
    case STATUS_UNSUPPORTED_ENDPOINT: return "Unsupported Endpoint";
    case STATUS_UNSUPPORTED_CLUSTER: return "Unsupported Cluster";
    case STATUS_UNSUPPORTED_ATTRIBUTE: return "Unsupported Attribute";
    case STATUS_NOT_FOUND: return "Not Found";
    case STATUS_TIMEOUT: return "Timeout";
    default: return status == null ? "no status" : `status ${status}`;
  }
}

function label(matterNodeId: string | null): string {
  return matterNodeId ?? "unknown";
}
