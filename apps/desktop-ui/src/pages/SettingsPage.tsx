import { useEffect, useState } from "react";
import type { CapabilityReport, ControllerStatus } from "@iotedu/contracts";
import { ApiError, api } from "../api";

interface Settings {
  applicationVersion: string;
  dataDir: string;
  buildMode: string;
  expectedIdfVersion: string;
  idfPathConfigured: boolean;
  espMatterPathConfigured: boolean;
  toolchainProbed: boolean;
  dockerProbed: boolean;
  controllerIdentityLoaded: boolean;
  fabricLabel: string;
  notes: string[];
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [controller, setController] = useState<ControllerStatus | null>(null);
  const [caps, setCaps] = useState<CapabilityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<Settings>("/api/settings"),
      api<ControllerStatus>("/api/controller/status"),
      api<CapabilityReport>("/api/capabilities"),
    ]).then(([settingsBody, controllerBody, capabilityBody]) => {
      setSettings(settingsBody);
      setController(controllerBody);
      setCaps(capabilityBody);
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  async function createIdentity() {
    setError(null);
    try {
      const status = await api<ControllerStatus>("/api/controller/identity", {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      setController(status);
      setNotice(status.message);
      if (settings) setSettings({ ...settings, controllerIdentityLoaded: status.identityLoaded, fabricLabel: status.fabricLabel });
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "The management identity was not created.");
    }
  }

  return (
    <section className="stack">
      <header>
        <h1>Settings & Help</h1>
        <p className="lede">Local paths and capability limits. A missing Matter identity is reported and is not recreated.</p>
      </header>
      {error && <p className="banner bad">{error}</p>}
      {notice && <p className="banner">{notice}</p>}
      {settings && (
        <div className="panel">
          <table>
            <caption className="sr-only">Local configuration</caption>
            <tbody>
              <tr><th scope="row">Application</th><td>{settings.applicationVersion}</td></tr>
              <tr><th scope="row">Build mode</th><td>{settings.buildMode}</td></tr>
              <tr><th scope="row">Expected ESP-IDF</th><td>{settings.expectedIdfVersion}</td></tr>
              <tr><th scope="row">IDF_PATH</th><td>{settings.idfPathConfigured ? "Configured in the environment" : "Not configured"}</td></tr>
              <tr><th scope="row">ESP_MATTER_PATH</th><td>{settings.espMatterPathConfigured ? "Configured in the environment" : "Not configured"}</td></tr>
              <tr><th scope="row">Toolchain probe</th><td>{settings.toolchainProbed ? "Probed" : "Not probed by the API"}</td></tr>
              <tr><th scope="row">Docker</th><td>{settings.dockerProbed ? "Probed" : "Not probed"}</td></tr>
              <tr><th scope="row">Data directory</th><td>{settings.dataDir}</td></tr>
              <tr><th scope="row">Fabric label</th><td>{settings.fabricLabel}</td></tr>
              <tr><th scope="row">Controller identity</th><td>{settings.controllerIdentityLoaded ? "Loaded" : "Not loaded"}</td></tr>
            </tbody>
          </table>
          <ul>{settings.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </div>
      )}
      {controller && (
        <div className="banner">
          <p>{controller.message}</p>
          {controller.matterJsVersion && <p>Matter.js {controller.matterJsVersion}. Credential id {controller.credentialId ?? "not stored"}. Fabric id {controller.fabricId ?? "assigned when the first node joins"}.</p>}
          {caps?.matterCommissioning !== "mock_only" && !controller.identityLoaded && controller.regenerationBlocked && !controller.persisted && (
            <button type="button" onClick={() => void createIdentity()}>Create management identity</button>
          )}
          <p>{controller.backup}</p>
        </div>
      )}
      {caps && (
        <div className="panel">
          <h2 id="capabilities-heading">Capabilities</h2>
          <table aria-labelledby="capabilities-heading">
            <caption className="sr-only">Capability states</caption>
            <tbody>
              <tr><th scope="row">Matter commissioning</th><td>{caps.matterCommissioning}</td></tr>
              <tr><th scope="row">Bluetooth</th><td>{caps.bleCommissioning}</td></tr>
              <tr><th scope="row">Thread dataset</th><td>{caps.threadDataset}</td></tr>
              <tr><th scope="row">Firmware build</th><td>{caps.firmwareBuild}</td></tr>
              <tr><th scope="row">OTA Provider</th><td>{caps.otaProvider}</td></tr>
              <tr><th scope="row">USB flashing</th><td>{caps.usbFlash}</td></tr>
              <tr><th scope="row">AI</th><td>{caps.ai}</td></tr>
            </tbody>
          </table>
          <h2>Recovery</h2>
          <ul>
            {caps.notes.map((note) => <li key={note}>{note}</li>)}
            <li>Losing this application’s fabric does not by itself require a factory reset if another administrator can reopen commissioning.</li>
            <li>Factory reset is a last resort and is not offered as a button here.</li>
            <li>Source notes are in the repository docs. Development VID 0xFFF1 and PID 0x8000 are prototype identifiers.</li>
          </ul>
        </div>
      )}
    </section>
  );
}
