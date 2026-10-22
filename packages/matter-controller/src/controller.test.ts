import { readFileSync } from "node:fs";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MatterOperationError } from "./errors.js";
import { controllerStorageDir } from "./identity.js";
import { openMatterTransport } from "./live.js";
import { redactSecrets } from "./redact.js";
import { MemoryNodeRepository } from "./index.js";
import { LiveMatterManagementService } from "./service.js";
import type { ManagementTransport, ObservedNode } from "./session.js";

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));

const observed: ObservedNode = {
  matterNodeId: "42",
  vendorId: 0xfff1,
  productId: 0x8000,
  hardwareVersion: 1,
  hardwareVersionString: "ESP32-H2",
  softwareVersion: 3,
  softwareVersionString: "1.2.0",
  commissionedFabricCount: 2,
  firmwareUpdateEligible: true,
  connection: "reachable",
  lastCommunicationAt: "2026-10-22T00:00:00.000Z",
};

class FakeTransport implements ManagementTransport {
  createCalls = 0;
  commissionCalls = 0;
  reconnectCalls = 0;
  lastCode = "";
  fail: "none" | "discovery" | "fabric" = "none";
  node: ObservedNode = { ...observed };

  async ensureStarted(options: { create: boolean }) {
    if (options.create) this.createCalls += 1;
    if (!options.create && this.createCalls === 0) {
      throw new MatterOperationError("identity_corrupt", "Stored credentials are missing and were not replaced.");
    }
    return { fabricId: "fabric-1", credentialId: "root-1", controllerNodeId: "7001", matterJsVersion: "0.18.0" };
  }

  async commissionOnExistingNetwork(pairingCode: string) {
    this.commissionCalls += 1;
    this.lastCode = pairingCode;
    if (this.fail === "discovery") throw new MatterOperationError("discovery_failed", `device not found for ${pairingCode}`);
    if (this.fail === "fabric") throw new MatterOperationError("fabric_limit", "The fabric table is full.");
    return this.node;
  }

  async refresh() {
    return { ...this.node, softwareVersion: 4, softwareVersionString: "1.3.0" };
  }

  async reconnect() {
    this.reconnectCalls += 1;
    return [{ ...this.node, connection: "reachable" as const }];
  }

  async openSharingWindow() {
    return { manualPairingCode: "3497-011-2332", qrPairingCode: "MT:Y.ABCDEF" };
  }

  async close() {}

  async otaProviderStatus() {
    return { running: false, endpointNumber: null, fabricScoped: false, ledgerOffline: true };
  }

  async beginOta() {
    throw new MatterOperationError("connection_failed", "The OTA Provider endpoint is not installed.");
  }

  subscribeOta() {
    return () => undefined;
  }

  async listStoredImages() {
    return [];
  }

  async storeLocalImage() {}

  async exerciseBdxArm() {
    return { armed: false, cleared: true };
  }
}

async function service() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "iotedu-matter-"));
  const transport = new FakeTransport();
  const nodes = new MemoryNodeRepository();
  return { dataDir, transport, nodes, matter: new LiveMatterManagementService(nodes, dataDir, transport) };
}

describe("management controller", () => {
  it("keeps one controller identity across a restart and refuses to regenerate it", async () => {
    const { dataDir, transport, nodes, matter } = await service();
    const created = await matter.createIdentity();
    expect(created.identityLoaded).toBe(true);
    expect(created.fabricId).toBe("fabric-1");
    expect(created.credentialId).toBe("root-1");
    expect(created.persisted).toBe(true);
    expect(transport.createCalls).toBe(1);

    const directory = controllerStorageDir(dataDir);
    const directoryMode = (await stat(directory)).mode & 0o777;
    const identityPath = path.join(directory, "identity.json");
    const identityMode = (await stat(identityPath)).mode & 0o777;
    expect(directoryMode).toBe(0o700);
    expect(identityMode).toBe(0o600);
    const stored = await readFile(identityPath, "utf8");
    expect(stored).not.toMatch(/PRIVATE KEY|pairingCode|MT:/);

    const again = await matter.createIdentity();
    expect(again.fabricId).toBe(created.fabricId);
    expect(transport.createCalls).toBe(1);

    const restarted = new LiveMatterManagementService(nodes, dataDir, transport);
    await restarted.restore();
    expect(transport.reconnectCalls).toBe(1);
    const status = await restarted.getControllerStatus();
    expect(status.controllerNodeId).toBe("7001");
    expect(status.regenerationBlocked).toBe(true);
  });

  it("does not replace a corrupt identity or stray credential files", async () => {
    const { dataDir, transport, matter } = await service();
    const directory = controllerStorageDir(dataDir);
    await matter.createIdentity();
    await writeFile(path.join(directory, "identity.json"), "{", { mode: 0o600 });
    await expect(matter.createIdentity()).rejects.toMatchObject({ code: "identity_corrupt" });
    expect(await readFile(path.join(directory, "identity.json"), "utf8")).toBe("{");

    const blockedDir = await mkdtemp(path.join(tmpdir(), "iotedu-matter-"));
    const blocked = new LiveMatterManagementService(new MemoryNodeRepository(), blockedDir, transport);
    const storage = controllerStorageDir(blockedDir);
    await writeFile(path.join(await import("node:fs/promises").then(async (fs) => {
      await fs.mkdir(storage, { recursive: true, mode: 0o700 });
      return storage;
    }), "credentials"), "secret");
    const calls = transport.createCalls;
    await expect(blocked.createIdentity()).rejects.toMatchObject({ code: "regeneration_refused" });
    expect(transport.createCalls).toBe(calls);
  });

  it("validates commissioning codes and redacts them from failures", async () => {
    const { matter, transport, nodes } = await service();
    await matter.createIdentity();
    await expect(matter.commission({ path: "smart_home", name: "Bench", confirm: true })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(matter.commission({ path: "smart_home", name: "Bench", pairingCode: "not-a-code", confirm: true })).rejects.toMatchObject({ code: "invalid_input" });
    expect(transport.commissionCalls).toBe(0);

    transport.fail = "discovery";
    await expect(matter.commission({
      path: "smart_home",
      name: "Bench",
      pairingCode: "3497-011-2332",
      confirm: true,
    })).rejects.toThrow(/\[redacted\]/);
    expect(await nodes.list()).toHaveLength(0);
    expect(redactSecrets("failed MT:Y.ABCDEF and 3497-011-2332")).not.toContain("MT:Y");
    expect(redactSecrets("failed MT:Y.ABCDEF and 3497-011-2332")).not.toContain("3497");
  });

  it("stores only administrative identity returned by the device", async () => {
    const { matter, transport, nodes } = await service();
    await matter.createIdentity();
    const result = await matter.commission({
      path: "smart_home",
      name: "Bench",
      pairingCode: "MT:Y.ABCDEF",
      confirm: true,
    });
    expect(result.simulated).toBe(false);
    expect(result.matterSessionOpened).toBe(true);
    expect(result.node.matterNodeId).toBe("42");
    expect(result.node.vendorId).toBe(0xfff1);
    expect(result.node.productId).toBe(0x8000);
    expect(result.node.softwareVersionString).toBe("1.2.0");
    expect(result.node.hardwareVersion).toBe(1);
    expect(result.node.commissionedFabricCount).toBe(2);
    expect(result.node.otherFabricCount).toBe(1);
    expect(result.node.firmwareUpdateEligible).toBe(true);
    expect(result.node.connection).toBe("reachable");
    expect(result.node.managementFabricId).toBe("fabric-1");
    expect(JSON.stringify(result.node)).not.toContain("MT:");
    expect(JSON.stringify(result.node)).not.toContain("Apple");
    expect(transport.lastCode).toBe("MT:Y.ABCDEF");

    const refreshed = await matter.refreshNode(result.node.id);
    expect(refreshed.liveRead).toBe("read");
    expect(refreshed.node.softwareVersionString).toBe("1.3.0");
    const saved = await nodes.getById(result.node.id);
    expect(saved?.softwareVersion).toBe(4);
  });

  it("reports discovery, fabric limit, missing Bluetooth, and missing Thread credentials without commissioning", async () => {
    const { matter, transport, nodes } = await service();
    await expect(matter.commission({
      path: "smart_home",
      name: "Bench",
      pairingCode: "34970112332",
      confirm: true,
    })).rejects.toMatchObject({ code: "identity_missing" });
    expect(transport.commissionCalls).toBe(0);

    await matter.createIdentity();
    transport.fail = "fabric";
    await expect(matter.commission({
      path: "smart_home",
      name: "Bench",
      pairingCode: "12345678901",
      confirm: true,
    })).rejects.toThrow(/did not factory reset/);
    expect(await nodes.list()).toHaveLength(0);

    transport.fail = "none";
    await expect(matter.commission({
      path: "new_device",
      name: "New board",
      confirm: true,
    })).rejects.toThrow(/Bluetooth commissioning is not part of the installed Matter\.js build/);
    await expect(matter.commission({
      path: "new_device",
      name: "New board",
      pairingCode: "3497-011-2332",
      confirm: true,
    })).rejects.toThrow(/no Thread operational dataset is available/);
    expect(transport.commissionCalls).toBe(1);
    const caps = await matter.getCapabilities();
    expect(caps.bleCommissioning).toBe("unsupported");
    expect(caps.threadDataset).toBe("needs_setup");
    expect(caps.notes.join(" ")).toMatch(/Sensor measurements and actuator commands are not requested/);
    expect(caps.notes.join(" ")).toMatch(/5 fabrics/);
  });

  it("refuses to open Matter.js when credential files are missing", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iotedu-matter-"));
    await expect(openMatterTransport(dataDir, { create: false })).rejects.toMatchObject({ code: "identity_corrupt" });
  });

  it("pins Matter.js 0.18.0 and keeps management reads separate from sensor and actuator clusters", async () => {
    const declared = JSON.parse(readFileSync(path.join(sourceRoot, "../package.json"), "utf8")) as { dependencies: Record<string, string> };
    const installed = JSON.parse(readFileSync(path.resolve(sourceRoot, "../../../node_modules/@matter/main/package.json"), "utf8")) as { version: string };
    expect(declared.dependencies["@matter/main"]).toBe("0.18.0");
    expect(installed.version).toBe("0.18.0");
    const live = await readFile(path.join(sourceRoot, "live.ts"), "utf8");
    const pages = path.resolve(sourceRoot, "../../../apps/desktop-ui/src");
    expect(live).toContain("autoSubscribe: false");
    expect(live).toContain("ble: false");
    expect(live).not.toMatch(/TemperatureMeasurement|RelativeHumidityMeasurement|OnOff|LevelControl/);
    const ui = await readFile(path.join(pages, "pages/NodePage.tsx"), "utf8");
    expect(ui).not.toMatch(/TemperatureMeasurement|RelativeHumidityMeasurement|actuator control/);
  });
});
