import type { ManagedNode, MatterManagementService } from "@iotedu/contracts";
import { projectPresence } from "@iotedu/matter-controller";

export interface ReachabilityReport {
  nodes: ManagedNode[];
  errors: Array<{ id: string; message: string }>;
  checkedAt: string;
  intervalMs: number;
  freshnessMs: number;
}

const MIN_INTERVAL_MS = 10_000;
const MAX_INTERVAL_MS = 120_000;
const DEFAULT_INTERVAL_MS = 30_000;

export function clampInterval(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(value)));
}

/**
 * One Matter read at a time. A stored node stays registered when the read fails.
 * The controller identity is the one already opened by the management service.
 */
export class ReachabilityMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<ReachabilityReport> | null = null;
  private tail: Promise<void> = Promise.resolve();
  private readonly checking = new Set<string>();
  private readonly checkedAt = new Map<string, number>();
  private readonly processStartedAt = Date.now();
  private stopped = false;
  intervalMs: number;

  constructor(
    private readonly nodes: { list(): Promise<ManagedNode[]> },
    private readonly matter: MatterManagementService,
    intervalMs = DEFAULT_INTERVAL_MS,
  ) {
    this.intervalMs = intervalMs === 0 ? 0 : clampInterval(intervalMs);
  }

  start(): void {
    if (this.timer || this.stopped || this.intervalMs === 0) return;
    void this.checkNow();
    this.timer = setInterval(() => {
      void this.checkNow();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  setIntervalMs(value: number): number {
    this.intervalMs = clampInterval(value);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        void this.checkNow();
      }, this.intervalMs);
      this.timer.unref?.();
    }
    return this.intervalMs;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.inflight) await this.inflight.catch(() => undefined);
  }

  freshnessMs(): number {
    return (this.intervalMs || 30_000) * 2;
  }

  present(node: ManagedNode): ManagedNode {
    return projectPresence(node, {
      checking: this.checking.has(node.id),
      checkedAt: this.checkedAt.get(node.id) ?? null,
      now: Date.now(),
      freshnessMs: this.freshnessMs(),
      processStartedAt: this.processStartedAt,
    });
  }

  async presentAll(): Promise<ManagedNode[]> {
    return (await this.nodes.list()).map((node) => this.present(node));
  }

  checkNow(): Promise<ReachabilityReport> {
    if (this.inflight) return this.inflight;
    const run = this.enqueue(() => this.run()).finally(() => {
      this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  refreshOne(id: string) {
    return this.enqueue(async () => {
      this.checking.add(id);
      try {
        const result = await this.matter.refreshNode(id);
        this.checking.delete(id);
        this.checkedAt.set(id, Date.now());
        return { ...result, node: this.present(result.node) };
      } finally {
        this.checking.delete(id);
      }
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async run(): Promise<ReachabilityReport> {
    const errors: Array<{ id: string; message: string }> = [];
    const nodes = await this.nodes.list();
    for (const node of nodes) {
      if (this.stopped) break;
      if (node.simulated || !node.matterNodeId) continue;
      this.checking.add(node.id);
      try {
        const result = await this.matter.refreshNode(node.id);
        if (result.liveRead === "failed") errors.push({ id: node.id, message: result.message });
      } catch (error) {
        errors.push({ id: node.id, message: error instanceof Error ? error.message : "Reachability check failed." });
      } finally {
        this.checkedAt.set(node.id, Date.now());
        this.checking.delete(node.id);
      }
    }
    return {
      nodes: await this.presentAll(),
      errors,
      checkedAt: new Date().toISOString(),
      intervalMs: this.intervalMs,
      freshnessMs: this.freshnessMs(),
    };
  }
}
