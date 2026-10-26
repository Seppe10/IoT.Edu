import type { ManagedNode } from "@iotedu/contracts";

export interface PresenceContext {
  checking: boolean;
  checkedAt: number | null;
  now: number;
  freshnessMs: number;
  processStartedAt: number;
}

/**
 * A stored CASE session or an older successful read is not current reachability.
 * Online is returned only after this process has a fresh successful check.
 */
export function projectPresence(node: ManagedNode, input: PresenceContext): ManagedNode {
  if (node.simulated) return node;
  if (!node.matterNodeId) return { ...node, presence: "unknown", reachable: null };
  if (input.checking) return { ...node, presence: "checking", reachable: null };
  const persisted = timestamp(node.lastReachabilityCheckAt);
  const checkedAt = input.checkedAt ?? (persisted != null && persisted >= input.processStartedAt ? persisted : null);
  if (checkedAt == null) {
    return { ...node, presence: "unknown", reachable: null, connection: "unknown" };
  }
  if (node.presence === "online" && input.now - checkedAt > input.freshnessMs) {
    return { ...node, presence: "stale", reachable: null, connection: "unknown" };
  }
  return node;
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
