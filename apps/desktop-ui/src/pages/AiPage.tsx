import { useState, type FormEvent } from "react";
import { ApiError, api } from "../api";

export function AiPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    peripheralName: "",
    interfaceName: "",
    gpioNotes: "",
    behaviour: "",
    matterFunction: "",
    dependencies: "",
  });

  function setField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/ai/draft", { method: "POST", body: JSON.stringify(form) });
    } catch (reason) {
      setMessage(reason instanceof ApiError ? reason.message : "AI request failed");
    }
  }

  return (
    <section className="stack">
      <header>
        <h1>AI-Assisted Development</h1>
        <p className="lede">Optional. Without a configured provider, firmware builds, catalogue, and node records keep working. Generated code would still need review and a successful compile before it could be used.</p>
      </header>
      <form className="panel stack" onSubmit={submit}>
        <label>Peripheral name<input value={form.peripheralName} onChange={(event) => setField("peripheralName", event.target.value)} required /></label>
        <label>Interface<input value={form.interfaceName} onChange={(event) => setField("interfaceName", event.target.value)} required /></label>
        <label>GPIO / pin details<textarea value={form.gpioNotes} onChange={(event) => setField("gpioNotes", event.target.value)} required /></label>
        <label>Required behaviour<textarea value={form.behaviour} onChange={(event) => setField("behaviour", event.target.value)} required /></label>
        <label>Expected Matter functionality<textarea value={form.matterFunction} onChange={(event) => setField("matterFunction", event.target.value)} required /></label>
        <label>Additional dependencies<textarea value={form.dependencies} onChange={(event) => setField("dependencies", event.target.value)} /></label>
        <button type="submit">Request a draft</button>
      </form>
      {message && <div className="banner">{message}</div>}
      <div className="panel">
        <h2>Preview</h2>
        <p className="muted">No draft is shown because no provider is configured. Nothing here is marked compatible or working.</p>
      </div>
    </section>
  );
}
