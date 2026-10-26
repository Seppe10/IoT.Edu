import { useEffect, useState } from "react";
import type { EraseAssessment, EraseSession, FlashBackupRecord } from "@iotedu/contracts";
import { ERASE_WARNING } from "@iotedu/contracts";
import { api } from "../api";
import { formatLocalDateTime } from "../datetime";
import { backupPhase, recoveryChecks } from "../recovery-checks";
import { nextEraseAction } from "../setup-flow";

export function RecoveryErase(props: {
  active: boolean;
  programmingPort: string | null;
  consolePort: string | null;
  buildId: string | null;
  buildLabel: string | null;
  onContinue: (device: EraseAssessment["device"]) => void;
}) {
  const [assessment, setAssessment] = useState<EraseAssessment | null>(null);
  const [session, setSession] = useState<EraseSession | null>(null);
  const [macText, setMacText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const mac = assessment?.device?.mac ?? "";
  const confirmed = macText.trim().toLowerCase() === mac && mac !== "";
  const checks = recoveryChecks(assessment);
  const action = nextEraseAction(assessment);
  const ready = action === "ready" && assessment?.enabled === true;

  useEffect(() => {
    if (!props.active) return;
    let stopped = false;
    async function prepare() {
      if (!props.programmingPort || !props.buildId) {
        setError(props.programmingPort
          ? "Select a compatible firmware package in Step 2. Erase preparation needs a recovery package."
          : "Select the programming interface before erase preparation.");
        return;
      }
      setBusy("assess");
      setError(null);
      setSession(null);
      try {
        let body = await assess();
        if (stopped) return;
        if (nextEraseAction(body) === "backup") {
          setBusy("backup");
          await api<FlashBackupRecord>("/api/programmer/recovery/backup", {
            method: "POST",
            body: JSON.stringify({ port: props.programmingPort, consolePort: props.consolePort, buildId: props.buildId }),
          });
          body = await assess();
        }
        if (stopped) return;
        if (nextEraseAction(body) === "verify" && body.device?.mac) {
          setBusy("verify");
          const verified = await api<{ backup: FlashBackupRecord }>("/api/programmer/recovery/backup/verify", {
            method: "POST",
            body: JSON.stringify({ mac: body.device.mac }),
          });
          body = { ...body, backup: verified.backup };
          body = await assess();
          if (verified.backup.verified) body = { ...body, backup: verified.backup };
        }
        if (stopped) return;
        setAssessment(body);
        if (nextEraseAction(body) !== "ready") {
          const blocker = body.blockers[0];
          setError(blocker ? `${blocker.message} ${blocker.action}` : "Full Flash Erase stays blocked.");
        }
      } catch (reason) {
        if (!stopped) setError(reason instanceof Error ? reason.message : "Erase preparation failed");
      } finally {
        if (!stopped) setBusy(null);
      }
    }
    function assess() {
      return api<EraseAssessment>("/api/programmer/recovery/assess", {
        method: "POST",
        body: JSON.stringify({ port: props.programmingPort, consolePort: props.consolePort, buildId: props.buildId }),
      });
    }
    void prepare();
    return () => {
      stopped = true;
    };
  }, [props.active, props.programmingPort, props.consolePort, props.buildId, attempt]);

  async function erase() {
    if (!props.programmingPort || !props.buildId || !assessment?.backup || !mac || !confirmed || !ready) return;
    setBusy("erase");
    setError(null);
    try {
      const body = await api<{ session: EraseSession }>("/api/programmer/recovery/erase", {
        method: "POST",
        body: JSON.stringify({
          port: props.programmingPort,
          consolePort: props.consolePort,
          buildId: props.buildId,
          backupId: assessment.backup.id,
          mac,
          confirmDevice: true,
          confirmBackup: true,
          acknowledgeCommissioningLoss: true,
          confirm: true,
        }),
      });
      setSession(body.session);
      if (body.session.status !== "succeeded") setError(body.session.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The erase failed");
    } finally {
      setBusy(null);
    }
  }

  async function exportBackup() {
    if (!assessment?.backup?.verified) return;
    setBusy("export");
    setError(null);
    try {
      const response = await fetch(`/api/programmer/recovery/backups/${assessment.backup.id}/export`);
      if (!response.ok) throw new Error("The backup export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `flash-backup-${assessment.backup.mac.replace(/:/g, "")}.tar`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The backup export failed");
    } finally {
      setBusy(null);
    }
  }

  const phase = busy === "assess"
    ? "Checking the connected chip"
    : busy === "backup"
      ? "Backup in progress"
      : busy === "verify"
        ? "Backup integrity check in progress"
        : busy === "erase"
          ? "Erasing flash"
          : assessment
            ? backupPhase(assessment.backup, null)
            : "Not started";
  const security = assessment?.security;
  const device = assessment?.device;

  return (
    <section className="stack">
      <h3>Full Flash Erase</h3>
      <p className="muted">Opening this section reads the chip and may enter download mode. It does not erase flash until Confirm Full Flash Erase is used.</p>
      <p>{phase}.</p>
      {device && (
        <dl className="facts">
          <div><dt>Device</dt><dd>{device.chip} {device.revision}</dd></div>
          <div><dt>MAC address</dt><dd>{device.mac ?? "Not Verified"}</dd></div>
          <div><dt>Flash</dt><dd>{device.flashSizeBytes ? `${(device.flashSizeBytes / (1024 * 1024)).toLocaleString("en-AU")} MB` : "Not Verified"}</dd></div>
          <div><dt>Backup</dt><dd>{backupPhase(assessment?.backup ?? null, busy)}</dd></div>
          <div><dt>Backup location</dt><dd>{assessment?.backup?.location ?? "Not created"}</dd></div>
          <div><dt>Saved</dt><dd>{assessment?.backup ? formatLocalDateTime(assessment.backup.createdAt) : "Not created"}</dd></div>
          <div><dt>Secure Boot</dt><dd>{checks.find((item) => item.id === "secure-boot")?.status}</dd></div>
          <div><dt>Flash Encryption</dt><dd>{checks.find((item) => item.id === "encryption")?.status}</dd></div>
          <div><dt>Factory data preservation</dt><dd>{checks.find((item) => item.id === "factory")?.status}</dd></div>
        </dl>
      )}
      {assessment?.backup?.verified && (
        <button type="button" className="secondary" onClick={() => void exportBackup()} disabled={busy != null}>Export Backup</button>
      )}
      {ready && session?.status !== "failed" && session?.status !== "succeeded" && (
        <div className="stack">
          <p className="banner bad" role="alert">{ERASE_WARNING}</p>
          <p>Device {device?.chip} {device?.revision}, MAC {device?.mac}, flash {device?.flashSizeBytes ? `${(device.flashSizeBytes / (1024 * 1024)).toLocaleString("en-AU")} MB` : "unknown"}. Backup {assessment?.backup?.id} at {assessment?.backup?.location}. Package {props.buildLabel}.</p>
          <p>The firmware, bootloader, partition table, Matter commissioning information, and Thread credentials will be erased. Firmware must be installed again. Apple Home and IoT.Edu commissioning relationships on this chip will be lost.</p>
          <p className="muted">{assessment?.downloadModeWarning}</p>
          <label>
            Type the verified MAC address
            <input aria-label="Verified MAC address" value={macText} onChange={(event) => setMacText(event.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <div className="actions">
            <button type="button" className="danger" disabled={!confirmed || busy != null} onClick={() => void erase()}>Confirm Full Flash Erase</button>
          </div>
        </div>
      )}
      {session?.status === "succeeded" && session.needsFirmware && (
        <div className="stack">
          <h3>Flash Erase Complete</h3>
          <p>{session.message} Updated {formatLocalDateTime(session.updatedAt)}.</p>
          <button type="button" onClick={() => props.onContinue(device ?? null)}>Continue to Firmware Installation</button>
        </div>
      )}
      {(error || (assessment && !ready && !busy && session?.status !== "succeeded")) && (
        <div className="banner bad" role="alert">
          <p>{error ?? "Full Flash Erase stays blocked."}</p>
          <button type="button" className="secondary" onClick={() => setAttempt((value) => value + 1)} disabled={busy != null}>Retry erase preparation</button>
        </div>
      )}
      <button type="button" className="secondary" onClick={() => setDetailOpen((open) => !open)}>{detailOpen ? "Hide diagnostics" : "Diagnostics"}</button>
      {detailOpen && (
        <div>
          <p>{security?.detail ?? "No security reading yet. An unread fuse stays Not Verified."}</p>
          <ul>
            {checks.map((item) => (
              <li key={item.id}><span className={`pill ${item.status === "Verified" ? "passed" : item.status === "Blocked" ? "blocked" : "not_tested"}`}>{item.status}</span> {item.label}. {item.detail}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
