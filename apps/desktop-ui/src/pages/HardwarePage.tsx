import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BuildJob, ControllerStatus, OtaJob, ProgramSession } from "@iotedu/contracts";
import { api } from "../api";

type Verdict = "Pass" | "Fail" | "Blocked" | "Not tested";

interface NodeRow {
  id: string;
  name: string;
  simulated: boolean;
  matterNodeId: string | null;
  vendorId: number | null;
  productId: number | null;
  softwareVersion: number | null;
  softwareVersionString: string | null;
  reachable: boolean | null;
}

interface ProbeResult {
  port: string;
  accepted: boolean;
  detail: string;
}

interface WritePlan {
  buildId: string;
  softwareVersion: number;
  softwareVersionString: string;
  regions: Array<{ offset: string; artifact: string; bytes: number }>;
  preserved: string[];
}

interface LiveRead {
  liveRead: "unavailable" | "read" | "failed";
  message: string;
  node: NodeRow;
}

function pillClass(status: Verdict): string {
  if (status === "Pass") return "pill passed";
  if (status === "Fail") return "pill failed";
  if (status === "Blocked") return "pill blocked";
  return "pill not_tested";
}

function installCandidate(job: BuildJob): boolean {
  return job.status === "succeeded"
    && !job.simulated
    && job.verification === "compiled"
    && job.request.hardware === "esp32h2"
    && job.request.softwareVersion === 2
    && job.request.softwareVersionString === "1.1.0"
    && job.artifacts.some((item) => item.name === "sensors.ota" && item.deployable && !item.simulated);
}

function fromCheck(status: "passed" | "failed" | "unknown" | undefined, blocked: boolean): Verdict {
  if (blocked) return "Blocked";
  if (status === "passed") return "Pass";
  if (status === "failed") return "Fail";
  return "Not tested";
}

export function HardwarePage() {
  const [ports, setPorts] = useState<string[] | null>(null);
  const [seen, setSeen] = useState<string[]>([]);
  const [port, setPort] = useState("");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [plan, setPlan] = useState<WritePlan | null>(null);
  const [arrived, setArrived] = useState<string[]>([]);
  const [builds, setBuilds] = useState<BuildJob[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [session, setSession] = useState<ProgramSession | null>(null);
  const [controller, setController] = useState<ControllerStatus | null>(null);
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [jobs, setJobs] = useState<OtaJob[]>([]);
  const [live, setLive] = useState<LiveRead | null>(null);
  const [error, setError] = useState<string | null>(null);

  const candidate = builds.find(installCandidate) ?? null;
  const noDevice = ports !== null && ports.length === 0;
  const chipOk = probe?.accepted === true && probe.port === port;

  useEffect(() => {
    Promise.all([
      api<{ ports: string[] }>("/api/programmer/ports"),
      api<{ jobs: BuildJob[] }>("/api/builds"),
      api<ControllerStatus>("/api/controller/status"),
      api<{ nodes: NodeRow[] }>("/api/nodes"),
      api<{ jobs: OtaJob[] }>("/api/ota/jobs"),
    ]).then(([portBody, buildBody, controllerBody, nodeBody, otaBody]) => {
      setPorts(portBody.ports);
      setSeen(portBody.ports);
      setPort(portBody.ports[0] ?? "");
      setBuilds(buildBody.jobs);
      setController(controllerBody);
      setNodes(nodeBody.nodes);
      setJobs(otaBody.jobs);
    }).catch((reason: Error) => setError(reason.message));
  }, []);

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

  async function detect() {
    setError(null);
    setProbe(null);
    setPlan(null);
    setConfirmed(false);
    const body = await api<{ ports: string[] }>("/api/programmer/ports");
    const added = body.ports.filter((item) => seen.length > 0 && !seen.includes(item));
    setArrived(added);
    setSeen(body.ports);
    setPorts(body.ports);
    setPort((current) => added[0] ?? body.ports.find((item) => item === current) ?? body.ports[0] ?? "");
  }

  const candidateId = candidate?.id;
  useEffect(() => {
    if (!chipOk || !candidateId) {
      setPlan(null);
      return;
    }
    let stopped = false;
    api<WritePlan>("/api/programmer/plan", {
      method: "POST",
      body: JSON.stringify({ buildId: candidateId, port }),
    }).then((body) => {
      if (!stopped) setPlan(body);
    }).catch((reason: Error) => {
      if (!stopped) {
        setPlan(null);
        setError(reason.message);
      }
    });
    return () => {
      stopped = true;
    };
  }, [chipOk, candidateId, port]);

  async function identify() {
    setError(null);
    setProbe(null);
    try {
      const body = await api<ProbeResult>("/api/programmer/probe", {
        method: "POST",
        body: JSON.stringify({ port }),
      });
      setProbe(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The chip probe failed");
    }
  }

  async function writeImage() {
    if (!candidate) return;
    setError(null);
    try {
      const body = await api<{ session: ProgramSession }>("/api/programmer/sessions", {
        method: "POST",
        body: JSON.stringify({
          buildId: candidate.id,
          port,
          intent: "initial_install",
          confirm: true,
          preserveNvs: true,
        }),
      });
      setSession(body.session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The write was rejected");
    }
  }

  async function monitor() {
    if (!session) return;
    setError(null);
    try {
      const body = await api<{ session: ProgramSession }>(`/api/programmer/sessions/${session.id}/monitor`, { method: "POST" });
      setSession(body.session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The serial monitor did not start");
    }
  }

  async function readNode(id: string) {
    setError(null);
    try {
      const body = await api<LiveRead>(`/api/nodes/${id}/refresh`, { method: "POST" });
      setLive(body);
      setNodes((current) => current.map((node) => node.id === id ? body.node : node));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The node read failed");
    }
  }

  const check = (id: string) => session?.checks.find((item) => item.id === id)?.status;
  const versionRead = live?.liveRead === "read" ? live.node.softwareVersion : null;
  const otaSucceeded = jobs.some((job) => job.status === "succeeded" && job.expectedSoftwareVersion === 3
    && job.stages.some((stage) => stage.id === "version_verified" && stage.state === "observed"));

  const rows: Array<{ id: string; stage: string; expected: string; actual: string; status: Verdict }> = [
    {
      id: "A1",
      stage: "A",
      expected: "A USB serial device is present.",
      actual: ports === null
        ? "Port list has not loaded."
        : ports.length === 0
          ? "No allowed USB serial port is connected."
          : ports.join(", "),
      status: ports === null ? "Not tested" : ports.length === 0 ? "Blocked" : "Pass",
    },
    {
      id: "A2",
      stage: "A",
      expected: "The connected chip reports ESP32-H2.",
      actual: noDevice
        ? "No board to probe."
        : probe
          ? probe.detail
          : "Chip probe has not been run.",
      status: noDevice ? "Blocked" : probe ? (probe.accepted ? "Pass" : "Fail") : "Not tested",
    },
    {
      id: "A3",
      stage: "A",
      expected: "A compiled 1.1.0 package with a deployable sensors.ota file is stored on this computer.",
      actual: candidate
        ? `Software check, not a board: ${candidate.request.softwareVersionString} / SoftwareVersion ${candidate.request.softwareVersion}, build ${candidate.id}.`
        : "This data directory has no compiled 1.1.0 package.",
      status: candidate ? "Pass" : "Blocked",
    },
    {
      id: "A4",
      stage: "A",
      expected: "USB write of 1.1.0 finishes and leaves NVS and factory data in place.",
      actual: noDevice
        ? "Write not started."
        : session
          ? `${session.message} NVS preserved: ${session.nvsPreserved}. Hardware-verified flag: ${session.hardwareVerified}.`
          : "Write not started.",
      status: noDevice ? "Blocked" : fromCheck(check("write"), false),
    },
    {
      id: "A5",
      stage: "A",
      expected: "Serial output shows a boot banner and no panic.",
      actual: session?.checks.find((item) => item.id === "boot")?.detail ?? "No serial capture.",
      status: noDevice ? "Blocked" : fromCheck(check("boot"), false),
    },
    {
      id: "A6",
      stage: "A",
      expected: "Matter and OpenThread start, and the DHT11 task logs.",
      actual: session
        ? ["matter", "openthread", "dht11"].map((id) => session.checks.find((item) => item.id === id)?.detail ?? id).join(" ")
        : "No serial capture.",
      status: noDevice
        ? "Blocked"
        : (check("matter") === "failed" || check("openthread") === "failed" || check("dht11") === "failed")
          ? "Fail"
          : (check("matter") === "passed" && check("openthread") === "passed" && check("dht11") === "passed")
            ? "Pass"
            : "Not tested",
    },
    {
      id: "A7",
      stage: "A",
      expected: "The serial banner reports firmware 1.1.0.",
      actual: session?.checks.find((item) => item.id === "version")?.detail ?? "Version banner not captured.",
      status: noDevice ? "Blocked" : fromCheck(check("version"), false),
    },
    {
      id: "B1",
      stage: "B",
      expected: "Apple Home commissions the board onto the HomePod mini Thread network. Temperature and humidity endpoints appear in Home.",
      actual: "Not observed. This application cannot see Apple Home.",
      status: "Not tested",
    },
    {
      id: "C1",
      stage: "C",
      expected: "Software check: the stored Matter controller identity is still loaded. This is not a device session.",
      actual: controller
        ? controller.message
        : "Controller status has not loaded.",
      status: controller?.identityLoaded && controller.persisted && controller.credentialId ? "Pass" : "Not tested",
    },
    {
      id: "C2",
      stage: "C",
      expected: "A live CASE read returns SoftwareVersion 2, plus the device vendor, product, and node id.",
      actual: live
        ? `${live.message} Vendor ${live.node.vendorId ?? "unknown"}, product ${live.node.productId ?? "unknown"}, node ${live.node.matterNodeId ?? "unknown"}, SoftwareVersion ${live.node.softwareVersion ?? "unknown"}.`
        : nodes.some((node) => !node.simulated)
          ? "A node record exists. It has not been read in this check."
          : "No management-fabric node is stored.",
      status: versionRead === 2 ? "Pass" : live?.liveRead === "failed" ? "Fail" : "Not tested",
    },
    {
      id: "D1",
      stage: "D",
      expected: "The device requests 1.2.0, BDX finishes, and a later read reports SoftwareVersion 3.",
      actual: jobs.length === 0
        ? "No OTA job is stored."
        : jobs.map((job) => `${job.id} ${job.status}, expected ${job.expectedSoftwareVersion ?? "unknown"}`).join("; "),
      status: versionRead === 3 && otaSucceeded ? "Pass" : "Not tested",
    },
    {
      id: "E1",
      stage: "E",
      expected: "Recovery checks run only after A–D pass. An incomplete OTA job stays unsuccessful.",
      actual: "Not started.",
      status: "Not tested",
    },
  ];

  return (
    <div className="stack">
      <header>
        <h1>Hardware verification</h1>
        <p>
          Stages run on a physical ESP32-H2, Apple Home, and a HomePod mini Thread border router.
          A missing board stays blocked. A simulated package cannot be written or offered.
        </p>
      </header>
      {error && <p className="banner bad" role="alert">{error}</p>}
      {noDevice && (
        <div className="banner" role="status">
          <p>No allowed USB serial port is connected. Nothing will be flashed, and the firmware is left unchanged.</p>
          <ul>
            <li>Use a data cable. A charge-only cable can power the board without creating a serial port.</li>
            <li>An ESP32-H2 USB-Serial-JTAG port appears as <code>/dev/cu.usbmodem…</code>. A CH340 or CP210x adapter appears as <code>wchusbserial</code>, <code>usbserial</code>, or <code>SLAB_USBtoUART</code> after its macOS driver is installed.</li>
            <li>Close any other program that has the port open. macOS does not require a special permission for these <code>/dev/cu</code> devices.</li>
            <li>Hold BOOT only if a later chip probe says the board did not answer. A missing port is not fixed by changing the firmware.</li>
          </ul>
        </div>
      )}
      {arrived.length > 0 && <p className="banner ok" role="status">Newly connected: {arrived.join(", ")}. Confirm the chip before flashing.</p>}

      <section className="panel stack">
        <h2>Stage A — USB connection and firmware 1.1.0</h2>
        <p>The write keeps NVS, factory data, and the secure-cert partition. Full-chip erase is not offered.</p>
        <div className="row">
          <button type="button" onClick={() => void detect()}>Detect serial device</button>
          <label>
            Port
            <select value={port} onChange={(event) => { setPort(event.target.value); setProbe(null); setPlan(null); setConfirmed(false); }} disabled={!ports?.length}>
              {ports?.length ? ports.map((item) => <option key={item} value={item}>{item}</option>) : <option value="">No device</option>}
            </select>
          </label>
          <button type="button" onClick={() => void identify()} disabled={!port || noDevice}>Confirm chip</button>
        </div>
        <p>{candidate ? `Selected package ${candidate.request.softwareVersionString} (SoftwareVersion ${candidate.request.softwareVersion}).` : "Firmware 1.1.0 is not in this data directory, so the write stays disabled."}</p>
        {plan && (
          <div>
            <p>These regions will be written. NVS, factory data, and the secure-cert partition are not in the list. Matter credentials stored there stay.</p>
            <table>
              <thead>
                <tr>
                  <th>Offset</th>
                  <th>File</th>
                  <th>Bytes</th>
                </tr>
              </thead>
              <tbody>
                {plan.regions.map((region) => (
                  <tr key={region.offset}>
                    <td>{region.offset}</td>
                    <td>{region.artifact}</td>
                    <td>{region.bytes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>Left unchanged: {plan.preserved.join(", ")}.</p>
          </div>
        )}
        <label className="choice">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>Write 1.1.0 to this ESP32-H2. NVS and factory partitions stay.</span>
        </label>
        <div className="row">
          <button type="button" onClick={() => void writeImage()} disabled={!chipOk || !candidate || !plan || !confirmed || session?.status === "running"}>
            Flash 1.1.0
          </button>
          <button type="button" className="secondary" onClick={() => void monitor()} disabled={!session || session.status === "running" && session.stage === "writing"}>
            Monitor serial output
          </button>
        </div>
        {session && <pre className="log">{session.logs.join("\n")}{session.monitorLog ? `\n${session.monitorLog}` : ""}</pre>}
      </section>

      <section className="panel stack">
        <h2>Stage B — Apple Home</h2>
        <ol>
          <li>Power the board from USB and watch the serial log for a commissioning window.</li>
          <li>In Apple Home, add an accessory and use the setup code printed for this firmware. The image is built with development vendor 0xFFF1, product 0x8000, and the esp-matter example device certificate.</li>
          <li>If Home rejects that certificate, copy the error into the verification report. Leave the board commissioned state unchanged and do not factory-reset it.</li>
          <li>Confirm the accessory joins the existing Thread network through the HomePod mini, and that Home shows temperature and humidity.</li>
        </ol>
        <p>This screen cannot observe Apple Home, so Stage B stays “Not tested” until that evidence is recorded outside the app.</p>
      </section>

      <section className="panel stack">
        <h2>Stage C — IoT.Edu management fabric</h2>
        <p>
          After Home has the accessory, open a new commissioning window in Home and enter that code on <Link to="/pair">Pair New Node</Link>.
          Use the smart-home path. Do not factory-reset the board if commissioning fails.
        </p>
        <p>
          Controller identity: {controller?.credentialId ?? "not loaded"}. Persisted: {controller ? String(controller.persisted) : "unknown"}.
        </p>
        {nodes.filter((node) => !node.simulated).map((node) => (
          <div className="row" key={node.id}>
            <span>{node.name}</span>
            <button type="button" onClick={() => void readNode(node.id)}>Read identity and SoftwareVersion</button>
          </div>
        ))}
        {nodes.every((node) => node.simulated) && <p>No live node is stored. A simulated record is not a CASE session.</p>}
      </section>

      <section className="panel stack">
        <h2>Stage D — Matter OTA to 1.2.0</h2>
        <p>
          Continue only after A, B, and C pass. Offer the compiled 1.2.0 image from <Link to="/ota">OTA Preflight</Link>.
          The job is successful only when a live read returns SoftwareVersion 3. A finished transfer is not enough.
        </p>
      </section>

      <section className="panel stack">
        <h2>Stage E — Reliability</h2>
        <p>
          After the update, retry USB disconnect, an application restart, an API restart, a controller disconnect, and a Thread interruption only with a recovery plan.
          Do not stop a flash write that is already erasing or programming. Do not erase controller credentials from this page.
        </p>
      </section>

      <section className="panel">
        <h2>Results</h2>
        <table>
          <thead>
            <tr>
              <th>Test</th>
              <th>Expected</th>
              <th>Actual</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.expected}</td>
                <td>{row.actual}</td>
                <td><span className={pillClass(row.status)}>{row.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
