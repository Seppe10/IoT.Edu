import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FirmwareBuildRequest } from "@iotedu/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, readBoardProfile } from "./app.js";
import { JsonNodeRepository } from "./store.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function createApp() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "iotedu-"));
  const profile = await readBoardProfile(repoRoot);
  const app = await buildApp({
    dataDir,
    repoRoot,
    catalogDir: path.join(repoRoot, "catalog/manifests"),
    profile,
  });
  return { app, dataDir };
}

const mockBuild = (overrides: Partial<FirmwareBuildRequest> = {}): FirmwareBuildRequest => ({
  mode: "mock",
  codeSource: "approved",
  nodeId: null,
  hardware: "esp32h2",
  baseFirmwareId: "iotedu-core",
  componentIds: ["iotedu-dht11"],
  pins: [{ componentId: "iotedu-dht11", pinName: "DHT11_DATA", gpio: 4 }],
  softwareVersion: 2,
  softwareVersionString: "1.1",
  uploadId: null,
  confirm: true,
  ...overrides,
});

describe("local API", () => {
  const closers: Array<{ close(): Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((app) => app.close()));
  });

  it("persists a simulated node across a new repository", async () => {
    const { app, dataDir } = await createApp();
    closers.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/nodes/commission",
      payload: {
        path: "smart_home",
        name: "Lab sensor",
        pairingCode: "3497-011-2332",
        confirm: true,
        acknowledgeSimulation: true,
      },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json();
    expect(body.matterSessionOpened).toBe(false);
    expect(body.node.simulated).toBe(true);
    expect(body.node.matterNodeId).toBeNull();

    const reopened = new JsonNodeRepository(path.join(dataDir, "nodes.json"));
    const stored = await reopened.getById(body.node.id);
    expect(stored?.name).toBe("Lab sensor");

    const audit = await readFile(path.join(dataDir, "audit.jsonl"), "utf8");
    expect(audit).not.toContain("3497-011-2332");
  });

  it("searches the catalogue and refuses a planned driver in a native build", async () => {
    const { app } = await createApp();
    closers.push(app);
    const found = await app.inject({ method: "GET", url: "/api/catalog?q=TemperatureMeasurement" });
    expect(found.json().components.map((item: { id: string }) => item.id)).toEqual(["iotedu-dht11"]);

    const native = await app.inject({
      method: "POST",
      url: "/api/builds",
      payload: mockBuild({ mode: "native", componentIds: ["iotedu-ldr"], pins: [] }),
    });
    expect(native.statusCode).toBe(400);
    const job = native.json().job;
    expect(job.status).toBe("failed");
    expect(job.artifacts).toEqual([]);
    expect(job.logs.join("\n")).toMatch(/planned|not available/i);
  });

  it("labels a mock package as simulated and blocks OTA", async () => {
    const { app } = await createApp();
    closers.push(app);
    const commissioned = await app.inject({
      method: "POST",
      url: "/api/nodes/commission",
      payload: { path: "new_device", name: "Blank", confirm: true, acknowledgeSimulation: true },
    });
    const nodeId = commissioned.json().node.id as string;

    const built = await app.inject({ method: "POST", url: "/api/builds", payload: mockBuild({ nodeId }) });
    expect(built.statusCode).toBe(201);
    const job = built.json().job;
    expect(job.simulated).toBe(true);
    expect(job.status).toBe("simulated");
    expect(job.artifacts[0].deployable).toBe(false);
    expect(job.logs.join("\n")).toMatch(/ESP-IDF was not invoked/);

    const preflight = await app.inject({
      method: "POST",
      url: "/api/ota/preflight",
      payload: {
        nodeId,
        buildId: job.id,
        artifactName: "SIMULATED.txt",
        userApproved: true,
        confirm: true,
      },
    });
    const result = preflight.json();
    expect(result.allowed).toBe(false);
    expect(result.checks.find((check: { id: string }) => check.id === "ota_requestor").status).toBe("unknown");
    expect(result.checks.find((check: { id: string }) => check.id === "artifact_real").status).toBe("failed");

    const deployed = await app.inject({
      method: "POST",
      url: "/api/ota/jobs",
      payload: {
        nodeId,
        buildId: job.id,
        artifactName: "SIMULATED.txt",
        userApproved: true,
        confirm: true,
        nodeIds: [nodeId, "other"],
      },
    });
    expect(deployed.statusCode).toBe(400);

    const single = await app.inject({
      method: "POST",
      url: "/api/ota/jobs",
      payload: {
        nodeId,
        buildId: job.id,
        artifactName: "SIMULATED.txt",
        userApproved: true,
        confirm: true,
      },
    });
    expect(single.statusCode).toBe(409);
    expect(single.json().job.status).toBe("blocked");
    expect(single.json().job.installedVersionConfirmed).toBe(false);
    expect(single.json().job.stages.every((stage: { state: string }) => stage.state === "not_observed")).toBe(true);

    const refreshed = await app.inject({ method: "POST", url: `/api/nodes/${nodeId}/refresh` });
    expect(refreshed.json().liveRead).toBe("unavailable");
    expect(refreshed.json().node.softwareVersion).toBeNull();
  });

  it("reports capability limits and does not create a controller identity", async () => {
    const { app } = await createApp();
    closers.push(app);
    const caps = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(caps.json().bleCommissioning).toBe("unsupported");
    expect(caps.json().firmwareBuild).toBe("mock_only");
    expect(caps.json().ai).toBe("needs_setup");
    const controller = await app.inject({ method: "GET", url: "/api/controller/status" });
    expect(controller.json().identityLoaded).toBe(false);
    const ai = await app.inject({
      method: "POST",
      url: "/api/ai/draft",
      payload: {
        peripheralName: "LDR",
        interfaceName: "ADC",
        gpioNotes: "GPIO1",
        behaviour: "read light",
        matterFunction: "illuminance",
        dependencies: "",
      },
    });
    expect(ai.statusCode).toBe(503);
  });

  it("does not expose a simulated package as a flashable or OTA image", async () => {
    const { app, dataDir } = await createApp();
    closers.push(app);
    const built = await app.inject({ method: "POST", url: "/api/builds", payload: mockBuild() });
    const job = built.json().job;
    const listed = await app.inject({ method: "GET", url: `/api/builds/${job.id}/artifacts` });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["content-type"]).toMatch(/application\/json/);
    expect(listed.json().artifacts).toEqual([
      expect.objectContaining({
        name: "SIMULATED.txt",
        simulated: true,
        deployable: false,
      }),
    ]);
    expect(listed.body).not.toMatch(/sensors\.bin|\.ota\b/);
    const artifact = await readFile(path.join(dataDir, job.artifacts[0].relativePath), "utf8");
    expect(artifact).toMatch(/not an ESP-IDF application binary/);
    expect(artifact).toMatch(/Do not flash/);

    const routes = app.printRoutes();
    expect(routes).not.toMatch(/flash|esptool|serial/i);
  });

  it("has no USB flasher or compiler invocation in the application source", async () => {
    async function filesUnder(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const found: string[] = [];
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) found.push(...await filesUnder(full));
        else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) found.push(full);
      }
      return found;
    }
    const sources = [
      ...await filesUnder(path.join(repoRoot, "apps")),
      ...await filesUnder(path.join(repoRoot, "packages")),
    ];
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = await readFile(file, "utf8");
      expect(text, file).not.toMatch(/esptool|child_process|ota_image_tool|idf\.py|execFile|spawn\(/);
    }
  });

  it("has no PostgreSQL or GitHub client dependency", async () => {
    const packages = ["package.json", "apps/local-api/package.json", "apps/desktop-ui/package.json"];
    for (const relative of packages) {
      const text = await readFile(path.join(repoRoot, relative), "utf8");
      expect(text).not.toMatch(/postgres|pg\b|prisma|typeorm|octokit|@octokit/i);
    }
    const manifestNames = await readdir(path.join(repoRoot, "catalog/manifests"));
    expect(manifestNames.length).toBeGreaterThan(0);
  });
});
