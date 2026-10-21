import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { CommissionResult } from "@iotedu/contracts";
import { ApiError, api } from "../api";

export function PairPage() {
  const [path, setPath] = useState<"new_device" | "smart_home">("smart_home");
  const [name, setName] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [ack, setAck] = useState(false);
  const [result, setResult] = useState<CommissionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const body = await api<CommissionResult>("/api/nodes/commission", {
        method: "POST",
        body: JSON.stringify({
          path,
          name,
          pairingCode: pairingCode || undefined,
          confirm: true,
          acknowledgeSimulation: true,
        }),
      });
      setResult(body);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Commissioning failed");
    }
  }

  return (
    <section className="stack">
      <header>
        <h1>Pair New Node</h1>
        <p className="lede">The management fabric is an administrative Matter fabric. It does not create another Thread network.</p>
      </header>
      <div className="banner">
        Bluetooth commissioning is unsupported on this host, and no Thread operational dataset is stored. The recommended path is to share a node that is already on a smart-home Thread network. Submitting the form stores a simulated record only.
      </div>
      <form className="panel stack" onSubmit={submit}>
        <div className="row">
          <label>
            Path
            <select value={path} onChange={(event) => setPath(event.target.value as "new_device" | "smart_home")}>
              <option value="smart_home">Already in a smart-home ecosystem</option>
              <option value="new_device">Brand-new device</option>
            </select>
          </label>
          <label>
            Node name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
        </div>
        {path === "new_device" ? (
          <p>A brand-new ESP32-H2 needs initial USB firmware and an existing Thread network before it can join. This application cannot commission over Bluetooth yet.</p>
        ) : (
          <p>On the existing controller, open Matter multi-admin sharing and copy the pairing code. IoT.Edu will not contact that controller in this release.</p>
        )}
        <label>
          Pairing code (optional, stored only as a redacted audit note)
          <input value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} autoComplete="off" />
        </label>
        <label className="row">
          <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />
          I understand this creates a simulated local record and does not commission a device.
        </label>
        <button disabled={!ack || !name} type="submit">Save simulated record</button>
      </form>
      {error && <p className="banner bad">{error}</p>}
      {result && (
        <div className="banner">
          <strong>{result.message}</strong>
          <p>{result.limitation}</p>
          <Link className="button" to={`/nodes/${result.node.id}`}>Open node details</Link>
        </div>
      )}
    </section>
  );
}
