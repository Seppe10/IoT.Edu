import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { ManagedNode } from "@iotedu/contracts";
import { ApiError, api } from "../api";

export function NodePage() {
  const { id = "" } = useParams();
  const [node, setNode] = useState<ManagedNode | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ node: ManagedNode }>(`/api/nodes/${id}`)
      .then((body) => {
        setNode(body.node);
        setName(body.node.name);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [id]);

  async function rename(event: FormEvent) {
    event.preventDefault();
    const body = await api<{ node: ManagedNode }>(`/api/nodes/${id}/rename`, {
      method: "POST",
      body: JSON.stringify({ name, confirm: true }),
    });
    setNode(body.node);
  }

  async function refresh() {
    const body = await api<{ node: ManagedNode; message: string }>(`/api/nodes/${id}/refresh`, { method: "POST" });
    setNode(body.node);
    setMessage(body.message);
  }

  async function windowAction() {
    try {
      const body = await api<{ opened: false; message: string }>(`/api/nodes/${id}/commissioning-window`, { method: "POST" });
      setMessage(body.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Request failed");
    }
  }

  if (!node) return <p>{error ?? "Loading node…"}</p>;

  return (
    <section className="stack">
      <header className="page-head">
        <div>
          <h1>{node.name}</h1>
          <p className="lede">Application id {node.id}. Matter node id: {node.matterNodeId ?? "not assigned"}.</p>
        </div>
        <div className="row">
          <Link className="button secondary" to={`/builder?node=${node.id}`}>Software configuration</Link>
          <Link className="button secondary" to={`/ota?node=${node.id}`}>OTA</Link>
        </div>
      </header>
      {node.simulated && <div className="banner">Simulated record. No fabric credential was created for this node.</div>}
      {message && <div className="banner">{message}</div>}
      {error && <div className="banner bad">{error}</div>}
      <div className="split">
        <div className="panel">
          <h2 id="identity-heading">Identity</h2>
          <table aria-labelledby="identity-heading">
            <caption className="sr-only">Node identity</caption>
            <tbody>
              <tr><th scope="row">Vendor / product</th><td>{node.vendorId ?? "Unknown"} / {node.productId ?? "Unknown"}</td></tr>
              <tr><th scope="row">SoftwareVersion</th><td>{node.softwareVersion ?? "Not read"} ({node.softwareVersionString ?? "not read"})</td></tr>
              <tr><th scope="row">Hardware</th><td>{node.hardware}</td></tr>
              <tr><th scope="row">Reachability</th><td>{node.reachable == null ? "Unknown" : String(node.reachable)}</td></tr>
              <tr><th scope="row">Management fabric</th><td>{node.fabricLabel}</td></tr>
              <tr><th scope="row">Commissioned fabrics</th><td>{node.commissionedFabricCount ?? "Not permitted or not read"}</td></tr>
              <tr><th scope="row">Other fabrics</th><td>{node.otherFabricCount ?? "Names are not available"}</td></tr>
              <tr><th scope="row">Partition layout</th><td>{node.partitionLayoutId ?? "Unknown until flashed by this application"}</td></tr>
              <tr><th scope="row">Installed components</th><td>{node.installedComponents.join(", ") || "Unknown"}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="panel stack">
          <h2>Maintenance</h2>
          <form className="stack" onSubmit={rename}>
            <label>Application name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
            <button type="submit">Rename</button>
          </form>
          <button className="secondary" type="button" onClick={refresh}>Refresh identity</button>
          <button className="secondary" type="button" onClick={windowAction}>Open commissioning window</button>
        </div>
      </div>
      <div className="panel">
        <h2>History</h2>
        <ul>
          {node.history.map((entry) => (
            <li key={`${entry.at}-${entry.kind}`}>{entry.at} — {entry.kind}: {entry.detail}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
