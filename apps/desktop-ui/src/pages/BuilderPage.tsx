import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { BuildJob, ComponentManifest, ManagedNode, ValidationResult } from "@iotedu/contracts";
import { ApiError, api } from "../api";

interface LayoutResponse {
  layoutId: string;
  partitions: Array<{ name: string; offset: number; size: number }>;
}

export function BuilderPage() {
  const [params] = useSearchParams();
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [components, setComponents] = useState<ComponentManifest[]>([]);
  const [layout, setLayout] = useState<LayoutResponse | null>(null);
  const [nodeId, setNodeId] = useState(params.get("node") ?? "");
  const [componentId, setComponentId] = useState(params.get("component") ?? "iotedu-dht11");
  const [codeSource, setCodeSource] = useState<"approved" | "upload" | "ai_draft">("approved");
  const [gpio, setGpio] = useState(4);
  const [version, setVersion] = useState(2);
  const [versionString, setVersionString] = useState("1.1");
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [job, setJob] = useState<BuildJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ nodes: ManagedNode[] }>("/api/nodes"),
      api<{ components: ComponentManifest[] }>("/api/catalog"),
      api<LayoutResponse>("/api/firmware/layout"),
    ]).then(([nodeBody, catalogBody, layoutBody]) => {
      setNodes(nodeBody.nodes);
      setComponents(catalogBody.components);
      setLayout(layoutBody);
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  const payload = {
    mode: "mock" as const,
    codeSource,
    nodeId: nodeId || null,
    hardware: "esp32h2" as const,
    baseFirmwareId: "iotedu-core",
    componentIds: componentId ? [componentId] : [],
    pins: componentId === "iotedu-dht11" ? [{ componentId, pinName: "DHT11_DATA", gpio }] : [],
    softwareVersion: version,
    softwareVersionString: versionString,
    uploadId,
    confirm: true as const,
  };

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
    try {
      const body = await api<{ job: BuildJob }>("/api/builds", { method: "POST", body: JSON.stringify(payload) });
      setJob(body.job);
      setValidation(body.job.validation);
    } catch (reason) {
      if (reason instanceof ApiError) {
        setError(reason.message);
      }
    }
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

  const slot = layout?.partitions.find((row) => row.name === "ota_0");

  return (
    <section className="stack">
      <header>
        <h1>Firmware Builder</h1>
        <p className="lede">Packages can be prepared without deployment. Native compilation is not available in this release, so the only execution path is a labelled simulation.</p>
      </header>
      {error && <div className="banner">{error}</div>}
      <div className="split">
        <form className="panel stack" onSubmit={(event) => event.preventDefault()}>
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
            Target node
            <select value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
              <option value="">No node yet</option>
              {nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
            </select>
          </label>
          <p className="muted">Hardware: ESP32-H2. Base firmware: Matter over Thread core.</p>
          <label>
            Driver
            <select value={componentId} onChange={(event) => setComponentId(event.target.value)}>
              <option value="">Core only</option>
              {components.filter((item) => item.type === "sensor" || item.type === "actuator").map((item) => (
                <option key={item.id} value={item.id} disabled={!item.selectableForBuild}>
                  {item.name} ({item.status})
                </option>
              ))}
            </select>
          </label>
          {componentId === "iotedu-dht11" && (
            <label>
              DHT11 data GPIO
              <input type="number" value={gpio} onChange={(event) => setGpio(Number(event.target.value))} />
            </label>
          )}
          <div className="row">
            <label>Version number<input type="number" value={version} onChange={(event) => setVersion(Number(event.target.value))} /></label>
            <label>Version string<input value={versionString} onChange={(event) => setVersionString(event.target.value)} /></label>
          </div>
          <div className="row">
            <button type="button" className="secondary" onClick={() => void validate()}>Validate</button>
            <button type="button" onClick={() => void build()}>Create simulated package</button>
          </div>
        </form>
        <div className="panel">
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
        <div className="panel">
          <h2>Package <span className="pill simulated">Simulated</span></h2>
          <p>Status {job.status}. No compiler log from ESP-IDF exists for this package.</p>
          <ul>{job.logs.map((line) => <li key={line}>{line}</li>)}</ul>
          <ul>
            {job.artifacts.map((artifact) => (
              <li key={artifact.name}>{artifact.name} · {artifact.size} bytes · sha256 {artifact.sha256.slice(0, 12)} · deployable {String(artifact.deployable)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
