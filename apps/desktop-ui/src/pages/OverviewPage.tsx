import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BuildJob, ManagedNode, OtaJob } from "@iotedu/contracts";
import { api } from "../api";

export function connectionLabel(node: ManagedNode): string {
  if (node.connection === "reachable" || node.reachable === true) return "Reachable";
  if (node.connection === "offline" || node.reachable === false) return "Offline";
  if (node.connection === "commissioned") return "Commissioned";
  return "Unknown";
}

export function OverviewPage() {
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [builds, setBuilds] = useState<BuildJob[]>([]);
  const [jobs, setJobs] = useState<OtaJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ nodes: ManagedNode[] }>("/api/nodes"),
      api<{ jobs: BuildJob[] }>("/api/builds"),
      api<{ jobs: OtaJob[] }>("/api/ota/jobs"),
    ])
      .then(([nodeBody, buildBody, otaBody]) => {
        setNodes(nodeBody.nodes);
        setBuilds(buildBody.jobs);
        setJobs(otaBody.jobs);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const reachable = nodes.filter((node) => node.reachable === true).length;
  const updates = nodes.filter((node) => {
    const newer = builds.find(
      (build) =>
        build.status === "simulated" &&
        node.softwareVersion != null &&
        build.request.softwareVersion > node.softwareVersion,
    );
    return Boolean(newer);
  }).length;
  const active = jobs.filter((job) => job.status === "interrupted").length;

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Management Overview</h1>
          <p className="lede">Paired nodes, reachability, and firmware jobs. Reachability counts only a live Matter administrative session.</p>
        </div>
        <Link className="button" to="/pair">Pair New Node</Link>
      </header>
      {error && <p className="banner bad">{error}</p>}
      <div className="grid">
        <article className="card"><div className="muted">Paired nodes</div><div className="stat">{nodes.length}</div></article>
        <article className="card"><div className="muted">Reachable</div><div className="stat">{reachable}</div></article>
        <article className="card"><div className="muted">Applicable updates</div><div className="stat">{updates}</div></article>
        <article className="card"><div className="muted">Active OTA jobs</div><div className="stat">{active}</div></article>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h2 id="nodes-heading">Nodes</h2>
        {nodes.length === 0 ? (
          <p className="muted">No nodes recorded. A simulated record is labelled. A management-fabric node shows its connection separately.</p>
        ) : (
          <table aria-labelledby="nodes-heading">
            <caption className="sr-only">Recorded nodes</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Hardware</th>
                <th scope="col">Firmware</th>
                <th scope="col">Management connection</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr key={node.id}>
                  <th scope="row">
                    {node.name}{" "}
                    {node.simulated && <span className="pill simulated">Simulated</span>}
                  </th>
                  <td>{node.hardware}</td>
                  <td>{node.softwareVersionString ?? "Not read"}</td>
                  <td>{connectionLabel(node)}</td>
                  <td>
                    <div className="row">
                      <Link className="button secondary" to={`/nodes/${node.id}`}>Details</Link>
                      <Link className="button secondary" to={`/builder?node=${node.id}`}>Build</Link>
                      <Link className="button secondary" to={`/ota?node=${node.id}`}>OTA</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
