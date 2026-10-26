import type { OtaRequestorReport } from "@iotedu/contracts";
import type { AttributeObservation } from "./identity-read.js";

const REQUESTOR_CLUSTER = 0x002a;
const ACCESS_CONTROL_CLUSTER = 0x001f;
const ACCEPTED_COMMAND_LIST = 0xfff9;
const ANNOUNCE_OTA_PROVIDER = 0;
const OPERATE = 3;

export function interpretOtaRequestor(input: {
  matterNodeId: string;
  reports: AttributeObservation[];
  controllerNodeId: string | null;
  aclFailed: boolean;
}): OtaRequestorReport {
  const value = (clusterId: number, attributeId: number) => input.reports.find((report) => report.kind === "value" && report.clusterId === clusterId && report.attributeId === attributeId)?.value;
  const updatePossibleRaw = value(REQUESTOR_CLUSTER, 0x0001);
  const updatePossible = typeof updatePossibleRaw === "boolean" ? updatePossibleRaw : null;
  const updateState = numberOrNull(value(REQUESTOR_CLUSTER, 0x0002));
  const progressRaw = value(REQUESTOR_CLUSTER, 0x0003);
  const updateStateProgress = progressRaw == null ? null : numberOrNull(progressRaw);
  const providers = value(REQUESTOR_CLUSTER, 0x0000);
  const defaultProviderCount = Array.isArray(providers) ? providers.length : providers == null ? null : null;
  const commands = commandIds(value(REQUESTOR_CLUSTER, ACCEPTED_COMMAND_LIST));
  const announceAccepted = commands == null ? null : commands.includes(ANNOUNCE_OTA_PROVIDER);
  const clusterPresent = updatePossible != null || updateState != null || defaultProviderCount != null || announceAccepted != null;
  const aclValue = value(ACCESS_CONTROL_CLUSTER, 0x0000);
  const aclRead = input.aclFailed ? "failed" : aclValue == null ? "not_checked" : "read";
  const controllerCanAnnounce = aclRead === "read" ? aclAllowsAnnounce(aclValue, input.controllerNodeId) : null;
  const parts = [
    clusterPresent
      ? `The OTA Requestor cluster responded. UpdatePossible is ${updatePossible == null ? "not a boolean" : updatePossible ? "true" : "false"}. UpdateState is ${updateState ?? "not reported"}.`
      : "The OTA Requestor cluster did not return its attributes.",
    announceAccepted == null
      ? "The accepted command list was not read."
      : announceAccepted
        ? "AnnounceOTAProvider is in the accepted command list."
        : "AnnounceOTAProvider is not in the accepted command list.",
    aclRead === "read"
      ? controllerCanAnnounce
        ? "The access-control list grants Operate or higher for this controller on the OTA Requestor or on every cluster. Subjects were not copied into this report, and no entry was changed."
        : "The access-control list does not grant this controller Operate or higher on the OTA Requestor. No entry was changed."
      : aclRead === "failed"
        ? "The access-control list could not be read. No entry was changed."
        : "The access-control list was not requested.",
  ];
  return {
    matterNodeId: input.matterNodeId,
    clusterPresent,
    updatePossible,
    updateState,
    updateStateProgress,
    defaultProviderCount,
    announceAccepted,
    controllerCanAnnounce,
    aclRead,
    detail: parts.join(" "),
  };
}

function aclAllowsAnnounce(value: unknown, controllerNodeId: string | null): boolean {
  return entries(value).some((entry) => {
    const privilege = numberOrNull(entry.privilege ?? entry.privilegeLevel);
    if (privilege == null || privilege < OPERATE) return false;
    const authMode = numberOrNull(entry.authMode);
    if (authMode != null && authMode !== 2) return false;
    if (!subjectMatches(entry.subjects, controllerNodeId)) return false;
    return targetMatches(entry.targets);
  });
}

function entries(value: unknown): Array<Record<string, unknown>> {
  const list = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { entries?: unknown }).entries) ? (value as { entries: unknown[] }).entries : [];
  return list.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
}

function subjectMatches(subjects: unknown, controllerNodeId: string | null): boolean {
  if (subjects == null) return true;
  if (!Array.isArray(subjects) || subjects.length === 0) return true;
  if (!controllerNodeId || !/^\d+$/.test(controllerNodeId)) return false;
  return subjects.some((subject) => idOf(subject) === controllerNodeId);
}

function targetMatches(targets: unknown): boolean {
  if (targets == null) return true;
  if (!Array.isArray(targets) || targets.length === 0) return true;
  return targets.some((target) => {
    if (!target || typeof target !== "object") return false;
    const record = target as Record<string, unknown>;
    const cluster = numberOrNull(record.cluster ?? record.clusterId);
    const endpoint = numberOrNull(record.endpoint ?? record.endpointId);
    return (cluster == null || cluster === REQUESTOR_CLUSTER) && (endpoint == null || endpoint === 0);
  });
}

function commandIds(value: unknown): number[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  return value.map((item) => numberOrNull(typeof item === "object" && item ? (item as { commandId?: unknown }).commandId ?? item : item)).filter((item): item is number => item != null);
}

function idOf(value: unknown): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (value && typeof value === "object" && "nodeId" in value) return idOf((value as { nodeId: unknown }).nodeId);
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  if (value && typeof value === "object" && "value" in value) return numberOrNull((value as { value: unknown }).value);
  return null;
}
