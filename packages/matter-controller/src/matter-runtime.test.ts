import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { matterJsVersion, openMatterTransport } from "./live.js";

async function credentialDigest(directory: string): Promise<string> {
  const names = (await readdir(directory, { recursive: true })).map(String).filter((name) => !name.endsWith(".tmp") && !name.includes("trace")).sort();
  const files: string[] = [];
  for (const name of names) {
    if (!/rootKeyPair|rootKeyIdentifier|rootCertBytes/.test(name)) continue;
    const info = await stat(path.join(directory, name));
    if (info.isFile()) files.push(name);
  }
  expect(files.length).toBeGreaterThan(0);
  const hash = createHash("sha256");
  for (const name of files) {
    hash.update(name);
    hash.update(await readFile(path.join(directory, name)));
  }
  return hash.digest("hex");
}

describe("Matter.js controller identity", () => {
  const closers: Array<{ close(): Promise<void> }> = [];
  afterAll(async () => {
    await Promise.all(closers.splice(0).map((transport) => transport.close()));
  });

  it("reopens the same stored credentials", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "iotedu-matterjs-"));
    const first = await openMatterTransport(directory, { create: true });
    closers.push(first);
    const created = await first.ensureStarted({ create: true });
    expect(created.matterJsVersion).toBe("0.18.0");
    expect(matterJsVersion()).toBe("0.18.0");
    expect(created.credentialId).toBeTruthy();
    expect(created.controllerNodeId).toBeTruthy();
    const digest = await credentialDigest(directory);
    await first.close();

    const second = await openMatterTransport(directory, { create: false });
    closers.push(second);
    const restored = await second.ensureStarted({ create: false });
    expect(restored.credentialId).toBe(created.credentialId);
    expect(restored.controllerNodeId).toBe(created.controllerNodeId);
    expect(await credentialDigest(directory)).toBe(digest);
    const again = await openMatterTransport(directory, { create: true });
    const reread = await again.ensureStarted({ create: true });
    expect(reread.credentialId).toBe(restored.credentialId);
    expect(reread.controllerNodeId).toBe(restored.controllerNodeId);
    const status = await again.otaProviderStatus();
    expect(status.running).toBe(true);
    expect(status.ledgerOffline).toBe(true);
    expect(status.fabricScoped).toBe(true);
    expect(status.endpointNumber).not.toBe(0);
    await again.storeLocalImage(matterOtaImage(), 3);
    expect((await again.listStoredImages()).some((entry) => entry.softwareVersion === 3 && entry.vendorId === 0xfff1)).toBe(true);
    const bdx = await again.exerciseBdxArm();
    expect(bdx.armed).toBe(true);
    expect(bdx.cleared).toBe(true);
    expect(await credentialDigest(directory)).toBe(digest);
    await second.close();
  }, 120_000);
});

function matterOtaImage(): Uint8Array {
  const payload = Buffer.alloc(64);
  payload[0] = 0xe9;
  payload[12] = 16;
  const digest = createHash("sha256").update(payload).digest();
  const version = Buffer.from("1.2.0");
  const header = Buffer.concat([
    Buffer.from([0x15, 0x25, 0x00, 0xf1, 0xff, 0x25, 0x01, 0x00, 0x80]),
    Buffer.from([0x26, 0x02, 3, 0, 0, 0, 0x2c, 0x03, version.length]),
    version,
    Buffer.from([0x26, 0x04, payload.length, 0, 0, 0, 0x24, 0x08, 1, 0x30, 0x09, digest.length]),
    digest,
    Buffer.from([0x18]),
  ]);
  const file = Buffer.alloc(16 + header.length + payload.length);
  file.writeUInt32LE(0x1beef11e, 0);
  file.writeBigUInt64LE(BigInt(file.length), 4);
  file.writeUInt32LE(header.length, 12);
  header.copy(file, 16);
  payload.copy(file, 16 + header.length);
  return file;
}
