import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { CapabilityReport, CommissionResult, HardwareInstallation, ManagedNode } from "@iotedu/contracts";
import { ApiError, api } from "../api";
import { formatLocalDateTime } from "../datetime";
import { useSetup } from "../use-setup";
import { WorkflowStrip } from "../WorkflowStrip";
import {
  APPLE_HOME_STEPS,
  appleHomeStepStates,
  EXISTING_FABRIC_STEPS,
  existingFabricStepStates,
  existingFailure,
  initialDeviceSetupState,
  isExistingStage,
  pairingCodeVisible,
  planDeviceSetup,
  PRIMARY_SETUP_ACTION,
  recoveryFor,
  type CommissionStage,
  type ExistingFabricStepId,
} from "./pair-progress";

type StreamEvent =
  | { type: "progress"; stage: string; message: string }
  | { type: "result"; result: CommissionResult }
  | { type: "failed"; code: string; message: string; detail?: unknown };

type StoredPeer = { matterNodeId: string; commissionedAt: number | null };
type SetupOperation = "recover" | "commission";

export function PairPage() {
  const initial = initialDeviceSetupState();
  const [caps, setCaps] = useState<CapabilityReport | null>(null);
  const [name, setName] = useState("ESP32-H2");
  const [pairingCode, setPairingCode] = useState("");
  const [ack, setAck] = useState(false);
  const [result, setResult] = useState<CommissionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [stage, setStage] = useState<CommissionStage | null>(null);
  const [stageMessage, setStageMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storedPeers, setStoredPeers] = useState<StoredPeer[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState("");
  const [installations, setInstallations] = useState<HardwareInstallation[]>([]);
  const [fabricStarted, setFabricStarted] = useState(false);
  const [fabricActive, setFabricActive] = useState<ExistingFabricStepId | null>(null);
  const [fabricCompleted, setFabricCompleted] = useState<ExistingFabricStepId[]>([]);
  const [fabricFailed, setFabricFailed] = useState<ExistingFabricStepId | null>(null);
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [guideOpen, setGuideOpen] = useState(false);
  const [chosen, setChosen] = useState<SetupOperation | null>(initial.operation);
  const [contactConfirmed, setContactConfirmed] = useState(false);
  const [preserveConfirmed, setPreserveConfirmed] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticDetail, setDiagnosticDetail] = useState<string | null>(null);
  const { view } = useSetup(nodes);

  useEffect(() => {
    api<CapabilityReport>("/api/capabilities")
      .then(setCaps)
      .catch((reason: Error) => setError(reason.message));
    api<{ peers: StoredPeer[] }>("/api/controller/peers")
      .then((body) => {
        setStoredPeers(body.peers);
        setSelectedPeerId((current) => current || (body.peers.length === 1 ? body.peers[0]?.matterNodeId ?? "" : ""));
      })
      .catch(() => setStoredPeers([]));
    api<{ nodes: ManagedNode[] }>("/api/nodes")
      .then((body) => setNodes(body.nodes))
      .catch(() => setNodes([]));
    api<{ installations: HardwareInstallation[] }>("/api/hardware/installations")
      .then((body) => setInstallations(body.installations))
      .catch(() => setInstallations([]));
  }, []);

  const mock = caps?.matterCommissioning === "mock_only";
  const identityReady = caps?.matterCommissioning === "available";
  const verified = Boolean(result && !result.simulated && result.matterSessionOpened && result.node.softwareVersion != null);
  const selectedInstallation = installations
    .filter((item) => item.mac && view.deviceMac && item.mac.toLowerCase() === view.deviceMac.toLowerCase())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const plan = planDeviceSetup({ selectedMac: view.deviceMac, nodes, peers: storedPeers });
  const operation = chosen ?? plan.operation;
  const showCode = guideOpen && pairingCodeVisible(operation);
  const fabricStates = existingFabricStepStates({
    started: fabricStarted,
    verified: verified && fabricStarted,
    active: fabricActive,
    completed: fabricCompleted,
    failed: fabricFailed,
  });
  const states = appleHomeStepStates({
    submitted,
    stage,
    verified,
    simulated: Boolean(result?.simulated),
    failed: failureCode != null && operation === "commission",
    failureCode,
  });
  const matchingNode = nodes.find((node) => !node.simulated && node.hardwareMac && view.deviceMac && node.hardwareMac.toLowerCase() === view.deviceMac.toLowerCase());

  async function recover(registerWithoutHardwareLink = false) {
    setError(null);
    setFailureCode(null);
    setResult(null);
    setDiagnosticDetail(null);
    setFabricStarted(true);
    setFabricFailed(null);
    setFabricCompleted([]);
    setFabricActive("locate_peer");
    setStageMessage("Looking up the stored IoT.Edu device. A node id is not a hardware MAC.");
    setSubmitted(true);
    setBusy(true);
    if (storedPeers.length > 1 && !selectedPeerId) {
      setFailureCode("peer_selection_required");
      setFabricFailed("locate_peer");
      setFabricActive(null);
      setError("Choose the stored Matter peer in Advanced Diagnostics. A stored peer is not assumed to be the selected ESP32-H2.");
      setBusy(false);
      return;
    }
    try {
      await readCommission("/api/nodes/recover", {
        name: name || "ESP32-H2",
        confirm: true,
        matterNodeId: selectedPeerId || undefined,
        expectedHardwareMac: view.deviceMac ?? undefined,
        expectedVendorId: selectedInstallation?.vendorId ?? undefined,
        expectedProductId: selectedInstallation?.productId ?? undefined,
        expectedSoftwareVersion: selectedInstallation?.softwareVersion ?? undefined,
        expectedSoftwareVersionString: selectedInstallation?.softwareVersionString || undefined,
        registerWithoutHardwareLink,
      }, (streamEvent) => {
        if (streamEvent.type === "progress") {
          setStageMessage(streamEvent.message);
          if (isExistingStage(streamEvent.stage)) {
            setFabricCompleted((current) => current.includes(streamEvent.stage as ExistingFabricStepId) ? current : [...current, streamEvent.stage as ExistingFabricStepId]);
            const index = EXISTING_FABRIC_STEPS.findIndex((step) => step.id === streamEvent.stage);
            setFabricActive(EXISTING_FABRIC_STEPS[index + 1]?.id ?? null);
          }
        } else if (streamEvent.type === "result") {
          setResult(streamEvent.result);
          setFabricFailed(null);
          setFabricActive(null);
          setStageMessage(streamEvent.result.message);
          setStoredPeers((current) => current.filter((peer) => peer.matterNodeId !== streamEvent.result.node.matterNodeId));
          setNodes((current) => current.some((node) => node.id === streamEvent.result.node.id)
            ? current.map((node) => node.id === streamEvent.result.node.id ? streamEvent.result.node : node)
            : [...current, streamEvent.result.node]);
        } else {
          const failure = existingFailure(streamEvent.detail);
          setFailureCode(streamEvent.code);
          setFabricFailed(failure?.stage ?? "discover_operational");
          setFabricCompleted(failure?.completed ?? ["locate_peer"]);
          setFabricActive(null);
          setError(streamEvent.message);
          setDiagnosticDetail(diagnosticText(streamEvent.code, streamEvent.detail));
        }
      });
    } catch (reason) {
      const code = reason instanceof ApiError ? reason.code : "request_failed";
      const failure = reason instanceof ApiError ? existingFailure(reason.detail) : null;
      setFailureCode(code);
      setFabricFailed(failure?.stage ?? "discover_operational");
      setFabricCompleted(failure?.completed ?? ["locate_peer"]);
      setFabricActive(null);
      setError(reason instanceof ApiError ? reason.message : "Recovery failed");
      setDiagnosticDetail(reason instanceof ApiError ? diagnosticText(code, reason.detail) : null);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setFailureCode(null);
    setResult(null);
    setDiagnosticDetail(null);
    setStage(null);
    setStageMessage(null);
    setFabricStarted(false);
    setSubmitted(true);
    setBusy(true);
    try {
      await readCommission("/api/nodes/commission", {
        path: "smart_home",
        name,
        pairingCode: pairingCode || undefined,
        confirm: true,
        ...(mock ? { acknowledgeSimulation: true } : {}),
        ...(plan.ambiguous ? { preserveUnresolvedPeers: true as const, expectedHardwareMac: view.deviceMac ?? undefined } : { expectedHardwareMac: view.deviceMac ?? undefined }),
      }, (streamEvent) => {
        if (streamEvent.type === "progress") {
          if (isCommissionStage(streamEvent.stage)) setStage(streamEvent.stage);
          setStageMessage(streamEvent.message);
        } else if (streamEvent.type === "result") {
          setResult(streamEvent.result);
          setStage("ready");
          setStageMessage(streamEvent.result.message);
          if (!streamEvent.result.simulated) setPairingCode("");
          setNodes((current) => current.some((node) => node.id === streamEvent.result.node.id)
            ? current.map((node) => node.id === streamEvent.result.node.id ? streamEvent.result.node : node)
            : [...current, streamEvent.result.node]);
        } else {
          setFailureCode(streamEvent.code);
          setError(streamEvent.message);
          setDiagnosticDetail(diagnosticText(streamEvent.code, streamEvent.detail));
        }
      });
    } catch (reason) {
      const code = reason instanceof ApiError ? reason.code : "request_failed";
      setFailureCode(code);
      setError(reason instanceof ApiError ? reason.message : "Commissioning failed");
      setDiagnosticDetail(reason instanceof ApiError ? diagnosticText(code, reason.detail) : null);
    } finally {
      setBusy(false);
    }
  }

  function continueSetup() {
    if (!guideOpen) {
      setGuideOpen(true);
      setError(null);
      return;
    }
    if (mock) {
      if (!ack) {
        setError("Confirm the simulated record before continuing. No Matter session has been opened.");
        return;
      }
      void submit();
      return;
    }
    if (!contactConfirmed) {
      setError("Confirm that IoT.Edu may contact the device. Nothing has been started.");
      return;
    }
    if (operation === "commission" && plan.ambiguous && !preserveConfirmed) {
      setError("Confirm that the stored peer should be kept before using a new Apple Home code. Nothing has been started.");
      return;
    }
    if (operation === "recover") void recover(false);
    else void submit();
  }

  const appleHomeStatus = view.appleHomeConfirmedAt
    ? `You confirmed Apple Home on ${formatLocalDateTime(view.appleHomeConfirmedAt)}. IoT.Edu has not read that fabric.`
    : "Not verified by IoT.Edu.";
  const firmwareStatus = selectedInstallation
    ? `${selectedInstallation.softwareVersionString || "Unknown"} / SoftwareVersion ${selectedInstallation.softwareVersion ?? "unknown"} from the installation record`
    : "No installation record for this hardware MAC.";

  return (
    <section className="stack">
      <header>
        <h1>Add Device to IoT.Edu</h1>
        <p className="lede">Add a smart-home node to IoT.Edu management. Add an existing Apple Home device to IoT.Edu as another administrator. Apple Home and the Thread network stay in place.</p>
      </header>
      <WorkflowStrip setup={view} />
      <section className="panel">
        <h2>Selected device</h2>
        <dl className="facts">
          <div><dt>Device name</dt><dd>{matchingNode?.name || name}</dd></div>
          <div><dt>Hardware</dt><dd>{view.deviceModel || "ESP32-H2"}</dd></div>
          <div><dt>Hardware MAC</dt><dd>{view.deviceMac ?? "Not selected"}</dd></div>
          <div><dt>Installed firmware</dt><dd>{firmwareStatus}</dd></div>
          <div><dt>Apple Home</dt><dd>{appleHomeStatus}</dd></div>
          <div><dt>IoT.Edu management</dt><dd>{plan.managementStatus}</dd></div>
        </dl>
        <p>{plan.peerStatus}</p>
      </section>
      {guideOpen && (
        <section className="panel">
          <h2>{operation === "recover" ? "Reconnect the stored device" : "Add IoT.Edu beside Apple Home"}</h2>
          {plan.ambiguous && (
            <fieldset>
              <legend>Choose the next operation</legend>
              <label className="choice">
                <input type="radio" name="setup-operation" checked={operation === "recover"} onChange={() => { setChosen("recover"); setSubmitted(false); setFailureCode(null); }} />
                Retry the stored IoT.Edu connection
              </label>
              <label className="choice">
                <input type="radio" name="setup-operation" checked={operation === "commission"} onChange={() => { setChosen("commission"); setFabricStarted(false); setFailureCode(null); }} />
                Pair this board with a new Apple Home code
              </label>
            </fieldset>
          )}
          {operation === "commission" && (
            <p>Apple Home must remain commissioned. In the Home app, open the accessory and turn on pairing mode. Paste the new code created for another administrator. The original factory code is not reused, and the code is not written to the log.</p>
          )}
          {operation === "recover" && <p>IoT.Edu will look for the stored peer, reconnect, and read its identity before saving a management record. This does not add a fabric.</p>}
          <ol className="steps" aria-live="polite">
            {(operation === "recover" ? EXISTING_FABRIC_STEPS : APPLE_HOME_STEPS).map((step) => {
              const state = operation === "recover" ? fabricStates[step.id as ExistingFabricStepId] : states[step.id as keyof typeof states];
              return (
                <li key={step.id} data-state={state}>
                  <span className="step-state">{stateLabel(state)}</span>
                  {step.label}
                </li>
              );
            })}
          </ol>
          {showCode && (
            <label>
              New Apple Home pairing code
              <input value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} autoComplete="off" spellCheck={false} />
            </label>
          )}
          {operation === "commission" && plan.ambiguous && (
            <label className="choice">
              <input type="checkbox" checked={preserveConfirmed} onChange={(event) => setPreserveConfirmed(event.target.checked)} />
              Keep the unverified peer. I understand a new code can add another IoT.Edu fabric if that peer is actually this board.
            </label>
          )}
          {!mock && (
            <label className="choice">
              <input type="checkbox" checked={contactConfirmed} onChange={(event) => setContactConfirmed(event.target.checked)} />
              Contact the device now. Apple Home stays in place.
            </label>
          )}
          {mock && (
            <label className="choice">
              <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />
              I understand this creates a simulated local record and does not commission a device.
            </label>
          )}
          {stageMessage && <p>{stageMessage}</p>}
        </section>
      )}
      <div className="actions">
        <Link className="button secondary" to="/smart-home">Back</Link>
        <button type="button" onClick={continueSetup} disabled={busy || caps === null || (guideOpen && !mock && !identityReady)}>
          {busy ? "Contacting the device" : PRIMARY_SETUP_ACTION}
        </button>
      </div>
      {error && (
        <div className="banner bad" role="alert">
          <p>{error}</p>
          <p>{recoveryFor(failureCode, operation)}</p>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => { setChosen("recover"); setGuideOpen(true); setContactConfirmed(false); setError(null); setFailureCode(null); }}>Retry existing connection</button>
            <button type="button" className="secondary" onClick={() => setDiagnosticsOpen(true)}>Review connection diagnostics</button>
            <button type="button" className="secondary" onClick={() => { setChosen("commission"); setGuideOpen(true); setContactConfirmed(false); setPreserveConfirmed(false); setError(null); }}>Pair this board after confirmation</button>
          </div>
        </div>
      )}
      {result && (
        <div className={result.simulated || !result.matterSessionOpened ? "banner" : "banner ok"}>
          <strong>{result.message}</strong>
          {result.limitation && <p>{result.limitation}</p>}
          {result.simulated ? <p>No live Matter session was opened.</p> : (
            <p>
              SoftwareVersion {result.node.softwareVersion ?? "was not returned"}
              {result.node.softwareVersionString ? ` (${result.node.softwareVersionString})` : ""}.
              {result.node.hardwareMac ? ` Linked hardware MAC ${result.node.hardwareMac}.` : " No hardware MAC was associated."}
            </p>
          )}
          <Link className="button" to={`/nodes/${result.node.id}`}>Open node details</Link>
          <Link className="button secondary" to="/">Continue to Overview</Link>
        </div>
      )}
      <details className="panel" open={diagnosticsOpen} onToggle={(event) => setDiagnosticsOpen(event.currentTarget.open)}>
        <summary>Advanced Diagnostics</summary>
        <p>Stored Matter peers, operational node ids, and technical error details stay here. They are not required to continue.</p>
        {storedPeers.length > 0 ? (
          <fieldset>
            <legend>Stored Matter peers</legend>
            {storedPeers.map((peer) => (
              <label key={peer.matterNodeId} className="choice">
                <input type="radio" name="matter-peer" checked={selectedPeerId === peer.matterNodeId} onChange={() => setSelectedPeerId(peer.matterNodeId)} />
                Matter node {peer.matterNodeId}{peer.commissionedAt ? `, commissioned ${formatLocalDateTime(peer.commissionedAt)}` : ""}
              </label>
            ))}
          </fieldset>
        ) : <p>No unsaved Matter peer is stored.</p>}
        {failureCode && <p>Error code: {failureCode}</p>}
        {diagnosticDetail && <pre className="log">{diagnosticDetail}</pre>}
        {failureCode === "identity_unproven" && operation === "recover" && (
          <button type="button" className="secondary" disabled={busy} onClick={() => void recover(true)}>Register without linking hardware</button>
        )}
      </details>
    </section>
  );
}

function diagnosticText(code: string, detail: unknown): string {
  const record = detail && typeof detail === "object" ? detail as Record<string, unknown> : {};
  return [
    `code: ${code}`,
    `stage: ${String(record.stage ?? "not reported")}`,
    `errorClass: ${String(record.errorClass ?? "not reported")}`,
    `elapsedMs: ${String(record.elapsedMs ?? "not reported")}`,
    `attempts: ${String(record.attempts ?? "not reported")}`,
    record.clusterId != null ? `cluster: ${record.clusterId}` : "",
    record.attributeId != null ? `attribute: ${record.attributeId}` : "",
  ].filter(Boolean).join("\n");
}

function isCommissionStage(value: string): value is CommissionStage {
  return value === "validating_code" || value === "discovering" || value === "operational_case" || value === "verifying_firmware" || value === "ready" || value === "failed";
}

function stateLabel(state: "pending" | "active" | "done" | "failed"): string {
  if (state === "done") return "Done";
  if (state === "active") return "In progress";
  if (state === "failed") return "Failed";
  return "Waiting";
}

async function readCommission(url: string, body: unknown, onEvent: (event: StreamEvent) => void): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson" },
    body: JSON.stringify(body),
  });
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const payload = await response.json() as CommissionResult & { error?: { message: string; code?: string; detail?: unknown } };
    if (!response.ok) throw new ApiError(payload.error?.message ?? `The request failed (${response.status})`, response.status, payload.error?.code ?? "request_failed", payload.error?.detail ?? null);
    onEvent({ type: "result", result: payload });
    return;
  }
  if (!response.ok || !response.body) {
    throw new ApiError(`The request failed (${response.status})`, response.status);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as StreamEvent);
    }
    if (chunk.done) break;
  }
}
