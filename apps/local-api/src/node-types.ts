import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BuildJob } from "@iotedu/contracts";
import {
  CatalogueError,
  catalogueEnabled,
  cataloguePool,
  listFirmwareReleases,
} from "./catalogue-store.js";
import { storageDecision } from "./catalogue-policy.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS node_types (
  node_type_id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  target text NOT NULL DEFAULT 'esp32h2',
  legacy_component_ids text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS node_type_components (
  node_type_id text NOT NULL REFERENCES node_types (node_type_id),
  component_version_id text NOT NULL REFERENCES component_versions (component_version_id),
  role text NOT NULL CHECK (role IN ('matter_core', 'device')),
  PRIMARY KEY (node_type_id, component_version_id)
);
`;

const SEEDS = [
  {
    id: "environmental-dht11",
    name: "Environmental Sensor — DHT11",
    category: "sensor",
    sort: 1,
    deviceId: "custom-dht11",
    legacy: ["iotedu-dht11"],
  },
  {
    id: "photosensitive-light",
    name: "Photosensitive Light Sensor",
    category: "sensor",
    sort: 2,
    deviceId: "custom-photosensitive-light",
    legacy: [],
  },
  {
    id: "rgb-led",
    name: "RGB LED Controller",
    category: "actuator",
    sort: 3,
    deviceId: "custom-rgb-led",
    legacy: [],
  },
] as const;

export interface NodeTypeGpio {
  name: string;
  gpio: number | null;
  description: string;
}

export interface NodeTypePackage {
  buildId: string;
  softwareVersion: number;
  softwareVersionString: string;
  buildStatus: string;
  releaseState: "published" | "release_candidate" | "compiled" | "legacy";
  legacy: boolean;
  hardware: string;
  pins: { name: string; gpio: number }[];
  hashVerified: boolean;
  imageSha256: string | null;
}

export interface NodeTypeView {
  id: string;
  name: string;
  description: string;
  category: string;
  target: string;
  status: "compiled" | "pending";
  statusLabel: string;
  pendingReason: string | null;
  matterCore: { id: string; name: string; revision: number; versionId: string; validationState: string };
  device: { id: string; name: string; revision: number; versionId: string; validationState: string };
  gpio: NodeTypeGpio[];
  endpoints: string[];
  packages: NodeTypePackage[];
}

export interface PackageCandidate {
  id: string;
  status: string;
  simulated: boolean;
  verification: string | null;
  hardware: string;
  baseFirmwareId: string | null;
  componentIds: string[];
  pins: { name: string; gpio: number }[];
  softwareVersion: number;
  softwareVersionString: string;
  hasApplicationImage: boolean;
  applicationSha256: string | null;
  hashMatches: boolean;
}

export interface MatchProfile {
  target: string;
  coreComponentId: string;
  deviceComponentId: string;
  gpioNumbers: number[];
  legacyComponentIds: string[];
}

export function matchNodeTypePackages(
  profile: MatchProfile,
  packages: PackageCandidate[],
  releases: Array<{ buildId: string; state: string }>,
): NodeTypePackage[] {
  const matched: NodeTypePackage[] = [];
  for (const item of packages) {
    const legacy = legacyPackage(profile, item);
    const catalogue = cataloguePackage(profile, item);
    if (!catalogue && !legacy) continue;
    if (!installableBinary(item)) continue;
    const recorded = releases.find((release) => release.buildId === item.id && (release.state === "published" || release.state === "release_candidate"));
    matched.push({
      buildId: item.id,
      softwareVersion: item.softwareVersion,
      softwareVersionString: item.softwareVersionString,
      buildStatus: item.status,
      releaseState: recorded?.state === "published" || recorded?.state === "release_candidate" ? recorded.state : legacy ? "legacy" : "compiled",
      legacy,
      hardware: item.hardware,
      pins: item.pins,
      hashVerified: item.hashMatches,
      imageSha256: item.applicationSha256,
    });
  }
  return matched.sort((left, right) => right.softwareVersion - left.softwareVersion || left.buildId.localeCompare(right.buildId));
}

export function nodeTypeReadiness(input: {
  deviceValidationState: string;
  packages: NodeTypePackage[];
}): { status: "compiled" | "pending"; statusLabel: string; pendingReason: string | null } {
  if (input.packages.some((item) => item.hashVerified)) {
    return { status: "compiled", statusLabel: "Compiled / Available", pendingReason: null };
  }
  if (input.deviceValidationState !== "validated") {
    return {
      status: "pending",
      statusLabel: "Pending firmware build",
      pendingReason: "Source validation is outstanding. No compiled package is available, and another Node Type's firmware is not substituted.",
    };
  }
  return {
    status: "pending",
    statusLabel: "Pending firmware build",
    pendingReason: "Matter integration compilation is outstanding. No compiled package is linked to this Node Type.",
  };
}

function installableBinary(item: PackageCandidate): boolean {
  return item.status === "succeeded"
    && !item.simulated
    && (item.verification === "compiled" || item.verification === "hardware_verified")
    && item.hasApplicationImage
    && item.hashMatches;
}

function gpioMatches(profile: MatchProfile, pins: { gpio: number }[]): boolean {
  return profile.gpioNumbers.every((gpio) => pins.some((pin) => pin.gpio === gpio));
}

function cataloguePackage(profile: MatchProfile, item: PackageCandidate): boolean {
  if (item.hardware !== profile.target) return false;
  if (!gpioMatches(profile, item.pins)) return false;
  const ids = new Set(item.componentIds);
  if (!ids.has(profile.deviceComponentId)) return false;
  if (item.baseFirmwareId !== profile.coreComponentId && !ids.has(profile.coreComponentId)) return false;
  for (const id of ids) {
    if (id !== profile.deviceComponentId && id !== profile.coreComponentId) return false;
  }
  return true;
}

function legacyPackage(profile: MatchProfile, item: PackageCandidate): boolean {
  if (profile.legacyComponentIds.length === 0) return false;
  if (item.hardware !== profile.target || !gpioMatches(profile, item.pins)) return false;
  if (item.componentIds.includes(profile.deviceComponentId)) return false;
  const allowed = new Set([...profile.legacyComponentIds, "iotedu-core", profile.coreComponentId]);
  return item.componentIds.some((id) => profile.legacyComponentIds.includes(id))
    && item.componentIds.every((id) => allowed.has(id));
}

let schemaReady = false;

async function ensureNodeTypes(): Promise<void> {
  if (!catalogueEnabled()) throw new CatalogueError("The Neon catalogue is not configured.", 503, "catalogue_unavailable");
  if (!schemaReady) {
    await cataloguePool().query(SCHEMA_SQL);
    schemaReady = true;
  }
  const current = await cataloguePool().query<{ bytes: string }>("SELECT pg_database_size(current_database())::text AS bytes");
  const decision = storageDecision(Number(current.rows[0]?.bytes ?? "NaN"), 4000);
  if (!decision.allow) throw new CatalogueError(decision.message, 507, "storage_budget");
  for (const seed of SEEDS) {
    const device = await cataloguePool().query<{ component_version_id: string; description: string; revision: number }>(
      `SELECT v.component_version_id, c.description, v.revision
       FROM components c
       JOIN component_versions v ON v.component_id = c.component_id
       WHERE c.component_id = $1
         AND v.validation_state <> 'incompatible'
       ORDER BY (v.validation_state = 'validated') DESC, v.revision DESC
       LIMIT 1`,
      [seed.deviceId],
    );
    const core = await cataloguePool().query<{ component_version_id: string }>(
      `SELECT component_version_id FROM component_versions
       WHERE component_id = 'matter-core-iotedu' AND revision = 2`,
    );
    const deviceRow = device.rows[0];
    const coreRow = core.rows[0];
    if (!deviceRow || !coreRow) continue;
    await cataloguePool().query(
      `INSERT INTO node_types (node_type_id, name, description, category, target, legacy_component_ids, sort_order)
       VALUES ($1, $2, $3, $4, 'esp32h2', $5, $6)
       ON CONFLICT (node_type_id) DO NOTHING`,
      [seed.id, seed.name, deviceRow.description, seed.category, seed.legacy, seed.sort],
    );
    await cataloguePool().query(
      `INSERT INTO node_type_components (node_type_id, component_version_id, role)
       VALUES ($1, $2, 'matter_core')
       ON CONFLICT DO NOTHING`,
      [seed.id, coreRow.component_version_id],
    );
    await cataloguePool().query(
      `INSERT INTO node_type_components (node_type_id, component_version_id, role)
       VALUES ($1, $2, 'device')
       ON CONFLICT DO NOTHING`,
      [seed.id, deviceRow.component_version_id],
    );
    await cataloguePool().query(
      `DELETE FROM node_type_components
       WHERE node_type_id = $1 AND role = 'device' AND component_version_id <> $2`,
      [seed.id, deviceRow.component_version_id],
    );
  }
}

export async function listNodeTypes(jobs: BuildJob[], dataDir: string): Promise<NodeTypeView[]> {
  await ensureNodeTypes();
  const releases = await listFirmwareReleases().catch((error: unknown) => {
    if (error instanceof CatalogueError) throw error;
    throw new CatalogueError("Firmware release records could not be read.", 503, "catalogue_unavailable");
  });
  const rows = await cataloguePool().query<{
    node_type_id: string;
    name: string;
    description: string;
    category: string;
    target: string;
    legacy_component_ids: string[];
    role: "matter_core" | "device";
    component_id: string;
    component_name: string;
    revision: number;
    component_version_id: string;
    validation_state: string;
  }>(`
    SELECT n.node_type_id, n.name, n.description, n.category, n.target, n.legacy_component_ids,
           l.role, c.component_id, c.name AS component_name, v.revision, v.component_version_id, v.validation_state
    FROM node_types n
    JOIN node_type_components l ON l.node_type_id = n.node_type_id
    JOIN component_versions v ON v.component_version_id = l.component_version_id
    JOIN components c ON c.component_id = v.component_id
    ORDER BY n.sort_order, n.name, l.role
  `);
  const gpio = await cataloguePool().query<{ component_version_id: string; connection_name: string; default_gpio: number | null; description: string }>(
    "SELECT component_version_id, connection_name, default_gpio, description FROM gpio_requirements",
  );
  const matter = await cataloguePool().query<{ component_version_id: string; endpoint_types: string[] }>(
    "SELECT component_version_id, endpoint_types FROM matter_requirements",
  );
  const grouped = new Map<string, typeof rows.rows>();
  for (const row of rows.rows) {
    const list = grouped.get(row.node_type_id) ?? [];
    list.push(row);
    grouped.set(row.node_type_id, list);
  }
  const candidates = await Promise.all(jobs.map((job) => candidateFromJob(job, dataDir)));
  const views: NodeTypeView[] = [];
  for (const group of grouped.values()) {
    const core = group.find((row) => row.role === "matter_core");
    const device = group.find((row) => row.role === "device");
    if (!core || !device) continue;
    const pins = gpio.rows.filter((row) => row.component_version_id === device.component_version_id);
    const endpoints = matter.rows.find((row) => row.component_version_id === device.component_version_id)?.endpoint_types ?? [];
    const packages = matchNodeTypePackages({
      target: core.target,
      coreComponentId: core.component_id,
      deviceComponentId: device.component_id,
      gpioNumbers: pins.map((pin) => pin.default_gpio).filter((gpio): gpio is number => gpio != null),
      legacyComponentIds: core.legacy_component_ids ?? [],
    }, candidates, releases.map((release) => ({ buildId: release.buildId, state: release.state })));
    const readiness = nodeTypeReadiness({ deviceValidationState: device.validation_state, packages });
    views.push({
      id: core.node_type_id,
      name: core.name,
      description: core.description,
      category: core.category,
      target: core.target,
      status: readiness.status,
      statusLabel: readiness.statusLabel,
      pendingReason: readiness.pendingReason,
      matterCore: {
        id: core.component_id,
        name: core.component_name,
        revision: core.revision,
        versionId: core.component_version_id,
        validationState: core.validation_state,
      },
      device: {
        id: device.component_id,
        name: device.component_name,
        revision: device.revision,
        versionId: device.component_version_id,
        validationState: device.validation_state,
      },
      gpio: pins.map((pin) => ({ name: pin.connection_name, gpio: pin.default_gpio, description: pin.description })),
      endpoints,
      packages,
    });
  }
  return views;
}

async function candidateFromJob(job: BuildJob, dataDir: string): Promise<PackageCandidate> {
  const image = job.artifacts.find((item) => item.name === "sensors.bin" && !item.simulated);
  let hashMatches = false;
  if (image && /^[a-f0-9]{64}$/.test(image.sha256)) {
    try {
      const bytes = await readFile(path.join(dataDir, image.relativePath));
      hashMatches = createHash("sha256").update(bytes).digest("hex") === image.sha256;
    } catch {
      hashMatches = false;
    }
  }
  return {
    id: job.id,
    status: job.status,
    simulated: job.simulated,
    verification: job.verification,
    hardware: job.request.hardware,
    baseFirmwareId: job.request.baseFirmwareId,
    componentIds: job.request.componentIds,
    pins: job.request.pins.map((pin) => ({ name: pin.pinName, gpio: pin.gpio })),
    softwareVersion: job.request.softwareVersion,
    softwareVersionString: job.request.softwareVersionString,
    hasApplicationImage: Boolean(image),
    applicationSha256: image?.sha256 ?? null,
    hashMatches,
  };
}

export function releaseLabel(state: NodeTypePackage["releaseState"]): string {
  if (state === "published") return "Published release";
  if (state === "release_candidate") return "Release candidate";
  if (state === "legacy") return "Previously compiled";
  return "Compiled";
}
