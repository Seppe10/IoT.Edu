import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { BuildJob, ComponentManifest, FirmwareVerification, ManagedNode, ValidationResult } from "@iotedu/contracts";
import { ApiError, api } from "../api";

interface LayoutResponse {
  layoutId: string;
  partitions: Array<{ name: string; offset: number; size: number }>;
}

function verificationLabel(job: BuildJob): string {
  const verification: FirmwareVerification | null = job.verification ?? (job.simulated ? "simulated" : null);
  if (verification === "hardware_verified") return "Hardware-verified";
  if (verification === "compiled") return "Compiled";
  if (verification === "simulated") return "Simulated";
  if (job.status === "running") return "Building";
  if (job.status === "failed") return "Failed";
  if (job.status === "interrupted") return "Cancelled";
  return job.status;
}

export function BuilderPage() {
  const [params] = useSearchParams();
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [components, setComponents] = useState<ComponentManifest[]>([]);
  const [layout, setLayout] = useState<LayoutResponse | null>(null);
  const [history, setHistory] = useState<BuildJob[]>([]);
  const [nodeId, setNodeId] = useState(params.get("node") ?? "");
  const [selected, setSelected] = useState<string[]>(["iotedu-dht11"]);
  const [mode, setMode] = useState<"mock" | "native">("mock");
  const [codeSource, setCodeSource] = useState<"approved" | "upload" | "ai_draft">("approved");
  const [gpio, setGpio] = useState(4);
  const [version, setVersion] = useState(2);
  const [versionString, setVersionString] = useState("1.1.0");
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [job, setJob] = useState<BuildJob | null>(null);
  const [logText, setLogText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ nodes: ManagedNode[] }>("/api/nodes"),
      api<{ components: ComponentManifest[] }>("/api/catalog"),
      api<LayoutResponse>("/api/firmware/layout"),
      api<{ jobs: BuildJob[] }>("/api/builds"),
    ]).then(([nodeBody, catalogBody, layoutBody, buildBody]) => {
      setNodes(nodeBody.nodes);
      setComponents(catalogBody.components);
      setLayout(layoutBody);
      setHistory(buildBody.jobs);
      const current = [...buildBody.jobs].reverse().find((item) => item.status === "running") ?? null;
      if (current) setJob(current);
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  const runningId = job?.status === "running" ? job.id : null;
  useEffect(() => {
    if (!runningId) return;
    let stopped = false;
    async function refresh() {
      const [body, log] = await Promise.all([
        api<{ job: BuildJob }>(`/api/builds/${runningId}`),
        api<{ status: string; tail: string }>(`/api/builds/${runningId}/log`),
      ]);
      if (stopped) return;
      setJob(body.job);
      setLogText(log.tail);
      setValidation(body.job.validation);
      if (body.job.status !== "running") {
        const listed = await api<{ jobs: BuildJob[] }>("/api/builds");
        if (!stopped) setHistory(listed.jobs);
      }
    }
    void refresh().catch((reason: Error) => setError(reason.message));
    const timer = setInterval(() => void refresh().catch((reason: Error) => setError(reason.message)), 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [runningId]);

  const payload = {
    mode,
    codeSource,
    nodeId: nodeId || null,
    hardware: "esp32h2" as const,
    baseFirmwareId: "iotedu-core",
    componentIds: selected,
    pins: selected.includes("iotedu-dht11") ? [{ componentId: "iotedu-dht11", pinName: "DHT11_DATA", gpio }] : [],
    softwareVersion: version,
    softwareVersionString: versionString,
    uploadId,
    confirm: true as const,
  };

  const drivers = components.filter((item) => item.type === "sensor" || item.type === "actuator");
  const described = components.filter((item) => item.id === "iotedu-core" || selected.includes(item.id));
  const slot = layout?.partitions.find((row) => row.name === "ota_0");

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function validate() {
    setError(null);
    try {
      setValidation(await api<ValidationResult>("/api/builds/validate", { method: "POST", body: JSON.stringify(payload) }));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Validation failed");
    }
  }

  async function build() {
    setError(null);
    setLogText("");
    try {
      const body = await api<{ job: BuildJob }>("/api/builds", { method: "POST", body: JSON.stringify(payload) });
      setJob(body.job);
      setValidation(body.job.validation);
      setHistory((current) => [...current.filter((item) => item.id !== body.job.id), body.job]);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Build failed");
    }
  }

  async function cancel() {
    if (!job) return;
    const body = await api<{ job: BuildJob }>(`/api/builds/${job.id}/cancel`, { method: "POST" });
    setJob(body.job);
  }

  async function upload(file: File) {
    const content = await file.text();
    const body = await api<{ uploadId: string; message: string }>("/api/uploads", {
      method: "POST",
      body: JSON.stringify({ fileName: file.name, content }),
    });
    setUploadId(body.uploadId);
    setError(body.message);
  }

  return (
    <section className="stack">
      <header>
        <h1>Firmware Builder</h1>
        <p className="lede">Prepare an ESP32-H2 package from the local Matter-over-Thread core and the DHT11 driver. A simulated package is labelled and cannot be programmed. A native package is compiled on this Mac and is still awaiting hardware verification.</p>
      </header>
      {error && <div className="banner bad">{error}</div>}
      <div className="split">
        <form className="panel stack" onSubmit={(event) => event.preventDefault()}>
          <label>
            Build mode
            <select value={mode} onChange={(event) => setMode(event.target.value as "mock" | "native")}>
              <option value="mock">Simulated package</option>
              <option value="native">Native ESP-IDF</option>
            </select>
          </label>
          <p className="muted">Docker builds are unavailable.</p>
          <label>
            Code source
            <select value={codeSource} onChange={(event) => setCodeSource(event.target.value as typeof codeSource)}>
              <option value="approved">Approved local components</option>
              <option value="upload">Uploaded custom code</option>
              <option value="ai_draft">AI-generated draft</option>
            </select>
          </label>
          {codeSource === "upload" && (
            <label>
              Untrusted source file
              <input type="file" accept=".c,.h,.cpp,.hpp,.txt" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }} />
            </label>
          )}
          {codeSource === "ai_draft" && <p>AI output is not available. This path fails validation instead of inventing source.</p>}
          <label>
            Target
            <select value="esp32h2" aria-label="Hardware target">
              <option value="esp32h2">ESP32-H2</option>
            </select>
          </label>
          <label>
            Target node
            <select value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
              <option value="">No node yet</option>
              {nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
            </select>
          </label>
          <p className="muted">Base firmware: Matter over Thread core. It is included in every package.</p>
          <fieldset>
            <legend>Local components</legend>
            {drivers.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  disabled={!item.selectableForBuild}
                  onChange={() => toggle(item.id)}
                />
                {item.name} ({item.status})
              </label>
            ))}
          </fieldset>
          {selected.includes("iotedu-dht11") && (
            <label>
              DHT11 data GPIO
              <input type="number" min={0} max={27} value={gpio} onChange={(event) => setGpio(Number(event.target.value))} />
            </label>
          )}
          <div className="row">
            <label>SoftwareVersion<input type="number" min={1} value={version} onChange={(event) => setVersion(Number(event.target.value))} /></label>
            <label>Version string<input value={versionString} onChange={(event) => setVersionString(event.target.value)} /></label>
          </div>
          <div className="row">
            <button type="button" className="secondary" onClick={() => void validate()}>Validate</button>
            <button type="button" onClick={() => void build()}>{mode === "mock" ? "Create simulated package" : "Build firmware"}</button>
            {job?.status === "running" && <button type="button" className="secondary" onClick={() => void cancel()}>Cancel build</button>}
          </div>
        </form>
        <div className="panel stack">
          <h2>Matter endpoints</h2>
          {described.map((item) => (
            <div key={item.id}>
              <h3>{item.name}</h3>
              <p>Endpoints: {item.firmware?.matter.endpoints.join(", ") || "none"}</p>
              <p>Clusters: {item.firmware?.matter.clusters.join(", ") || "none"}</p>
            </div>
          ))}
          <h2>Partition layout</h2>
          <p className="muted">Read-only reference table. Layout id {layout?.layoutId.slice(0, 12) ?? "…"}</p>
          <div className="bars">
            {layout?.partitions.map((row) => (
              <div className="bar" key={row.name}>
                <span>{row.name}</span>
                <div className="track"><div className="fill" style={{ width: `${Math.max(4, (row.size / (slot?.size ?? row.size)) * 40)}%` }} /></div>
                <span>0x{row.size.toString(16)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {validation && (
        <div className="panel">
          <h2>Validation {validation.ok ? "passed" : "failed"}</h2>
          <ul>{validation.issues.map((issue) => <li key={issue.code + issue.message}>{issue.level}: {issue.message}</li>)}</ul>
          {validation.issues.length === 0 && <p>No issues.</p>}
        </div>
      )}
      {job && (
        <div className="panel stack">
          <h2>Package <span className={`pill ${job.verification ?? job.status}`}>{verificationLabel(job)}</span></h2>
          {job.verification === "compiled" && <p>Hardware verification pending. This page does not program a board or offer the image to a node.</p>}
          {job.verification === "simulated" && <p>This record is simulated. It cannot be programmed or sent as an update.</p>}
          <p>Status {job.status}.{job.durationMs != null ? ` Duration ${Math.round(job.durationMs / 1000)}s.` : ""}</p>
          <pre className="log" aria-live="polite" tabIndex={0}>{logText || job.logs.join("\n")}</pre>
          <ul>
            {job.artifacts.map((artifact) => (
              <li key={artifact.name}>
                {job.status === "succeeded" && job.verification === "compiled" ? (
                  <a href={`/api/builds/${job.id}/download/${encodeURIComponent(artifact.name)}`}>{artifact.name}</a>
                ) : artifact.name}
                {" · "}{artifact.size} bytes · sha256 {artifact.sha256.slice(0, 12)}
                {artifact.deployable ? " · Matter OTA image" : ""}
                {artifact.simulated ? " · simulated" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {history.length > 0 && (
        <div className="panel">
          <h2>Build records</h2>
          <ul>
            {history.map((item) => (
              <li key={item.id}>
                <button type="button" className="secondary" onClick={() => { setJob(item); setLogText(""); }}>
                  {item.request.softwareVersionString} · {verificationLabel(item)} · {item.status}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
