import { describe, expect, it } from "vitest";
import type { ManagedNode } from "@iotedu/contracts";
import { projectPresence } from "./presence.js";

const node = {
  id: "node-2",
  name: "ESP32-H2",
  simulated: false,
  matterNodeId: "2",
  vendorId: 65521,
  productId: 32768,
  softwareVersion: 4,
  softwareVersionString: "1.3.0",
  hardware: "ESP32-H2",
  reachable: true,
  connection: "reachable",
  presence: "online",
  lastCommunicationAt: "2026-10-22T13:43:29.729Z",
  lastSuccessfulCommunicationAt: "2026-10-22T13:43:29.729Z",
  fabricLabel: "IoT.Edu Management",
  commissionedFabricCount: 3,
  otherFabricCount: 2,
  partitionLayoutId: null,
  installedComponents: [],
  history: [],
  createdAt: "2026-10-22T13:00:00.000Z",
  updatedAt: "2026-10-22T13:43:29.729Z",
} satisfies ManagedNode;

const now = Date.parse("2026-10-23T00:00:00.000Z");

describe("projectPresence", () => {
  it("does not keep a stored session online before this process checks it", () => {
    const projected = projectPresence(node, {
      checking: false,
      checkedAt: null,
      now,
      freshnessMs: 60_000,
      processStartedAt: now,
    });
    expect(projected.presence).toBe("unknown");
    expect(projected.reachable).toBeNull();
    expect(projected.softwareVersionString).toBe("1.3.0");
    expect(projected.matterNodeId).toBe("2");
  });

  it("reports checking, then stale once the freshness window passes", () => {
    const checking = projectPresence(node, {
      checking: true,
      checkedAt: now,
      now,
      freshnessMs: 60_000,
      processStartedAt: now - 10_000,
    });
    expect(checking.presence).toBe("checking");
    const fresh = projectPresence(node, {
      checking: false,
      checkedAt: now - 1_000,
      now,
      freshnessMs: 60_000,
      processStartedAt: now - 10_000,
    });
    expect(fresh.presence).toBe("online");
    const stale = projectPresence(node, {
      checking: false,
      checkedAt: now - 61_000,
      now,
      freshnessMs: 60_000,
      processStartedAt: now - 120_000,
    });
    expect(stale.presence).toBe("stale");
    expect(stale.reachable).toBeNull();
    expect(stale.softwareVersion).toBe(4);
  });
});
