import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { OtaJob } from "@iotedu/contracts";
import { api } from "../api";

export function DeploymentPage() {
  const { id = "" } = useParams();
  const [job, setJob] = useState<OtaJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ job: OtaJob }>(`/api/ota/jobs/${id}`)
      .then((body) => setJob(body.job))
      .catch((reason: Error) => setError(reason.message));
  }, [id]);

  if (!job) return <p>{error ?? "Loading deployment…"}</p>;

  return (
    <section className="stack">
      <header>
        <h1>OTA Deployment</h1>
        <p className="lede">{job.message}</p>
      </header>
      <div className="banner">
        Status: {job.status}. Installed SoftwareVersion confirmed: {job.installedVersionConfirmed ? "yes" : "no"}.
        Stages stay “not observed” until a Matter OTA event is received.
      </div>
      <ol className="panel stack">
        {job.stages.map((stage) => (
          <li key={stage.id}>
            <strong>{stage.label}</strong> — <span className="pill">{stage.state}</span>
            <div className="muted">{stage.detail}</div>
          </li>
        ))}
      </ol>
      <Link className="button secondary" to="/ota">Back to preflight</Link>
    </section>
  );
}
