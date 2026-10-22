import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MatterManagementService, OtaProviderEvent } from "@iotedu/contracts";
import { encodeMatterOtaImage, loadReferenceLayout } from "@iotedu/firmware-builder";
import { MemoryNodeRepository, MockMatterManagementService } from "@iotedu/matter-controller";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, readBoardProfile } from "./app.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

class ScriptedProvider extends MockMatterManagementService {
  version: number | null = 2;
  readonly listeners = new Set<(event: OtaProviderEvent) => void>();

  async getOtaProviderStatus() {
    return { running: true, endpointNumber: 2, fabricScoped: true, ledgerOffline: true };
  }

  async beginOta(input: { matterNodeId: string; image: Uint8Array; vendorId: number; productId: number; softwareVersion: number }) {
    this.emit({ type: "bdx-start", matterNodeId: input.matterNodeId, detail: "BDX session started." });
  }

  async readInstalledSoftwareVersion() {
    return this.version;
  }

  subscribeOta(listener: (event: OtaProviderEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: OtaProviderEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

describe("Matter OTA provider jobs", () => {
  const closers: Array<{ close(): Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((app) => app.close()));
  });

  it("rejects a simulated package and an incompatible image, then verifies only the read-back version", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iotedu-ota-"));
    const profile = await readBoardProfile(repoRoot);
    const layout = await loadReferenceLayout(repoRoot, profile);
    const provider = new ScriptedProvider(new MemoryNodeRepository());
    const image = encodeMatterOtaImage({ vendorId: 0xfff1, productId: 0x8000, softwareVersion: 3, softwareVersionString: "1.2.0" });
    const wrong = encodeMatterOtaImage({ vendorId: 0x1234, productId: 0x8000, softwareVersion: 3, softwareVersionString: "1.2.0" });
    await mkdir(path.join(dataDir, "builds", "build-ok", "artifacts"), { recursive: true });
    await mkdir(path.join(dataDir, "builds", "build-bad", "artifacts"), { recursive: true });
    await writeFile(path.join(dataDir, "builds", "build-ok", "artifacts", "sensors.ota"), image);
    await writeFile(path.join(dataDir, "builds", "build-bad", "artifacts", "sensors.ota"), wrong);
    const now = new Date().toISOString();
    await writeFile(path.join(dataDir, "nodes.json"), JSON.stringify([{
      id: "node-1",
      name: "Bench",
      simulated: false,
      matterNodeId: "42",
      vendorId: 0xfff1,
      productId: 0x8000,
      softwareVersion: 2,
      softwareVersionString: "1.1.0",
      hardware: "ESP32-H2",
      reachable: true,
      connection: "reachable",
      firmwareUpdateEligible: true,
      fabricLabel: "IoT.Edu Management",
      commissionedFabricCount: 2,
      otherFabricCount: 1,
      partitionLayoutId: layout.layoutId,
      installedComponents: [],
      history: [],
      createdAt: now,
      updatedAt: now,
    }]));
    await writeFile(path.join(dataDir, "builds.json"), JSON.stringify([
      buildRecord("build-ok", 3, image.length, false),
      buildRecord("build-bad", 3, wrong.length, false),
      buildRecord("build-sim", 3, 12, true),
    ]));

    const app = await buildApp({
      dataDir,
      repoRoot,
      catalogDir: path.join(repoRoot, "catalog/manifests"),
      profile,
      nativeAvailable: false,
      matter: provider as unknown as MatterManagementService,
    });
    closers.push(app);

    const simulated = await app.inject({
      method: "POST",
      url: "/api/ota/preflight",
      payload: { nodeId: "node-1", buildId: "build-sim", artifactName: "SIMULATED.txt", userApproved: true, confirm: true },
    });
    expect(simulated.json().allowed).toBe(false);
    expect(simulated.json().checks.find((check: { id: string }) => check.id === "artifact_real").status).toBe("failed");

    const incompatible = await app.inject({
      method: "POST",
      url: "/api/ota/preflight",
      payload: { nodeId: "node-1", buildId: "build-bad", artifactName: "sensors.ota", userApproved: true, confirm: true },
    });
    expect(incompatible.json().allowed).toBe(false);
    expect(incompatible.json().checks.find((check: { id: string }) => check.id === "vid_pid").status).toBe("failed");

    const ready = await app.inject({
      method: "POST",
      url: "/api/ota/preflight",
      payload: { nodeId: "node-1", buildId: "build-ok", artifactName: "sensors.ota", userApproved: true, confirm: true },
    });
    expect(ready.json().allowed).toBe(true);
    expect(ready.json().checks.find((check: { id: string }) => check.id === "ota_requestor").status).toBe("passed");
    expect(ready.json().checks.find((check: { id: string }) => check.id === "provider_permission").detail).toMatch(/not enough/);

    const started = await app.inject({
      method: "POST",
      url: "/api/ota/jobs",
      payload: { nodeId: "node-1", buildId: "build-ok", artifactName: "sensors.ota", userApproved: true, confirm: true },
    });
    expect(started.statusCode).toBe(201);
    const running = started.json().job;
    expect(running.status).toBe("running");
    expect(running.installedVersionConfirmed).toBe(false);
    expect(running.stages.find((stage: { id: string }) => stage.id === "transfer_started").state).toBe("observed");
    expect(running.stages.find((stage: { id: string }) => stage.id === "version_verified").state).toBe("not_observed");

    const second = await app.inject({
      method: "POST",
      url: "/api/ota/jobs",
      payload: { nodeId: "node-1", buildId: "build-ok", artifactName: "sensors.ota", userApproved: true, confirm: true },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().job.status).toBe("blocked");

    provider.emit({ type: "bdx-complete", matterNodeId: "42", detail: "BDX finished." });
    provider.emit({ type: "applying", matterNodeId: "42", detail: "ApplyUpdateRequest received." });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const during = await app.inject({ method: "GET", url: `/api/ota/jobs/${running.id}` });
    expect(during.json().job.status).toBe("running");
    expect(during.json().job.installedVersionConfirmed).toBe(false);

    provider.version = 3;
    const done = await app.inject({ method: "GET", url: `/api/ota/jobs/${running.id}` });
    expect(done.json().job.status).toBe("succeeded");
    expect(done.json().job.installedVersionConfirmed).toBe(true);
    expect(done.json().job.stages.find((stage: { id: string }) => stage.id === "version_verified").state).toBe("observed");
    const stored = await readFile(path.join(dataDir, "ota-jobs.json"), "utf8");
    expect(stored).not.toMatch(/MT:|passcode|PRIVATE KEY|rootKey/);
  });
});

function buildRecord(id: string, softwareVersion: number, size: number, simulated: boolean) {
  const now = new Date().toISOString();
  return {
    id,
    simulated,
    verification: simulated ? "simulated" : "compiled",
    status: simulated ? "simulated" : "succeeded",
    request: { softwareVersion, softwareVersionString: softwareVersion === 3 ? "1.2.0" : "1.1.0", nodeId: "node-1", componentIds: ["iotedu-dht11"], mode: "native" },
    validation: { ok: true, issues: [] },
    logs: [],
    artifacts: [{ name: simulated ? "SIMULATED.txt" : "sensors.ota", sha256: "abc", size, deployable: !simulated, simulated }],
    partitionLayoutId: null,
    durationMs: 1,
    createdAt: now,
    updatedAt: now,
  };
}
