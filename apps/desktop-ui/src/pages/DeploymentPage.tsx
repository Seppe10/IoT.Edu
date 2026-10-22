import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { OtaJob } from "@iotedu/contracts";
import { api } from "../api";

export function DeploymentPage() {
  const { id = "" } = useParams();
  const [job, setJob] = useState<OtaJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const load = () => api<{ job: OtaJob }>(`/api/ota/jobs/${id}`)
      .then((body) => {
        setJob(body.job);
        if (body.job.status !== "running" && timer) {
          clearInterval(timer);
          timer = undefined;
        }
      })
      .catch((reason: Error) => setError(reason.message));
    void load();
    timer = setInterval(() => void load(), 2000);
    return () => {
      if (timer) clearInterval(timer);
    };
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
        The transfer finishing does not complete the update. Success requires the device to report SoftwareVersion {job.expectedSoftwareVersion ?? "from the image"}.
      </div>
      <ol className="panel stack">
        {job.stages.map((stage) => (
          <li key={stage.id}>
            <strong>{stage.label}</strong> — <span className="pill">{stageWord(stage.state)}</span>
            <div className="muted">{stage.detail}</div>
          </li>
        ))}
      </ol>
      <Link className="button secondary" to="/ota">Back to preflight</Link>
    </section>
  );
}

function stageWord(state: string): string {
  if (state === "observed") return "Observed";
  if (state === "inferred") return "Inferred";
  if (state === "failed") return "Failed";
  if (state === "interrupted") return "Interrupted";
  return "Unknown";
}
