import { randomUUID } from "node:crypto";
import type { BoardProfile } from "@iotedu/firmware-builder";
import type { BuildJob } from "@iotedu/contracts";
import { CatalogueError, catalogueEnabled, cataloguePool } from "./catalogue-store.js";
import {
  COMPONENT_PRODUCT,
  driverNames,
  legalGpios,
  pinIsRemappable,
  type CatalogueComponent,
  type CompositionPlan,
  type CompositionRelease,
  type ReleaseComponent,
} from "./ota-composition.js";

const PLAN_SQL = `
CREATE TABLE IF NOT EXISTS ota_composition_plans (
  plan_id text PRIMARY KEY,
  node_id text NOT NULL,
  matter_node_id text,
  current_software_version integer,
  current_product_id integer,
  baseline_mode text NOT NULL,
  component_ids jsonb NOT NULL,
  gpio_allocation jsonb NOT NULL,
  endpoint_allocation jsonb NOT NULL,
  compatibility jsonb NOT NULL,
  action text NOT NULL,
  build_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

interface VersionRow {
  component_id: string;
  name: string;
  component_type: string;
  revision: number;
  validation_state: string;
  component_version_id: string;
}

export async function loadOtaCatalogue(jobs: BuildJob[], profile: BoardProfile): Promise<{
  catalogue: CatalogueComponent[];
  releases: CompositionRelease[];
  core: { versionId: string; revision: number; name: string } | null;
}> {
  if (!catalogueEnabled()) throw new CatalogueError("The Neon catalogue is not configured.", 503, "catalogue_unavailable");
  const versions = await cataloguePool().query<VersionRow>(`
    SELECT c.component_id, c.name, c.component_type, v.revision, v.validation_state, v.component_version_id
    FROM components c
    JOIN component_versions v ON v.component_id = c.component_id
  `);
  const gpio = await cataloguePool().query<{
    component_version_id: string;
    connection_name: string;
    peripheral_function: string;
    default_gpio: number | null;
    allowed_gpio_constraints: string;
  }>("SELECT component_version_id, connection_name, peripheral_function, default_gpio, allowed_gpio_constraints FROM gpio_requirements");
  const matter = await cataloguePool().query<{
    component_version_id: string;
    endpoint_types: string[] | null;
    clusters: string[] | null;
  }>("SELECT component_version_id, endpoint_types, clusters FROM matter_requirements");
  const dependencies = await cataloguePool().query<{
    component_version_id: string;
    dependency_component_id: string;
    dependency_type: string;
    dependency_version_constraint: string;
  }>("SELECT component_version_id, dependency_component_id, dependency_type, dependency_version_constraint FROM component_dependencies");
  const limits = {
    gpioMin: profile.gpioMin,
    gpioMax: profile.gpioMax,
    reservedGpio: profile.reservedGpio,
    adc1Channels: profile.adc1Channels ?? [],
  };
  const byVersion = new Map<string, VersionRow>();
  for (const row of versions.rows) byVersion.set(row.component_version_id, row);
  const latest = new Map<string, VersionRow>();
  for (const row of versions.rows) {
    const current = latest.get(row.component_id);
    if (!current || row.revision > current.revision) latest.set(row.component_id, row);
  }
  const catalogue: CatalogueComponent[] = [];
  for (const row of latest.values()) {
    if (row.component_type !== "sensor" && row.component_type !== "actuator") continue;
    if (row.validation_state !== "validated") continue;
    catalogue.push(toCatalogue(row, gpio.rows, matter.rows, dependencies.rows, limits));
  }
  catalogue.sort((left, right) => left.name.localeCompare(right.name));
  const coreRow = latest.get("matter-core-iotedu");
  const stored = await cataloguePool().query<{
    build_id: string;
    software_version: number;
    software_version_string: string;
    state: CompositionRelease["state"];
    vendor_id: number;
    product_id: number;
    recipe_fingerprint: string;
    application_sha256: string | null;
    ota_sha256: string | null;
    component_revisions: unknown;
  }>(`
    SELECT build_id, software_version, software_version_string, state, vendor_id, product_id,
           recipe_fingerprint, application_sha256, ota_sha256, component_revisions
    FROM firmware_releases
    ORDER BY software_version, created_at
  `);
  const releases = stored.rows.map((row) => toRelease(row, jobs, byVersion, matter.rows));
  return {
    catalogue,
    releases,
    core: coreRow && coreRow.validation_state === "validated"
      ? { versionId: coreRow.component_version_id, revision: coreRow.revision, name: coreRow.name }
      : null,
  };
}

export async function saveOtaCompositionPlan(input: {
  nodeId: string;
  matterNodeId: string | null;
  currentSoftwareVersion: number | null;
  currentProductId: number | null;
  plan: CompositionPlan;
}): Promise<{ planId: string }> {
  if (!catalogueEnabled()) throw new CatalogueError("The Neon catalogue is not configured.", 503, "catalogue_unavailable");
  await cataloguePool().query(PLAN_SQL);
  const planId = randomUUID();
  await cataloguePool().query(
    `INSERT INTO ota_composition_plans (
       plan_id, node_id, matter_node_id, current_software_version, current_product_id, baseline_mode,
       component_ids, gpio_allocation, endpoint_allocation, compatibility, action, build_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12)`,
    [
      planId,
      input.nodeId,
      input.matterNodeId,
      input.currentSoftwareVersion,
      input.currentProductId,
      input.plan.baselineMode,
      JSON.stringify(input.plan.proposed.components.map((item) => item.versionId)),
      JSON.stringify(input.plan.proposed.gpios),
      JSON.stringify({
        endpoints: input.plan.proposed.endpoints,
        migration: input.plan.endpointMigration,
        referenceProducts: input.plan.referenceProducts,
        targetProductId: input.plan.targetProductId,
      }),
      JSON.stringify({
        action: input.plan.action,
        migration: input.plan.migration,
        blockers: input.plan.blockers,
        checks: input.plan.checks,
        acknowledgementRequired: input.plan.acknowledgementRequired,
      }),
      input.plan.action,
      input.plan.otaBuildId,
    ],
  );
  return { planId };
}

function toCatalogue(
  row: VersionRow,
  gpio: { component_version_id: string; connection_name: string; peripheral_function: string; default_gpio: number | null; allowed_gpio_constraints: string }[],
  matter: { component_version_id: string; endpoint_types: string[] | null; clusters: string[] | null }[],
  dependencies: { component_version_id: string; dependency_component_id: string; dependency_type: string; dependency_version_constraint: string }[],
  limits: { gpioMin: number; gpioMax: number; reservedGpio: { gpio: number; reason: string }[]; adc1Channels: { channel: number; gpio: number }[] },
): CatalogueComponent {
  const matterRow = matter.find((item) => item.component_version_id === row.component_version_id);
  return {
    id: row.component_id,
    name: row.name,
    type: row.component_type,
    revision: row.revision,
    versionId: row.component_version_id,
    validationState: row.validation_state,
    productId: COMPONENT_PRODUCT[row.component_id] ?? null,
    pins: gpio.filter((item) => item.component_version_id === row.component_version_id).map((item) => {
      const remappable = pinIsRemappable(item.allowed_gpio_constraints, item.peripheral_function);
      return {
        name: item.connection_name,
        gpio: item.default_gpio,
        peripheral: item.peripheral_function,
        remappable,
        constraints: item.allowed_gpio_constraints,
        drivers: driverNames(item.peripheral_function),
        legalGpios: legalGpios({ peripheral: item.peripheral_function, remappable, gpio: item.default_gpio }, limits),
      };
    }),
    endpoints: matterRow?.endpoint_types ?? [],
    clusters: matterRow?.clusters ?? [],
    dependencies: dependencies.filter((item) => item.component_version_id === row.component_version_id).map((item) => ({
      id: item.dependency_component_id,
      type: item.dependency_type,
      constraint: item.dependency_version_constraint,
    })),
  };
}

function toRelease(
  row: {
    build_id: string;
    software_version: number;
    software_version_string: string;
    state: CompositionRelease["state"];
    vendor_id: number;
    product_id: number;
    recipe_fingerprint: string;
    application_sha256: string | null;
    ota_sha256: string | null;
    component_revisions: unknown;
  },
  jobs: BuildJob[],
  versions: Map<string, VersionRow>,
  matter: { component_version_id: string; endpoint_types: string[] | null; clusters: string[] | null }[],
): CompositionRelease {
  const job = jobs.find((item) => item.id === row.build_id);
  const ota = job?.artifacts.find((item) => item.name === "sensors.ota" && item.deployable && !item.simulated);
  return {
    buildId: row.build_id,
    softwareVersion: row.software_version,
    softwareVersionString: row.software_version_string,
    state: row.state,
    vendorId: row.vendor_id,
    productId: row.product_id,
    recipeFingerprint: row.recipe_fingerprint.trim(),
    applicationSha256: row.application_sha256?.trim() ?? null,
    hasOta: Boolean(ota),
    components: revisionComponents(row.component_revisions, versions, matter),
  };
}

function revisionComponents(
  value: unknown,
  versions: Map<string, VersionRow>,
  matter: { component_version_id: string; endpoint_types: string[] | null; clusters: string[] | null }[],
): ReleaseComponent[] {
  if (!Array.isArray(value)) return [];
  const components: ReleaseComponent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; revision?: unknown; versionId?: unknown; gpio?: unknown };
    if (typeof row.id !== "string") continue;
    const versionId = typeof row.versionId === "string"
      ? row.versionId
      : typeof row.revision === "number"
        ? `${row.id}-r${row.revision}`
        : row.id;
    const known = versions.get(versionId);
    const matterRow = matter.find((entry) => entry.component_version_id === versionId);
    components.push({
      id: row.id,
      name: known?.name ?? row.id,
      type: known?.component_type ?? "unknown",
      revision: known?.revision ?? (typeof row.revision === "number" ? row.revision : 0),
      versionId,
      productId: COMPONENT_PRODUCT[row.id] ?? null,
      pins: revisionPins(row.id, row.gpio),
      endpoints: matterRow?.endpoint_types ?? [],
      clusters: matterRow?.clusters ?? [],
    });
  }
  return components;
}

function revisionPins(componentId: string, gpio: unknown): { name: string; gpio: number }[] {
  if (Array.isArray(gpio)) {
    return gpio.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const pin = item as { name?: unknown; gpio?: unknown };
      return typeof pin.name === "string" && typeof pin.gpio === "number" ? [{ name: pin.name, gpio: pin.gpio }] : [];
    });
  }
  if (typeof gpio === "number") return [{ name: componentId === "custom-dht11" ? "data" : "gpio", gpio }];
  return [];
}
