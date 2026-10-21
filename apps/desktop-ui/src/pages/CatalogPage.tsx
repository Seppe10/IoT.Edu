import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ComponentManifest, ComponentStatus } from "@iotedu/contracts";
import { api } from "../api";

const statuses: Array<ComponentStatus | ""> = ["", "experimental", "template", "planned", "verified"];

export function CatalogPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ComponentStatus | "">("");
  const [components, setComponents] = useState<ComponentManifest[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    api<{ components: ComponentManifest[] }>(`/api/catalog?${params.toString()}`)
      .then((body) => setComponents(body.components))
      .catch((reason: Error) => setError(reason.message));
  }, [query, status]);

  return (
    <section className="stack">
      <header>
        <h1>Component Library</h1>
        <p className="lede">Local manifests only. Planned and template entries cannot be built. There is no live sensor view here.</p>
      </header>
      {error && <p className="banner bad">{error}</p>}
      <div className="row">
        <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as ComponentStatus | "")}>
            {statuses.map((item) => <option key={item || "all"} value={item}>{item || "All"}</option>)}
          </select>
        </label>
      </div>
      {components.map((component) => (
        <article className="panel" key={component.id}>
          <div className="row">
            <h2>{component.name}</h2>
            <span className="pill">{component.status}</span>
            <span className="pill">{component.type}</span>
          </div>
          <p>{component.description}</p>
          <p className="muted">ESP-IDF {component.idfCompatibility}. Target {component.target}.</p>
          {component.firmware && (
            <p className="muted">
              Clusters: {component.firmware.matter.clusters.join(", ") || "none"}.
              Register function: {component.firmware.registerFunction ?? "not extracted"}.
            </p>
          )}
          {component.selectableForBuild ? (
            <Link className="button" to={`/builder?component=${component.id}`}>Select for builder</Link>
          ) : (
            <button disabled type="button">Not buildable</button>
          )}
        </article>
      ))}
    </section>
  );
}
