import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ManagedNode, OtaJob, PreflightResult } from "@iotedu/contracts";
import { api } from "../api";
import { formatLocalDateTime } from "../datetime";
import {
  firmwareOptionLabel,
  firmwareVersionLabel,
  otaHistoryEntry,
  otaProgress,
  otaStartEnabled,
  preflightSummary,
  selectionStatus,
  type FirmwareChoice,
} from "../ota-plan";
import { NEW_NODE, loadSelectedNodeId } from "../selection";
import { presenceLabel } from "../setup";

interface ConfigurationNode {
  id: string;
  name: string;
  matterNodeId: string | null;
  softwareVersion: number | null;
  softwareVersionString: string | null;
  connection: string;
  presence: string;
}

interface Configuration {
  liveRead: "read" | "failed" | "unavailable";
  node: ConfigurationNode;
  firmware: FirmwareChoice[];
  plan: {
    current: { components: { name: string }[] } | null;
  };
}

function optionGroups(options: FirmwareChoice[]): { label: string; items: FirmwareChoice[] }[] {
  return [
    { label: "Current", items: options.filter((item) => item.group === "current") },
    { label: "Newer firmware", items: options.filter((item) => item.group === "newer") },
    { label: "Older firmware", items: options.filter((item) => item.group === "older") },
  ].filter((group) => group.items.length > 0);
}

export function PreflightPage() {
  const [params] = useSearchParams();
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [jobs, setJobs] = useState<OtaJob[]>([]);
  const [nodeId, setNodeId] = useState(params.get("node") ?? "");
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [firmwareId, setFirmwareId] = useState("keep");
  const [approved, setApproved] = useState(false);
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [activeJob, setActiveJob] = useState<OtaJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      api<{ nodes: ManagedNode[] }>("/api/nodes"),
      api<{ jobs: OtaJob[] }>("/api/ota/jobs"),
    ]).then(([nodeBody, jobBody]) => {
      setNodes(nodeBody.nodes);
      setJobs(jobBody.jobs);
      setNodeId((current) => {
        if (current) return current;
        const stored = loadSelectedNodeId(window.localStorage);
        const commissioned = nodeBody.nodes.filter((node) => node.matterNodeId);
        return stored !== NEW_NODE && commissioned.some((node) => node.id === stored) ? stored : commissioned[0]?.id ?? "";
      });
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!nodeId) return;
    setFirmwareId("keep");
    setApproved(false);
    setResult(null);
    setDetailsOpen(false);
    api<Configuration>(`/api/nodes/${nodeId}/ota-configuration`)
      .then(setConfiguration)
      .catch((reason: Error) => setError(reason.message));
  }, [nodeId]);

  useEffect(() => {
    const watched = activeJob ?? jobs.find((job) => job.request.nodeId === nodeId && job.status === "running");
    if (!watched || watched.status !== "running") return;
    const timer = window.setInterval(() => {
      void api<{ job: OtaJob }>(`/api/ota/jobs/${watched.id}`).then((body) => {
        setActiveJob(body.job);
        setJobs((current) => current.map((job) => job.id === body.job.id ? body.job : job));
      }).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeJob?.id, activeJob?.status, jobs, nodeId]);

  const node = configuration?.node;
  const registryNode = nodes.find((item) => item.id === nodeId);
  const selected = (configuration?.firmware ?? []).find((item) => item.id === firmwareId);
  const history = jobs
    .filter((job) => !nodeId || job.request.nodeId === nodeId)
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const focused = activeJob && activeJob.request.nodeId === nodeId
    ? activeJob
    : history.find((job) => job.status === "running" || job.verification?.state === "needs_verification" || job.verification?.state === "unavailable") ?? null;
  const progress = otaProgress(focused);
  const needsVerification = history.some((job) => job.verification?.state === "needs_verification" || job.verification?.state === "unavailable" || (job.status === "interrupted" && otaProgress(job).phase === "needs_verification"));
  const artifactReady = Boolean(selected && selected.group === "newer" && selected.compatible && selected.id !== "keep");
  const canStart = otaStartEnabled({
    eligible: Boolean(artifactReady),
    approved,
    preflightAllowed: Boolean(result?.allowed),
    busy,
    needsVerification,
  });
  const functionName = configuration?.plan.current?.components.map((item) => item.name).join(" and ") || registryNode?.name || "Device";
  const liveFirmware = node?.softwareVersionString ?? "unknown";
  const firmwareLine = configuration?.liveRead === "read" ? `Current firmware: ${liveFirmware}` : `Current firmware: Last known ${liveFirmware}`;
  const presence = registryNode ? presenceLabel(registryNode) : node?.connection ?? "Unknown";

  function chooseFirmware(next: string) {
    setFirmwareId(next);
    setApproved(false);
    setResult(null);
    setDetailsOpen(false);
  }

  async function runPreflight() {
    if (!artifactReady || !selected || selected.id === "keep") return;
    setError(null);
    setBusy(true);
    setDetailsOpen(false);
    try {
      const body = await api<PreflightResult>("/api/ota/preflight", {
        method: "POST",
        body: JSON.stringify({
          nodeId,
          buildId: selected.id,
          artifactName: "sensors.ota",
          userApproved: approved,
          confirm: true,
        }),
      });
      setResult(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Preflight failed");
    } finally {
      setBusy(false);
    }
  }

  async function startUpdate() {
    if (!canStart || !selected || selected.id === "keep") return;
    setError(null);
    setBusy(true);
    try {
      const body = await api<{ job: OtaJob }>("/api/ota/jobs", {
        method: "POST",
        body: JSON.stringify({
          nodeId,
          buildId: selected.id,
          artifactName: "sensors.ota",
          userApproved: true,
          confirm: true,
        }),
      });
      setActiveJob(body.job);
      setJobs((current) => [body.job, ...current.filter((job) => job.id !== body.job.id)]);
      setApproved(false);
      setResult(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The update was not started");
    } finally {
      setBusy(false);
    }
  }

  async function checkFirmware(jobId: string) {
    setError(null);
    setBusy(true);
    try {
      const body = await api<{ job: OtaJob }>(`/api/ota/jobs/${jobId}/verify`, { method: "POST", body: "{}" });
      setJobs((current) => current.map((job) => job.id === body.job.id ? body.job : job));
      if (activeJob?.id === body.job.id) setActiveJob(body.job);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The device firmware could not be checked");
    } finally {
      setBusy(false);
    }
  }

  const failedChecks = result?.checks.filter((check) => check.mandatory && check.status !== "passed") ?? [];

  return (
    <section className="stack">
      <header>
        <h1>OTA Updating</h1>
        <p className="lede">Choose a device and a compatible firmware version.</p>
      </header>
      {error && <div className="banner bad">{error}</div>}

      <div className="panel stack">
        <h2>Selected Node</h2>
        <label>
          Device
          <select value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
            {nodes.filter((item) => item.matterNodeId).map((item) => (
              <option key={item.id} value={item.id}>{item.name} · Matter node {item.matterNodeId}</option>
            ))}
          </select>
        </label>
        <p className="muted">{functionName} · Matter node {node?.matterNodeId ?? "not assigned"} · {presence}</p>
        <p className="muted">{firmwareLine}</p>
      </div>

      <div className="panel stack">
        <h2>Firmware Selection</h2>
        <label>
          Firmware
          <select value={firmwareId} onChange={(event) => chooseFirmware(event.target.value)}>
            {optionGroups(configuration?.firmware ?? []).map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((item) => <option key={item.id} value={item.id}>{firmwareOptionLabel(item)}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <p className="muted">{selectionStatus(selected, needsVerification)}</p>
        <p className="muted">Recovery may require a USB connection if the device cannot restart after the update.</p>
        <label className="row">
          <input type="checkbox" checked={approved} onChange={(event) => { setApproved(event.target.checked); setResult(null); }} />
          I approve updating this device's firmware.
        </label>
        <div className="actions">
          <button type="button" className="secondary" disabled title="This firmware is already built.">Prepare Firmware</button>
          <button type="button" className="secondary" disabled={!artifactReady || busy} onClick={() => void runPreflight()}>Run Preflight</button>
          <button type="button" disabled={!canStart} onClick={() => void startUpdate()}>Start OTA Update</button>
        </div>
        {result && <p>{preflightSummary(result)}</p>}
        {result && !result.allowed && (
          <details open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
            <summary>View details</summary>
            <ul>
              {failedChecks.map((check) => <li key={check.id}>{check.label}. {check.detail}</li>)}
            </ul>
          </details>
        )}
      </div>

      <div className="panel stack">
        <h2>Update Progress</h2>
        <p>{progress.title}</p>
        {progress.detail && <p className="muted">{progress.detail}</p>}
        {(progress.percent != null || progress.indeterminate) && (
          <div className="track" aria-hidden="true">
            <div className={`fill${progress.indeterminate ? " indeterminate" : ""}`} style={progress.percent == null ? undefined : { width: `${progress.percent}%` }} />
          </div>
        )}
        {progress.percent != null && <p className="muted">{progress.percent}%</p>}
        {progress.checkable && focused && (
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => void checkFirmware(focused.id)}>Check device firmware</button>
          </div>
        )}
        {focused && (
          <details>
            <summary>View details</summary>
            <ul>
              {focused.stages.map((stage) => <li key={stage.id}>{stage.label}. {stage.detail}</li>)}
            </ul>
          </details>
        )}
      </div>

      <div className="panel">
        <h2>History</h2>
        {history.length === 0 ? <p className="muted">No OTA attempt is stored for this node.</p> : (
          <ul className="file-list">
            {history.map((job) => {
              const entry = otaHistoryEntry(job);
              return (
                <li key={job.id}>
                  <span>
                    {formatLocalDateTime(job.createdAt)}
                    <br />
                    {firmwareVersionLabel(job.previousSoftwareVersion)} → {firmwareVersionLabel(job.expectedSoftwareVersion)}
                    <br />
                    {entry.status}. {entry.detail}
                  </span>
                  <details>
                    <summary>View details</summary>
                    <span className="muted">{job.message}</span>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
