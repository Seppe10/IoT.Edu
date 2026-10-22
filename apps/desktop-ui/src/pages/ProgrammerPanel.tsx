import { useEffect, useState } from "react";
import type { BuildJob, ProgramIntent, ProgramSession, StartupCheck } from "@iotedu/contracts";
import { api } from "../api";

const INTENTS: Array<{ id: ProgramIntent; label: string; detail: string }> = [
  {
    id: "initial_install",
    label: "Initial installation",
    detail: "A board that has not joined a Matter fabric.",
  },
  {
    id: "reflash",
    label: "Reflash an existing device",
    detail: "Replace the application over USB. This is not a Matter update.",
  },
  {
    id: "commissioned_maintenance",
    label: "Update a commissioned Matter node",
    detail: "The node may already be on a fabric. USB writing reboots it and is not an OTA update.",
  },
];

export function ProgrammerPanel({ job }: { job: BuildJob }) {
  const programmable = job.status === "succeeded" && !job.simulated && (job.verification === "compiled" || job.verification === "hardware_verified");
  const [ports, setPorts] = useState<string[]>([]);
  const [port, setPort] = useState("");
  const [intent, setIntent] = useState<ProgramIntent>("initial_install");
  const [confirmed, setConfirmed] = useState(false);
  const [commissionedAck, setCommissionedAck] = useState(false);
  const [session, setSession] = useState<ProgramSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const application = job.artifacts.find((artifact) => artifact.name === "sensors.bin");

  useEffect(() => {
    if (!programmable) return;
    let stopped = false;
    Promise.all([
      api<{ ports: string[] }>("/api/programmer/ports"),
      api<{ sessions: ProgramSession[] }>("/api/programmer/sessions"),
    ]).then(([portBody, sessionBody]) => {
      if (stopped) return;
      setPorts(portBody.ports);
      setPort((current) => current || portBody.ports[0] || "");
      const latest = [...sessionBody.sessions].reverse().find((item) => item.buildId === job.id) ?? null;
      setSession(latest);
    }).catch((reason: Error) => {
      if (!stopped) setError(reason.message);
    });
    return () => {
      stopped = true;
    };
  }, [job.id, programmable]);

  const sessionId = session?.id;
  const watching = session?.status === "running" || session?.stage === "monitoring";
  useEffect(() => {
    if (!sessionId || !watching) return;
    let stopped = false;
    async function refresh() {
      const body = await api<{ session: ProgramSession }>(`/api/programmer/sessions/${sessionId}`);
      if (!stopped) setSession(body.session);
    }
    void refresh().catch((reason: Error) => setError(reason.message));
    const timer = setInterval(() => void refresh().catch((reason: Error) => setError(reason.message)), 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [sessionId, watching]);

  if (!programmable) {
    return (
      <div className="panel stack">
        <h2>USB flashing</h2>
        <p>Simulated, failed, and unfinished packages cannot be written to a board.</p>
      </div>
    );
  }

  async function refreshPorts() {
    setError(null);
    const body = await api<{ ports: string[] }>("/api/programmer/ports");
    setPorts(body.ports);
    setPort((current) => body.ports.find((item) => item === current) ?? body.ports[0] ?? "");
  }

  async function writeImage() {
    setError(null);
    setSaved(false);
    try {
      const body = await api<{ session: ProgramSession }>("/api/programmer/sessions", {
        method: "POST",
        body: JSON.stringify({
          buildId: job.id,
          port,
          intent,
          confirm: true,
          preserveNvs: true,
          acknowledgeCommissioned: intent === "commissioned_maintenance" ? true : undefined,
        }),
      });
      setSession(body.session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The write was rejected");
    }
  }

  async function cancel() {
    if (!session) return;
    const body = await api<{ session: ProgramSession }>(`/api/programmer/sessions/${session.id}/cancel`, { method: "POST" });
    setSession(body.session);
  }

  async function monitor() {
    if (!session) return;
    setError(null);
    try {
      const body = await api<{ session: ProgramSession }>(`/api/programmer/sessions/${session.id}/monitor`, { method: "POST" });
      setSession(body.session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The serial monitor did not open");
    }
  }

  async function saveLog() {
    if (!session) return;
    await api(`/api/programmer/sessions/${session.id}/save-log`, { method: "POST" });
    setSaved(true);
  }

  const ready = confirmed && port !== "" && (intent !== "commissioned_maintenance" || commissionedAck) && session?.status !== "running";

  return (
    <div className="panel stack">
      <h2>USB flashing</h2>
      <p>Hardware verification pending. Writing this image does not commission the node, join Thread, or prove the DHT11 is installed.</p>
      <dl className="facts">
        <div><dt>Version</dt><dd>{job.request.softwareVersionString} (SoftwareVersion {job.request.softwareVersion})</dd></div>
        <div><dt>Target</dt><dd>ESP32-H2</dd></div>
        <div><dt>Application size</dt><dd>{application ? `${application.size} bytes` : "not recorded"}</dd></div>
        <div><dt>Partition layout</dt><dd>{job.partitionLayoutId ?? "not recorded"}</dd></div>
      </dl>
      <div className="banner">
        <p>Connect the ESP32-H2 with a data USB cable. The local USB tool tries the automatic download-mode reset first.</p>
        <p>If the board does not respond, hold BOOT (GPIO9), press and release RESET, then release BOOT, and start the write again.</p>
        <p>The write uses the package flashing metadata. It updates the bootloader, partition table, OTA selection data, and application. It does not erase NVS, factory data, or the secure-cert partition. Full-chip erase is not available. Erasing NVS would remove Matter fabric credentials and Thread network information.</p>
      </div>
      <fieldset>
        <legend>What this write is for</legend>
        {INTENTS.map((item) => (
          <label className="choice" key={item.id}>
            <input
              type="radio"
              name="program-intent"
              checked={intent === item.id}
              onChange={() => {
                setIntent(item.id);
                setCommissionedAck(false);
              }}
            />
            {item.label}. {item.detail}
          </label>
        ))}
      </fieldset>
      <div className="row">
        <label>
          USB device
          <select value={port} onChange={(event) => setPort(event.target.value)}>
            <option value="">No device selected</option>
            {ports.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => void refreshPorts().catch((reason: Error) => setError(reason.message))}>Refresh devices</button>
      </div>
      {ports.length === 0 && <p>No ESP32-H2 USB device was found. Connect the board and refresh. A missing device is not a successful write.</p>}
      <label className="choice">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        Write this compiled image and leave NVS in place.
      </label>
      {intent === "commissioned_maintenance" && (
        <label className="choice">
          <input type="checkbox" checked={commissionedAck} onChange={(event) => setCommissionedAck(event.target.checked)} />
          This board may already be commissioned. I understand this USB write is not a Matter OTA update and the node will reboot.
        </label>
      )}
      {error && <p className="banner bad">{error}</p>}
      <div className="row">
        <button type="button" disabled={!ready} onClick={() => void writeImage()}>Write firmware</button>
        {session?.status === "running" && <button type="button" className="secondary" onClick={() => void cancel()}>Cancel write</button>}
        {session?.status === "succeeded" && session.stage !== "monitoring" && (
          <button type="button" className="secondary" onClick={() => void monitor()}>Open serial monitor</button>
        )}
        {session?.stage === "monitoring" && <button type="button" className="secondary" onClick={() => void cancel()}>Close serial monitor</button>}
        {session && session.monitorLog.trim() !== "" && (
          <button type="button" className="secondary" onClick={() => void saveLog().catch((reason: Error) => setError(reason.message))}>Save redacted serial log</button>
        )}
      </div>
      {saved && session && (
        <p><a href={`/api/programmer/sessions/${session.id}/saved-log`}>Download redacted serial log</a></p>
      )}
      {session && (
        <>
          <p>Status {session.status}. {session.message}</p>
          {session.progressPercent !== null && (
            <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={session.progressPercent} aria-label="USB write progress">
              <div className="fill" style={{ width: `${session.progressPercent}%` }} />
            </div>
          )}
          <pre className="log" aria-live="polite" tabIndex={0}>{session.logs.join("\n")}</pre>
          {session.monitorLog.trim() !== "" && <pre className="log" tabIndex={0}>{session.monitorLog}</pre>}
          <div className="checks">
            {session.checks.map((item) => <Check key={item.id} item={item} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Check({ item }: { item: StartupCheck }) {
  return (
    <div className="check">
      <span className={`pill ${item.status}`}>{item.status}</span>
      <span><strong>{item.label}.</strong> {item.detail}</span>
    </div>
  );
}
