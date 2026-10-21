import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { BuildJob, ManagedNode, OtaJob, PreflightResult } from "@iotedu/contracts";
import { api } from "../api";

export function PreflightPage() {
  const [params] = useSearchParams();
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [builds, setBuilds] = useState<BuildJob[]>([]);
  const [nodeId, setNodeId] = useState(params.get("node") ?? "");
  const [buildId, setBuildId] = useState("");
  const [approved, setApproved] = useState(false);
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [job, setJob] = useState<OtaJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ nodes: ManagedNode[] }>("/api/nodes"),
      api<{ jobs: BuildJob[] }>("/api/builds"),
    ]).then(([nodeBody, buildBody]) => {
      setNodes(nodeBody.nodes);
      setBuilds(buildBody.jobs);
      setNodeId((current) => current || nodeBody.nodes[0]?.id || "");
      setBuildId(buildBody.jobs[0]?.id ?? "");
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  const selectedBuild = builds.find((build) => build.id === buildId);
  const artifactName = selectedBuild?.artifacts[0]?.name ?? "";
  const node = nodes.find((item) => item.id === nodeId);

  async function runPreflight() {
    setError(null);
    const body = await api<PreflightResult>("/api/ota/preflight", {
      method: "POST",
      body: JSON.stringify({ nodeId, buildId, artifactName, userApproved: approved, confirm: true }),
    });
    setResult(body);
  }

  async function deploy() {
    setError(null);
    const response = await fetch("/api/ota/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId, buildId, artifactName, userApproved: approved, confirm: true }),
    });
    const body = (await response.json()) as { job?: OtaJob; error?: { message: string } };
    if (body.job) setJob(body.job);
    if (body.job?.status === "blocked") return;
    if (!response.ok) setError(body.error?.message ?? body.job?.message ?? "Deployment was not started");
  }

  return (
    <section className="stack">
      <header>
        <h1>OTA Preflight</h1>
        <p className="lede">One node at a time. A failed or unknown mandatory check blocks deployment. There is no percentage because no transfer is running.</p>
      </header>
      {error && <div className="banner bad">{error}</div>}
      <div className="panel stack">
        <label>
          Node
          <select value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
            {nodes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          Package
          <select value={buildId} onChange={(event) => setBuildId(event.target.value)}>
            {builds.map((item) => <option key={item.id} value={item.id}>{item.request.softwareVersionString} · {item.simulated ? "simulated" : item.status}</option>)}
          </select>
        </label>
        <p className="muted">
          Installed version: {node?.softwareVersionString ?? "not read"}. Candidate: {selectedBuild?.request.softwareVersionString ?? "none"}.
          Artifact: {artifactName || "none"}.
        </p>
        <label className="row">
          <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />
          I approve an attempt to deploy this package to the selected node only.
        </label>
        <div className="row">
          <button type="button" className="secondary" disabled={!nodeId || !buildId} onClick={() => void runPreflight()}>Run preflight</button>
          <button type="button" disabled={!result?.allowed || !approved} onClick={() => void deploy()}>Deploy</button>
          <button type="button" className="secondary" disabled={!result || result.allowed} onClick={() => void deploy()}>Save blocked preflight</button>
        </div>
      </div>
      {result && (
        <div className="panel">
          <h2>{result.allowed ? "Allowed" : "Blocked"}</h2>
          <p>{result.message}</p>
          <div className="checks">
            {result.checks.map((check) => (
              <div className="check" key={check.id}>
                <span className={`pill ${check.status}`}>{check.status}</span>
                <div><strong>{check.label}</strong><div className="muted">{check.detail}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}
      {job && <Link className="button" to={`/ota/jobs/${job.id}`}>Open deployment record</Link>}
      <p className="muted">Power warning: leave the board powered for any future transfer. This screen has not started one.</p>
    </section>
  );
}
