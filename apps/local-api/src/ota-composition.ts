import { firmwareVersionString, nextSoftwareVersion, type ReleaseIdentity, type ReleaseState } from "@iotedu/firmware-builder/firmware-release";

export const MATTER_CORE_ID = "matter-core-iotedu";
export const IOT_EDU_VENDOR_ID = 0xfff1;

/** Product IDs already used by commissioned single-device images. A combination does not inherit one of these. */
export const COMPONENT_PRODUCT: Record<string, number> = {
  "custom-dht11": 0x8000,
  "custom-photosensitive-light": 0x8001,
  "custom-rgb-led": 0x8002,
};

export interface CataloguePin {
  name: string;
  gpio: number | null;
  peripheral: string;
  remappable: boolean;
  constraints: string;
  drivers: string[];
  legalGpios: number[];
}

export interface CatalogueComponent {
  id: string;
  name: string;
  type: string;
  revision: number;
  versionId: string;
  validationState: string;
  productId: number | null;
  pins: CataloguePin[];
  endpoints: string[];
  clusters: string[];
  dependencies: { id: string; type: string; constraint: string }[];
}

export interface ReleaseComponent {
  id: string;
  name: string;
  type: string;
  revision: number;
  versionId: string;
  productId: number | null;
  pins: { name: string; gpio: number }[];
  endpoints: string[];
  clusters: string[];
}

export interface CompositionRelease {
  buildId: string;
  softwareVersion: number;
  softwareVersionString: string;
  state: ReleaseState;
  vendorId: number;
  productId: number;
  recipeFingerprint: string;
  applicationSha256: string | null;
  hasOta: boolean;
  components: ReleaseComponent[];
}

export interface CompositionNodeIdentity {
  vendorId: number | null;
  productId: number | null;
  softwareVersion: number | null;
  softwareVersionString: string | null;
}

export interface GpioOverride {
  componentId: string;
  pinName: string;
  gpio: number;
}

export type FunctionMode = "keep" | "add" | "replace" | "remove";

export interface CompositionSelection {
  firmware: "keep" | string;
  componentIds: "keep" | string[];
  gpio: GpioOverride[];
  mode?: FunctionMode;
}

export interface ReferenceProduct {
  componentId: string;
  name: string;
  productId: number | null;
}

export interface EndpointMigrationSlot {
  id: number;
  componentId: string | null;
  role: string;
  disposition: "preserved" | "retired" | "added";
}

export interface PreparedComponent {
  id: string;
  versionId: string;
  pins: { name: string; gpio: number }[];
  reserveEndpointIds: number[];
}

export interface EndpointMigration {
  risk: "A" | "B" | "C";
  acknowledgementRequired: boolean;
  root: { id: 0; role: "root" };
  slots: EndpointMigrationSlot[];
  detail: string;
}

export interface FirmwareOption {
  id: "keep" | string;
  group: "current" | "newer" | "older" | "incompatible";
  softwareVersion: number | null;
  softwareVersionString: string | null;
  state: string | null;
  productId: number | null;
  compatible: boolean;
  detail: string;
}

export interface CompositionDeviceView {
  id: string;
  name: string;
  revision: number;
  versionId: string;
}

export interface CompositionGpioView {
  componentId: string;
  componentName: string;
  pinName: string;
  gpio: number | null;
}

export interface CompositionView {
  label: string;
  buildId: string | null;
  softwareVersion: number | null;
  softwareVersionString: string | null;
  productId: number | null;
  vendorId: number | null;
  components: CompositionDeviceView[];
  gpios: CompositionGpioView[];
  endpoints: string[];
}

export interface CompositionCheck {
  id: string;
  label: string;
  status: "passed" | "failed" | "warning";
  detail: string;
}

export interface CompositionPlan {
  provenance: "matched-release" | "unknown";
  provenanceDetail: string;
  current: CompositionView | null;
  proposed: CompositionView;
  baselineMode: "keep" | "newer" | "older" | "incompatible" | "unknown";
  changes: { added: string[]; removed: string[]; retained: string[]; gpio: string[] };
  migration: "unchanged" | "in-place" | "additive" | "functionality-replacement" | "identity-change";
  migrationDetail: string;
  functionMode: FunctionMode;
  referenceProducts: ReferenceProduct[];
  targetProductId: number | null;
  endpointMigration: EndpointMigration;
  acknowledgementRequired: boolean;
  action: "none" | "reuse" | "compile" | "blocked";
  summary: string;
  otaBuildId: string | null;
  otaSoftwareVersion: number | null;
  otaSoftwareVersionString: string | null;
  blockers: { code: string; message: string; remediation: string }[];
  warnings: string[];
  checks: CompositionCheck[];
  wiringChange: boolean;
  rollback: string;
  preservation: string;
  prepare: {
    kind: "standalone" | "retained";
    nodeType: "rgb-led" | "photosensitive-light" | "environmental-dht11" | null;
    gpio: number | null;
    targetVendorId: number;
    targetProductId: number;
    mode: Exclude<FunctionMode, "keep">;
    components: PreparedComponent[];
    retiredEndpointIds: number[];
    softwareVersion: number;
    softwareVersionString: string;
  } | null;
  alternatives: { componentId: string; componentName: string; pinName: string; gpios: number[] }[];
}

interface BoardLimits {
  gpioMin: number;
  gpioMax: number;
  reservedGpio: { gpio: number; reason: string }[];
  adc1Channels: { channel: number; gpio: number }[];
}

interface ResolvedDevice {
  id: string;
  name: string;
  type: string;
  revision: number;
  versionId: string;
  productId: number | null;
  endpoints: string[];
  clusters: string[];
  pins: { name: string; gpio: number | null; peripheral: string; remappable: boolean }[];
}

const ROLLBACK = "The installed bootloader was built without application rollback. A new application cannot turn that on. A failed boot is recovered by a later approved USB install, not by another OTA. No eFuse or flash-encryption setting is changed.";
const PRESERVATION = "This plan does not open a commissioning window, erase NVS, or rewrite Apple Home or IoT.Edu fabric credentials. After any future update, Apple Home still has to be checked on the iPhone. IoT.Edu CASE success alone does not prove the other fabric.";
const FUNCTIONALITY_WARNING = "This update changes the device's Matter functionality. Existing Matter fabrics are intended to remain, but Apple Home may need to refresh its accessory representation and may not automatically recognise the new device type.";
const ENDPOINT_ROLES: Record<string, string[]> = {
  "custom-rgb-led": ["extended_color_light"],
  "custom-photosensitive-light": ["light_sensor"],
  "custom-dht11": ["temperature_sensor", "humidity_sensor"],
};

export function pinIsRemappable(constraints: string, peripheral: string): boolean {
  if (/fixed/i.test(constraints)) return false;
  if (peripheral === "adc1") return false;
  return peripheral === "ledc" || peripheral === "gpio";
}

export function driverNames(peripheral: string): string[] {
  if (peripheral === "adc1") return ["esp_adc", "esp_matter"];
  if (peripheral === "ledc") return ["esp_driver_ledc", "esp_matter"];
  if (peripheral === "gpio") return ["esp_driver_gpio", "esp_matter"];
  return peripheral ? [peripheral, "esp_matter"] : ["esp_matter"];
}

export function legalGpios(pin: { peripheral: string; remappable: boolean; gpio: number | null }, limits: BoardLimits): number[] {
  if (!pin.remappable) return pin.gpio == null ? [] : [pin.gpio];
  const reserved = new Set(limits.reservedGpio.map((item) => item.gpio));
  if (pin.peripheral === "adc1") {
    return limits.adc1Channels.map((item) => item.gpio).filter((gpio) => !reserved.has(gpio));
  }
  const values: number[] = [];
  for (let gpio = limits.gpioMin; gpio <= limits.gpioMax; gpio += 1) {
    if (!reserved.has(gpio)) values.push(gpio);
  }
  return values;
}

export const ENDPOINT_DEVICE_TYPE: Record<string, number> = {
  extended_color_light: 0x010d,
  light_sensor: 0x0106,
  temperature_sensor: 0x0302,
  humidity_sensor: 0x0307,
};

/** Stable identity of the sensor and actuator functions in a release. The Matter core is not part of it. */
export function applicationProfile(components: { id: string; endpoints: string[] }[]): string {
  return components
    .filter((item) => item.id !== MATTER_CORE_ID && item.id !== "retired-endpoints")
    .map((item) => `${item.id}:${[...item.endpoints].sort().join("+")}`)
    .sort()
    .join("|");
}

export function deviceTypesFor(components: { id: string; endpoints: string[] }[]): number[] {
  const types = new Set<number>();
  for (const component of components) {
    if (component.id === MATTER_CORE_ID) continue;
    for (const endpoint of component.endpoints) {
      const deviceType = ENDPOINT_DEVICE_TYPE[endpoint];
      if (deviceType != null) types.add(deviceType);
    }
  }
  return [...types].sort((left, right) => left - right);
}

export function firmwareOnlyEligibility(input: {
  node: CompositionNodeIdentity;
  releases: CompositionRelease[];
  buildId: string;
}): { eligible: boolean; reason: string } {
  const current = matchCurrent(input.node, input.releases);
  const selected = input.releases.find((release) => release.buildId === input.buildId) ?? null;
  if (!current) {
    return { eligible: false, reason: "The running firmware has no single matching recipe, so an OTA package was not offered." };
  }
  if (!selected) {
    return { eligible: false, reason: "That package is not a recorded release for this device." };
  }
  if (selected.vendorId !== current.vendorId || selected.productId !== current.productId) {
    return { eligible: false, reason: `This package is product ${hex(selected.productId)}. The device is product ${hex(current.productId)}.` };
  }
  if (applicationProfile(selected.components) !== applicationProfile(current.components)) {
    return { eligible: false, reason: `${selected.softwareVersionString} changes the sensor or actuator function. It stays in the catalogue and is not a firmware-only update.` };
  }
  if (selected.softwareVersion <= current.softwareVersion) {
    return { eligible: false, reason: `${selected.softwareVersionString} is not a newer firmware for this device.` };
  }
  return { eligible: true, reason: `${selected.softwareVersionString} keeps the same vendor, product and device function.` };
}

export function firmwareOptions(node: CompositionNodeIdentity, releases: CompositionRelease[]): FirmwareOption[] {
  const current = matchCurrent(node, releases);
  const keep: FirmwareOption = {
    id: "keep",
    group: "current",
    softwareVersion: node.softwareVersion,
    softwareVersionString: node.softwareVersionString,
    state: current?.state ?? null,
    productId: node.productId,
    compatible: true,
    detail: current
      ? `The live SoftwareVersion matches release ${current.softwareVersionString}.`
      : "No single release record matches this live SoftwareVersion and product, so installed component revisions are not assumed.",
  };
  const rest = releases
    .filter((release) => release.state !== "draft" && release.state !== "build_failed")
    .filter((release) => release.buildId !== current?.buildId)
    .map((release) => optionFor(node, release, current))
    .filter((option) => option.group === "newer" || option.group === "older")
    .sort((left, right) => groupRank(left.group) - groupRank(right.group) || (right.softwareVersion ?? 0) - (left.softwareVersion ?? 0));
  return [keep, ...rest];
}

export function planOtaComposition(input: {
  node: CompositionNodeIdentity;
  core: { versionId: string; revision: number; name: string } | null;
  catalogue: CatalogueComponent[];
  releases: CompositionRelease[];
  selection: CompositionSelection;
  limits: BoardLimits;
  buildRunning: boolean;
}): CompositionPlan {
  const currentRelease = matchCurrent(input.node, input.releases);
  const provenance = currentRelease ? "matched-release" : "unknown";
  const provenanceDetail = currentRelease
    ? `SoftwareVersion ${currentRelease.softwareVersion} and product ${hex(currentRelease.productId)} match one release record, ${currentRelease.softwareVersionString}.`
    : "The running image has no single matching release record. Component revisions are not invented from the product id.";
  const selected = input.selection.firmware === "keep"
    ? null
    : input.releases.find((release) => release.buildId === input.selection.firmware) ?? null;
  const selectedGroup = input.selection.firmware === "keep"
    ? (currentRelease ? "keep" : "unknown")
    : selected
      ? optionFor(input.node, selected, currentRelease).group
      : "unknown";
  const baselineMode = selectedGroup === "current" ? "keep" : selectedGroup;
  const baseline = selected ?? currentRelease;
  const blockers: CompositionPlan["blockers"] = [];
  const warnings: string[] = [];

  if (input.selection.firmware !== "keep" && !selected) {
    blockers.push({
      code: "unknown_firmware",
      message: "That firmware release is not in the catalogue.",
      remediation: "Choose Keep current firmware or a release returned for this node.",
    });
  }
  if (input.node.vendorId != null && input.node.vendorId !== IOT_EDU_VENDOR_ID) {
    blockers.push({
      code: "vendor_mismatch",
      message: `The node reports vendor ${hex(input.node.vendorId)}. IoT.Edu images use ${hex(IOT_EDU_VENDOR_ID)}.`,
      remediation: "Do not offer an IoT.Edu image to a node with a different vendor id.",
    });
  }
  if (baselineMode === "incompatible" && selected) {
    const sameProduct = input.node.productId != null && selected.productId === input.node.productId && selected.vendorId === IOT_EDU_VENDOR_ID;
    const currentProfile = currentRelease ? applicationProfile(currentRelease.components) : null;
    const selectedProfile = applicationProfile(selected.components);
    if (sameProduct && currentProfile && currentProfile !== selectedProfile) {
      blockers.push({
        code: "function_mismatch",
        message: `${selected.softwareVersionString} keeps product ${hex(selected.productId)} but changes the sensor or actuator function.`,
        remediation: "OTA installs firmware for the function already on the device. Change a sensor or actuator from Setup or Firmware Builder.",
      });
    } else if (sameProduct && !currentRelease) {
      blockers.push({
        code: "function_unknown",
        message: "The running firmware recipe was not identified, so this package was not offered.",
        remediation: "Read the device again. A matching product id is not enough to choose an image.",
      });
    } else {
      blockers.push({
        code: "product_mismatch",
        message: `${selected.softwareVersionString} is product ${hex(selected.productId)}. This node is product ${input.node.productId == null ? "unknown" : hex(input.node.productId)}.`,
        remediation: "A different product is not delivered by editing an OTA header. Use a node commissioned as that product, or stop.",
      });
    }
  }

  const functionMode: FunctionMode = input.selection.componentIds === "keep" ? "keep" : input.selection.mode ?? "replace";
  const desired = resolveDesired({
    selection: input.selection,
    mode: functionMode,
    baseline,
    catalogue: input.catalogue,
    provenance,
    baselineMode,
    blockers,
  });
  const gpioIssues = gpioProblems(desired, input.limits);
  for (const issue of gpioIssues) blockers.push(issue);
  const alternatives = remapAlternatives(desired, input.limits);

  const currentDevices = currentRelease ? devicesFromRelease(currentRelease) : [];
  const custom = input.selection.componentIds !== "keep";
  const referenceProducts = desired.map((device) => ({ componentId: device.id, name: device.name, productId: device.productId }));
  const currentProduct = input.node.productId;
  const proposedProduct = custom && currentProduct != null ? currentProduct : singleProduct(desired);
  const sameRecipe = currentRelease != null && recipeKey(desired) === recipeKey(currentDevices) && desired.length > 0;
  const productSame = proposedProduct != null && currentProduct != null && proposedProduct === currentProduct;
  const endpointChange = endpointKey(desired) !== endpointKey(currentDevices);
  const endpointMigration = assignEndpoints(currentDevices, desired);

  if (!custom && desired.length > 0 && proposedProduct == null) {
    blockers.push({
      code: "no_product_policy",
      message: "This combination has no commissioned product id. Product 0x8002 stays the RGB controller, 0x8001 the light sensor, and 0x8000 the DHT11. They are not merged or swapped automatically.",
      remediation: "Keep a single device whose product matches the commissioned node, or stop. No factory reset is offered.",
    });
  } else if (!custom && proposedProduct != null && currentProduct != null && proposedProduct !== currentProduct) {
    blockers.push({
      code: "identity_change",
      message: `The proposed application would report product ${hex(proposedProduct)}. The commissioned node reports ${hex(currentProduct)}.`,
      remediation: "A prebuilt image for another product is not delivered by editing its OTA header. Compile a new image for the commissioned product, or stop. This page will not factory-reset the board.",
    });
  } else if (custom && currentProduct == null) {
    blockers.push({
      code: "identity_unknown",
      message: "The commissioned product id was not read, so the selected components cannot be hosted under it.",
      remediation: "Read the node again. A component reference product is not used in its place.",
    });
  }

  const integration = integrationSupport(desired, proposedProduct);
  const forward = productSame
    ? forwardPackages(input.releases, desired, input.node.softwareVersion, proposedProduct)
    : [];
  const selectedIsForward = selected != null
    && productSame
    && selected.productId === proposedProduct
    && selected.hasOta
    && input.node.softwareVersion != null
    && selected.softwareVersion > input.node.softwareVersion
    && recipeKey(devicesFromRelease(selected).filter((device) => device.id !== MATTER_CORE_ID)) === recipeKey(desired);

  let ota: CompositionRelease | null = null;
  let prepare: CompositionPlan["prepare"] = null;
  if (blockers.length === 0 && desired.length > 0 && productSame && proposedProduct != null) {
    if (sameRecipe && (input.selection.firmware === "keep" || (selected != null && selected.softwareVersion === currentRelease?.softwareVersion))) {
      ota = null;
    } else if (selected && baselineMode === "newer" && selectedIsForward) {
      ota = selected;
    } else if (baselineMode === "older" && sameRecipe && forward[0]) {
      ota = forward[0];
    } else if (forward[0] && forward[0].productId === proposedProduct && recipeKey(devicesFromRelease(forward[0]).filter((device) => device.id !== MATTER_CORE_ID)) === recipeKey(desired)) {
      ota = forward[0];
    } else if (integration.ok && input.core) {
      if (input.buildRunning) {
        blockers.push({
          code: "build_busy",
          message: "A firmware build is already running. A new SoftwareVersion was not assigned.",
          remediation: "Wait until the current compilation finishes, then validate this composition again.",
        });
      } else {
        const softwareVersion = nextSoftwareVersion(input.releases.map(releaseIdentity));
        prepare = {
          kind: integration.kind ?? "retained",
          nodeType: integration.nodeType,
          gpio: integration.nodeType === "environmental-dht11" ? desired[0]?.pins[0]?.gpio ?? null : null,
          targetVendorId: input.node.vendorId ?? IOT_EDU_VENDOR_ID,
          targetProductId: proposedProduct,
          mode: functionMode === "keep" ? "replace" : functionMode,
          components: endpointMigration.created.map((item) => ({
            id: item.device.id,
            versionId: item.device.versionId,
            pins: item.device.pins.flatMap((pin) => pin.gpio == null ? [] : [{ name: pin.name, gpio: pin.gpio }]),
            reserveEndpointIds: item.reserveBefore,
          })),
          retiredEndpointIds: endpointMigration.retired.map((slot) => slot.id),
          softwareVersion,
          softwareVersionString: firmwareVersionString(softwareVersion),
        };
      }
    }
  }
  if (!ota && !prepare && !integration.ok && desired.length > 0 && !sameRecipe) {
    blockers.push({
      code: "integration_unsupported",
      message: integration.reason,
      remediation: "Do not mark this combination installable. Independent firmware images are not concatenated, and the installed recipe is left unchanged.",
    });
  }

  const wiring = wiringChanges(currentDevices, desired);
  if (wiring.length > 0) {
    warnings.push("The GPIO assignment changes. Connected hardware follows the new wiring, so this update is not hands-free.");
  }
  if (endpointMigration.risk === "B" || endpointMigration.risk === "C") {
    warnings.push(FUNCTIONALITY_WARNING);
  }
  if (desired.some((device) => device.id === "custom-photosensitive-light") && !currentDevices.some((device) => device.id === "custom-photosensitive-light")) {
    warnings.push("The photosensitive sensor must be physically connected to GPIO 4. RGB hardware left on GPIO 4 can interfere with the ADC input. This OTA update does not change the wiring.");
  }
  if (endpointChange && productSame && desired.length > 0 && endpointMigration.risk === "A") {
    warnings.push("Endpoint types change. Apple Home and IoT.Edu may need to rediscover the data model. Fabrics are not deleted by that change, and existing pairing is not guaranteed to keep working.");
  }

  const added = desired.filter((device) => !currentDevices.some((item) => item.id === device.id)).map((device) => device.name);
  const removed = currentDevices.filter((device) => !desired.some((item) => item.id === device.id)).map((device) => device.name);
  const retained = desired.filter((device) => currentDevices.some((item) => item.id === device.id)).map((device) => device.name);
  const migration = migrationClass({
    sameRecipe,
    productSame,
    endpointChange,
    desired: desired.length,
    risk: endpointMigration.risk,
  });
  const action: CompositionPlan["action"] = blockers.length > 0
    ? "blocked"
    : ota
      ? "reuse"
      : prepare
        ? "compile"
        : "none";

  const summary = summaryFor({ action, ota, prepare, baselineMode, selected, sameRecipe });
  const currentView = currentRelease ? viewFrom(currentRelease, "Installed recipe", input.node.vendorId) : null;
  const proposed = proposedView({
    desired,
    productId: proposedProduct,
    vendorId: input.node.vendorId ?? IOT_EDU_VENDOR_ID,
    ota,
    prepare,
    baseline,
    action,
  });

  const checks: CompositionCheck[] = [
    {
      id: "recipe",
      label: "Source recipe",
      status: input.selection.firmware !== "keep" && !selected ? "failed" : provenance === "unknown" && input.selection.firmware === "keep" && input.selection.componentIds !== "keep" ? "failed" : "passed",
      detail: provenanceDetail,
    },
    {
      id: "gpio",
      label: "GPIO and peripheral compatibility",
      status: gpioIssues.length > 0 ? "failed" : "passed",
      detail: gpioIssues.length > 0 ? gpioIssues.map((issue) => issue.message).join(" ") : "The selected pins do not overlap, avoid GPIO 8 and GPIO 9, and match the peripheral each driver can use.",
    },
    {
      id: "endpoints",
      label: "Matter endpoint migration",
      status: migration === "identity-change" ? "failed" : endpointMigration.risk === "A" ? "passed" : "warning",
      detail: endpointMigration.detail,
    },
    {
      id: "product",
      label: "Product identity",
      status: blockers.some((item) => item.code === "product_mismatch" || item.code === "identity_change" || item.code === "no_product_policy" || item.code === "vendor_mismatch" || item.code === "identity_unknown") ? "failed" : productSame || action === "none" ? "passed" : "failed",
      detail: productDetail(proposedProduct, currentProduct, referenceProducts, custom),
    },
    {
      id: "version",
      label: "SoftwareVersion progression",
      status: action === "reuse" || action === "compile" || action === "none" ? "passed" : blockers.some((item) => item.code === "integration_unsupported") ? "failed" : "passed",
      detail: versionDetail({ action, ota, prepare, baselineMode }),
    },
    {
      id: "integration",
      label: "Firmware composition",
      status: blockers.some((item) => item.code === "integration_unsupported") ? "failed" : "passed",
      detail: integration.reason,
    },
    {
      id: "native_build",
      label: "Native build status",
      status: action === "blocked" ? "failed" : action === "compile" ? "warning" : "passed",
      detail: action === "compile"
        ? "The host can build this composition. Native ESP-IDF compilation has not been run, so the package is not installable yet."
        : action === "reuse"
          ? "A compiled package is recorded for this recipe. Compilation alone is not on-device validation."
          : action === "none"
            ? "No new native build is required."
            : "No native build is started while the composition is blocked.",
    },
    {
      id: "ota_image",
      label: "OTA image readiness",
      status: action === "reuse" ? "passed" : action === "compile" ? "warning" : action === "none" ? "passed" : "failed",
      detail: action === "reuse"
        ? "The recorded Matter OTA image can be selected for preflight. Nothing is announced by this check."
        : action === "compile"
          ? "Prepare firmware has to compile the image and its Matter OTA header before preflight can select it."
          : action === "none"
            ? "No OTA image is required."
            : "No OTA image is offered.",
    },
    {
      id: "requestor",
      label: "OTA Requestor retention",
      status: action === "blocked" && !integration.ok ? "failed" : "passed",
      detail: "The reference Matter configuration keeps the OTA Requestor on the root endpoint. Removing a sensor or actuator does not remove that service, Access Control, or the Thread stack.",
    },
    {
      id: "wiring",
      label: "Physical wiring",
      status: wiring.length > 0 || warnings.some((warning) => warning.includes("physically connected")) ? "warning" : "passed",
      detail: wiring.length > 0 ? wiring.join(" ") : "The proposed pins match the installed recipe. An OTA update does not move wires.",
    },
    {
      id: "rollback",
      label: "Rollback",
      status: "warning",
      detail: ROLLBACK,
    },
    {
      id: "fabrics",
      label: "NVS and fabric preservation",
      status: migration === "identity-change" ? "failed" : endpointMigration.risk === "A" ? "passed" : "warning",
      detail: `${PRESERVATION} The OTA image replaces an application slot. NVS, nvs_keys and the factory partition are not erased. Stale attribute keys for a retired endpoint can remain. Keeping the partitions is not proof that a controller still accepts the node.`,
    },
    {
      id: "apple_home",
      label: "Apple Home functionality",
      status: endpointMigration.risk === "A" && migration !== "identity-change" ? "passed" : "warning",
      detail: endpointMigration.risk === "A" && migration !== "identity-change"
        ? "The device type stays the same. Fabric preservation and accessory functionality are still separate checks after a future update."
        : "Fabric preservation does not mean Apple Home will show the new device type. It may keep the previous accessory until it is refreshed, and it may not recognise the replacement automatically.",
    },
  ];

  return {
    provenance,
    provenanceDetail,
    current: currentView,
    proposed,
    baselineMode,
    changes: { added, removed, retained, gpio: wiring },
    migration,
    migrationDetail: endpointMigration.risk === "C" ? endpointMigration.detail : migrationDetail(migration, endpointChange),
    functionMode,
    referenceProducts,
    targetProductId: proposedProduct,
    endpointMigration,
    acknowledgementRequired: endpointMigration.acknowledgementRequired && action !== "blocked",
    action,
    summary,
    otaBuildId: ota?.buildId ?? null,
    otaSoftwareVersion: ota?.softwareVersion ?? prepare?.softwareVersion ?? null,
    otaSoftwareVersionString: ota?.softwareVersionString ?? prepare?.softwareVersionString ?? null,
    blockers,
    warnings,
    checks,
    wiringChange: wiring.length > 0,
    rollback: ROLLBACK,
    preservation: PRESERVATION,
    prepare: action === "compile" ? prepare : null,
    alternatives,
  };
}

function resolveDesired(input: {
  selection: CompositionSelection;
  mode: FunctionMode;
  baseline: CompositionRelease | null;
  catalogue: CatalogueComponent[];
  provenance: "matched-release" | "unknown";
  baselineMode: CompositionPlan["baselineMode"];
  blockers: CompositionPlan["blockers"];
}): ResolvedDevice[] {
  if (input.selection.componentIds === "keep") {
    if (!input.baseline) {
      if (input.selection.firmware !== "keep") {
        input.blockers.push({
          code: "recipe_unknown",
          message: "The selected release has no stored component recipe.",
          remediation: "Choose a release whose component revisions were recorded, or keep the current firmware without component changes.",
        });
      }
      return [];
    }
    const devices = devicesFromRelease(input.baseline).filter((device) => device.id !== MATTER_CORE_ID);
    if (devices.some((device) => device.pins.length === 0)) {
      input.blockers.push({
        code: "recipe_incomplete",
        message: "The stored recipe does not include a GPIO assignment, so it cannot be rebuilt or compared pin by pin.",
        remediation: "Leave the installed image in place. Do not invent the missing pins.",
      });
    }
    return devices;
  }
  if (input.selection.firmware === "keep" && input.provenance === "unknown") {
    input.blockers.push({
      code: "recipe_unknown",
      message: "The installed firmware source recipe cannot be reconstructed, so its components cannot be edited in place.",
      remediation: "Select a verified firmware release as the baseline, or make no change.",
    });
    return [];
  }
  const baselineDevices = input.baseline
    ? devicesFromRelease(input.baseline).filter((device) => device.id !== MATTER_CORE_ID)
    : [];
  const selectedIds = [...new Set(input.selection.componentIds)];
  const selected = selectedIds.flatMap((id) => {
    const component = input.catalogue.find((item) => item.id === id);
    if (!component || (component.type !== "sensor" && component.type !== "actuator")) {
      input.blockers.push({
        code: "unknown_component",
        message: `Component ${id} is not a validated sensor or actuator in the catalogue.`,
        remediation: "Choose only components returned by the catalogue.",
      });
      return [];
    }
    if (component.validationState !== "validated") {
      input.blockers.push({
        code: "component_not_validated",
        message: `${component.name} revision ${component.revision} is ${component.validationState}.`,
        remediation: "Use a validated revision. An unvalidated driver is not compiled into an OTA image.",
      });
    }
    return [applyOverrides(component, input.selection.gpio, input.blockers)];
  });
  const devices = input.mode === "remove"
    ? baselineDevices
      .filter((device) => !selectedIds.includes(device.id))
      .map((device) => rehydrate(device, input.catalogue, input.selection.gpio, input.blockers))
    : input.mode === "add"
      ? [
          ...baselineDevices.map((device) => rehydrate(device, input.catalogue, input.selection.gpio, input.blockers)),
          ...selected.filter((device) => !baselineDevices.some((item) => item.id === device.id)),
        ]
      : selected;
  if (devices.length === 0) {
    input.blockers.push({
      code: "empty_composition",
      message: "A node needs at least one sensor or actuator. Removing every component does not leave a bootable Matter application.",
      remediation: "Keep the OTA Requestor and at least one validated function. The commissioned product id stays either way.",
    });
  }
  if (input.baselineMode === "unknown" && input.selection.firmware !== "keep") {
    input.blockers.push({
      code: "unknown_firmware",
      message: "The firmware baseline was not found.",
      remediation: "Reload the firmware list.",
    });
  }
  return devices;
}

function applyOverrides(component: CatalogueComponent, overrides: GpioOverride[], blockers: CompositionPlan["blockers"]): ResolvedDevice {
  const pins = component.pins.map((pin) => {
    const override = overrides.find((item) => item.componentId === component.id && item.pinName === pin.name);
    const gpio = override ? override.gpio : pin.gpio;
    if (override && !pin.remappable && override.gpio !== pin.gpio) {
      blockers.push({
        code: "gpio_fixed",
        message: `${component.name} ${pin.name} cannot move from GPIO ${pin.gpio ?? "unset"}. ${pin.constraints}`,
        remediation: "Leave this pin on its fixed GPIO, or choose a component that does not need it.",
      });
    }
    if (override && pin.remappable && !pin.legalGpios.includes(override.gpio)) {
      blockers.push({
        code: "gpio_unsupported",
        message: `${component.name} ${pin.name} cannot use GPIO ${override.gpio}. ${pin.constraints}`,
        remediation: "Choose a GPIO from the legal list. GPIO 8 and GPIO 9 stay reserved, and an ADC-only signal cannot move to a pin without that ADC channel.",
      });
    }
    return { name: pin.name, gpio, peripheral: pin.peripheral, remappable: pin.remappable };
  });
  return {
    id: component.id,
    name: component.name,
    type: component.type,
    revision: component.revision,
    versionId: component.versionId,
    productId: component.productId,
    endpoints: component.endpoints,
    clusters: component.clusters,
    pins,
  };
}

function rehydrate(device: ResolvedDevice, catalogue: CatalogueComponent[], overrides: GpioOverride[], blockers: CompositionPlan["blockers"]): ResolvedDevice {
  const component = catalogue.find((item) => item.versionId === device.versionId) ?? catalogue.find((item) => item.id === device.id);
  if (!component || component.versionId !== device.versionId) return device;
  return applyOverrides(component, overrides, blockers);
}

function devicesFromRelease(release: CompositionRelease): ResolvedDevice[] {
  return release.components.filter((component) => component.id !== MATTER_CORE_ID).map((component) => ({
    id: component.id,
    name: component.name,
    type: component.type,
    revision: component.revision,
    versionId: component.versionId,
    productId: component.productId,
    endpoints: component.endpoints,
    clusters: component.clusters,
    pins: component.pins.map((pin) => ({ name: pin.name, gpio: pin.gpio, peripheral: "", remappable: false })),
  }));
}

function gpioProblems(devices: ResolvedDevice[], limits: BoardLimits): CompositionPlan["blockers"] {
  const issues: CompositionPlan["blockers"] = [];
  const used = new Map<number, string>();
  for (const device of devices) {
    for (const pin of device.pins) {
      const label = `${device.name} ${pin.name}`;
      if (pin.gpio == null) {
        issues.push({ code: "gpio_missing", message: `${label} has no GPIO.`, remediation: "Assign a pin the driver can use." });
        continue;
      }
      if (pin.gpio < limits.gpioMin || pin.gpio > limits.gpioMax) {
        issues.push({
          code: "gpio_out_of_range",
          message: `${label} GPIO ${pin.gpio} is outside GPIO ${limits.gpioMin}–${limits.gpioMax}.`,
          remediation: "Choose a GPIO on the ESP32-H2.",
        });
        continue;
      }
      const reserved = limits.reservedGpio.find((item) => item.gpio === pin.gpio);
      if (reserved) {
        issues.push({
          code: "gpio_reserved",
          message: `${label} cannot use GPIO ${pin.gpio}: ${reserved.reason}.`,
          remediation: "Leave GPIO 8 and GPIO 9 unused.",
        });
      }
      if (pin.peripheral === "adc1" && !limits.adc1Channels.some((item) => item.gpio === pin.gpio)) {
        issues.push({
          code: "adc_unavailable",
          message: `${label} needs an ADC1 pin. GPIO ${pin.gpio} is not an ADC1 channel on this board profile.`,
          remediation: "Use the ADC channel the driver was built for.",
        });
      }
      const previous = used.get(pin.gpio);
      if (previous) {
        issues.push({
          code: "gpio_conflict",
          message: `GPIO ${pin.gpio} is required by both ${previous} and ${label}.`,
          remediation: "Move a remappable pin, or drop one of the components. A fixed pin is not silently reassigned.",
        });
      } else {
        used.set(pin.gpio, label);
      }
    }
  }
  return issues;
}

function remapAlternatives(devices: ResolvedDevice[], limits: BoardLimits): CompositionPlan["alternatives"] {
  const fixed = new Set(devices.flatMap((device) => device.pins.filter((pin) => !pin.remappable && pin.gpio != null).map((pin) => pin.gpio as number)));
  const reserved = new Set(limits.reservedGpio.map((item) => item.gpio));
  return devices.flatMap((device) => device.pins.filter((pin) => pin.remappable).map((pin) => {
    const taken = new Set(devices.flatMap((item) => item.pins.filter((other) => other !== pin && other.gpio != null).map((other) => other.gpio as number)));
    const gpios: number[] = [];
    for (let gpio = limits.gpioMin; gpio <= limits.gpioMax; gpio += 1) {
      if (reserved.has(gpio) || fixed.has(gpio) || taken.has(gpio)) continue;
      if (pin.peripheral === "adc1" && !limits.adc1Channels.some((item) => item.gpio === gpio)) continue;
      gpios.push(gpio);
    }
    return { componentId: device.id, componentName: device.name, pinName: pin.name, gpios };
  }));
}

function integrationSupport(devices: ResolvedDevice[], targetProductId: number | null): {
  ok: boolean;
  kind: "standalone" | "retained" | null;
  nodeType: "rgb-led" | "photosensitive-light" | "environmental-dht11" | null;
  reason: string;
} {
  if (devices.length === 0) return { ok: false, kind: null, nodeType: null, reason: "No device component was resolved." };
  const unsupported = devices.map(deviceHost).find((item) => !item.ok);
  if (unsupported) return { ok: false, kind: null, nodeType: null, reason: unsupported.reason };
  const standalone = standaloneNodeType(devices, targetProductId);
  if (standalone) {
    return {
      ok: true,
      kind: "standalone",
      nodeType: standalone,
      reason: standalone === "rgb-led"
        ? "RGB revision 3 compiles as one extended-colour-light application on GPIO 4, 10 and 5."
        : standalone === "photosensitive-light"
          ? "Photosensitive revision 2 compiles as its own light-sensor product on ADC channel 3, GPIO 4."
          : "DHT11 revision 2 compiles as one environmental-sensor application. The data pin can move to a non-reserved GPIO.",
    };
  }
  return {
    ok: true,
    kind: "retained",
    nodeType: null,
    reason: "The shared host compiles one app_main, one Matter root, one Thread stack and one OTA Requestor for the commissioned product. Component reference products stay in the catalogue and are not copied into the image.",
  };
}

function deviceHost(device: ResolvedDevice): { ok: boolean; reason: string } {
  const pins = Object.fromEntries(device.pins.map((pin) => [pin.name, pin.gpio]));
  if (device.versionId === "custom-rgb-led-r3" && device.pins.length === 3 && pins.red != null && pins.green != null && pins.blue != null) {
    return { ok: true, reason: "RGB revision 3." };
  }
  if (device.id === "custom-rgb-led") {
    return {
      ok: false,
      reason: device.versionId === "custom-rgb-led-r3"
        ? "RGB revision 3 needs a red, green and blue output."
        : `The composer integrates RGB revision 3. ${device.versionId} is kept as a historical recipe and is not rebuilt by changing its OTA header.`,
    };
  }
  if (device.versionId === "custom-photosensitive-light-r2" && pins.adc === 4 && device.pins.length === 1) {
    return { ok: true, reason: "Photosensitive revision 2 on ADC channel 3, GPIO 4." };
  }
  if (device.id === "custom-photosensitive-light") {
    return { ok: false, reason: "Photosensitive revision 2 reads ADC channel 3, which is GPIO 4. The driver does not move to another pin." };
  }
  if (device.versionId === "custom-dht11-r2" && device.pins.length === 1 && device.pins[0]?.gpio != null) {
    return { ok: true, reason: "DHT11 revision 2." };
  }
  if (device.id === "custom-dht11") {
    return { ok: false, reason: "Only DHT11 revision 2 is integrated by the current composer." };
  }
  return { ok: false, reason: `${device.name} has no firmware host in the composer. It stays in the catalogue and is not marked installable.` };
}

function standaloneNodeType(devices: ResolvedDevice[], targetProductId: number | null): "rgb-led" | "photosensitive-light" | "environmental-dht11" | null {
  if (devices.length !== 1 || targetProductId == null) return null;
  const device = devices[0];
  if (!device || device.productId !== targetProductId) return null;
  const pins = Object.fromEntries(device.pins.map((pin) => [pin.name, pin.gpio]));
  if (device.versionId === "custom-rgb-led-r3" && pins.red === 4 && pins.green === 10 && pins.blue === 5) return "rgb-led";
  if (device.versionId === "custom-photosensitive-light-r2" && pins.adc === 4) return "photosensitive-light";
  if (device.versionId === "custom-dht11-r2") return "environmental-dht11";
  return null;
}

function forwardPackages(releases: CompositionRelease[], desired: ResolvedDevice[], liveVersion: number | null, productId: number | null): CompositionRelease[] {
  const key = recipeKey(desired);
  return releases
    .filter((release) => release.hasOta)
    .filter((release) => release.state === "release_candidate" || release.state === "published")
    .filter((release) => productId != null && release.productId === productId)
    .filter((release) => liveVersion == null || release.softwareVersion > liveVersion)
    .filter((release) => recipeKey(devicesFromRelease(release)) === key)
    .sort((left, right) => right.softwareVersion - left.softwareVersion);
}

function wiringChanges(current: ResolvedDevice[], desired: ResolvedDevice[]): string[] {
  const notes: string[] = [];
  for (const device of desired) {
    const previous = current.find((item) => item.id === device.id);
    if (!previous) {
      notes.push(`${device.name} is new and needs its wiring: ${device.pins.map((pin) => `${pin.name} GPIO ${pin.gpio ?? "unset"}`).join(", ")}.`);
      continue;
    }
    for (const pin of device.pins) {
      const old = previous.pins.find((item) => item.name === pin.name);
      if (old && old.gpio !== pin.gpio) notes.push(`${device.name} ${pin.name} moves from GPIO ${old.gpio} to GPIO ${pin.gpio}.`);
    }
  }
  for (const device of current) {
    if (!desired.some((item) => item.id === device.id)) notes.push(`${device.name} would no longer be driven.`);
  }
  return notes;
}

function rolesFor(device: ResolvedDevice): string[] {
  return ENDPOINT_ROLES[device.id] ?? (device.endpoints.length > 0 ? [...device.endpoints] : ["application"]);
}

function assignEndpoints(current: ResolvedDevice[], desired: ResolvedDevice[]): EndpointMigration & {
  created: { device: ResolvedDevice; ids: number[]; roles: string[]; reserveBefore: number[] }[];
  retired: EndpointMigrationSlot[];
} {
  let next = 1;
  const currentIds = new Map<string, { ids: number[]; roles: string[] }>();
  for (const device of current) {
    const roles = rolesFor(device);
    currentIds.set(device.id, { ids: roles.map(() => next++), roles });
  }
  const retired: EndpointMigrationSlot[] = [];
  for (const device of current) {
    if (desired.some((item) => item.id === device.id)) continue;
    const previous = currentIds.get(device.id);
    previous?.ids.forEach((id, index) => {
      retired.push({ id, componentId: device.id, role: previous.roles[index] ?? "endpoint", disposition: "retired" });
    });
  }
  const retiredIds = new Set(retired.map((slot) => slot.id));
  const used = new Set<number>();
  const preserved: { device: ResolvedDevice; ids: number[]; roles: string[]; reserveBefore: number[] }[] = [];
  const added: { device: ResolvedDevice; ids: number[]; roles: string[]; reserveBefore: number[] }[] = [];
  for (const device of desired) {
    const previous = currentIds.get(device.id);
    const roles = rolesFor(device);
    const sameShape = previous != null && previous.roles.length === roles.length && previous.roles.every((role, index) => role === roles[index]);
    if (previous && sameShape) {
      previous.ids.forEach((id) => used.add(id));
      preserved.push({ device, ids: [...previous.ids], roles, reserveBefore: [] });
    } else {
      added.push({ device, ids: [], roles, reserveBefore: [] });
    }
  }
  let cursor = 1;
  const take = () => {
    while (used.has(cursor) || retiredIds.has(cursor)) cursor += 1;
    const id = cursor;
    used.add(id);
    cursor += 1;
    return id;
  };
  for (const item of added) item.ids = item.roles.map(() => take());
  const created = [...preserved, ...added].sort((left, right) => (left.ids[0] ?? 0) - (right.ids[0] ?? 0));
  let walk = 1;
  for (const item of created) {
    const first = item.ids[0] ?? walk;
    while (walk < first) {
      item.reserveBefore.push(walk);
      walk += 1;
    }
    walk = (item.ids.at(-1) ?? walk) + 1;
  }
  const risk: EndpointMigration["risk"] = retired.length > 0 ? "C" : added.length > 0 ? "B" : "A";
  const addedText = added.flatMap((item) => item.ids.map((id, index) => `${id} (${item.roles[index]})`)).join(", ");
  const retiredText = retired.map((slot) => `${slot.id} (${slot.role})`).join(", ");
  const preservedText = preserved.flatMap((item) => item.ids.map((id, index) => `${id} (${item.roles[index]})`)).join(", ");
  const detail = risk === "C"
    ? `Endpoint 0 stays the root, with Basic Information, Descriptor, Access Control and the OTA Requestor. Retired ${retiredText} is not given a new device type. ${addedText ? `New functionality uses ${addedText}.` : "No replacement endpoint is created."} ${preservedText ? `Unchanged functionality stays on ${preservedText}.` : ""} This is not a low-risk or seamless update.`
    : risk === "B"
      ? `Endpoint 0 stays the root. ${preservedText ? `Unchanged functionality stays on ${preservedText}.` : ""} New endpoints: ${addedText}.`
      : "Endpoint 0 stays the root. Functional endpoint ids and device types are unchanged.";
  const slots: EndpointMigrationSlot[] = [
    ...retired,
    ...preserved.flatMap((item) => item.ids.map((id, index) => ({ id, componentId: item.device.id, role: item.roles[index] ?? "endpoint", disposition: "preserved" as const }))),
    ...added.flatMap((item) => item.ids.map((id, index) => ({ id, componentId: item.device.id, role: item.roles[index] ?? "endpoint", disposition: "added" as const }))),
  ].sort((left, right) => left.id - right.id);
  return {
    risk,
    acknowledgementRequired: risk === "C",
    root: { id: 0, role: "root" },
    slots,
    detail,
    created,
    retired,
  };
}

function migrationClass(input: { sameRecipe: boolean; productSame: boolean; endpointChange: boolean; desired: number; risk: "A" | "B" | "C" }): CompositionPlan["migration"] {
  if (input.desired === 0) return "unchanged";
  if (!input.productSame) return "identity-change";
  if (input.risk === "C") return "functionality-replacement";
  if (input.risk === "B") return "additive";
  if (input.sameRecipe) return "unchanged";
  return "in-place";
}

function migrationDetail(migration: CompositionPlan["migration"], endpointChange: boolean): string {
  if (migration === "identity-change") return "A prebuilt image would change the product identity. That image is not sent. Endpoint IDs from the old device type are not reused for a different device type.";
  if (migration === "functionality-replacement") return "Installed functionality is removed or replaced. The product id stays. This is not a low-risk or seamless update.";
  if (migration === "additive") return "A new endpoint is added and existing endpoint ids stay. Controllers may have to rediscover the added function.";
  if (endpointChange) return "Endpoint types differ.";
  return "Endpoint types and the product id stay the same. The same host keeps its creation order.";
}

function productDetail(proposed: number | null, current: number | null, references: ReferenceProduct[], custom: boolean): string {
  if (proposed == null) return "No product id is assigned to this combination.";
  const commissioned = `Target product ${hex(proposed)}. Commissioned product ${current == null ? "unknown" : hex(current)}.`;
  const different = references.filter((item) => item.productId != null && item.productId !== proposed);
  if (!custom || different.length === 0) return commissioned;
  const listed = different.map((item) => `${item.name} standalone reference ${hex(item.productId ?? 0)}`).join("; ");
  return `${commissioned} ${listed} is not copied into the image.`;
}

function summaryFor(input: {
  action: CompositionPlan["action"];
  ota: CompositionRelease | null;
  prepare: CompositionPlan["prepare"];
  baselineMode: CompositionPlan["baselineMode"];
  selected: CompositionRelease | null;
  sameRecipe: boolean;
}): string {
  if (input.action === "none") return "No changes selected — OTA update is not required.";
  if (input.action === "reuse" && input.ota) {
    if (input.baselineMode === "older") {
      return `${input.selected?.softwareVersionString ?? "The older release"} uses this component recipe, but its lower SoftwareVersion is not served. The forward package is ${input.ota.softwareVersionString} / SoftwareVersion ${input.ota.softwareVersion}. The historical image is left unchanged.`;
    }
    return `Reuse ${input.ota.softwareVersionString} / SoftwareVersion ${input.ota.softwareVersion}. The compiled OTA image is already validated for this recipe. Nothing is announced until Start OTA Update.`;
  }
  if (input.action === "compile" && input.prepare) {
    const identity = input.prepare.kind === "retained" ? ` It keeps product ${hex(input.prepare.targetProductId)}.` : "";
    return `A new complete application is required.${identity} The next unused SoftwareVersion would be ${input.prepare.softwareVersion} (${input.prepare.softwareVersionString}). Prepare firmware allocates it and compiles. Choosing it here does not compile or announce an update.`;
  }
  if (input.sameRecipe) return "The component recipe matches the installed image, but the update cannot be offered.";
  return "OTA is blocked. No image is announced and no compilation starts.";
}

function versionDetail(input: {
  action: CompositionPlan["action"];
  ota: CompositionRelease | null;
  prepare: CompositionPlan["prepare"];
  baselineMode: CompositionPlan["baselineMode"];
}): string {
  if (input.action === "none") return "The installed SoftwareVersion stays. A lower or equal image is not offered.";
  if (input.action === "reuse" && input.ota) {
    return input.baselineMode === "older"
      ? `The historical image keeps its original SoftwareVersion and is not rewritten. The offered image is SoftwareVersion ${input.ota.softwareVersion}.`
      : `The offered image is SoftwareVersion ${input.ota.softwareVersion}, which is newer than the installed version.`;
  }
  if (input.action === "compile" && input.prepare) return `Compilation would assign SoftwareVersion ${input.prepare.softwareVersion}. It has not been assigned.`;
  return "No SoftwareVersion is assigned while the composition is blocked.";
}

function proposedView(input: {
  desired: ResolvedDevice[];
  productId: number | null;
  vendorId: number;
  ota: CompositionRelease | null;
  prepare: CompositionPlan["prepare"];
  baseline: CompositionRelease | null;
  action: CompositionPlan["action"];
}): CompositionView {
  const version = input.ota
    ? { softwareVersion: input.ota.softwareVersion, softwareVersionString: input.ota.softwareVersionString, buildId: input.ota.buildId }
    : input.action === "compile" && input.prepare
      ? { softwareVersion: input.prepare.softwareVersion, softwareVersionString: input.prepare.softwareVersionString, buildId: null }
      : { softwareVersion: input.baseline?.softwareVersion ?? null, softwareVersionString: input.baseline?.softwareVersionString ?? null, buildId: input.baseline?.buildId ?? null };
  return {
    label: input.action === "compile" ? "Proposed release, not compiled" : "Proposed configuration",
    buildId: version.buildId,
    softwareVersion: version.softwareVersion,
    softwareVersionString: version.softwareVersionString,
    productId: input.productId,
    vendorId: input.vendorId,
    components: input.desired.map((device) => ({ id: device.id, name: device.name, revision: device.revision, versionId: device.versionId })),
    gpios: input.desired.flatMap((device) => device.pins.map((pin) => ({
      componentId: device.id,
      componentName: device.name,
      pinName: pin.name,
      gpio: pin.gpio,
    }))),
    endpoints: [...new Set(input.desired.flatMap((device) => device.endpoints))].sort(),
  };
}

function viewFrom(release: CompositionRelease, label: string, vendorId: number | null): CompositionView {
  const devices = devicesFromRelease(release);
  return {
    label,
    buildId: release.buildId,
    softwareVersion: release.softwareVersion,
    softwareVersionString: release.softwareVersionString,
    productId: release.productId,
    vendorId,
    components: devices.map((device) => ({ id: device.id, name: device.name, revision: device.revision, versionId: device.versionId })),
    gpios: devices.flatMap((device) => device.pins.map((pin) => ({
      componentId: device.id,
      componentName: device.name,
      pinName: pin.name,
      gpio: pin.gpio,
    }))),
    endpoints: [...new Set(devices.flatMap((device) => device.endpoints))].sort(),
  };
}

function matchCurrent(node: CompositionNodeIdentity, releases: CompositionRelease[]): CompositionRelease | null {
  if (node.softwareVersion == null || node.productId == null || node.vendorId !== IOT_EDU_VENDOR_ID) return null;
  const found = releases.filter((release) => release.vendorId === IOT_EDU_VENDOR_ID
    && release.productId === node.productId
    && release.softwareVersion === node.softwareVersion
    && (release.state === "release_candidate" || release.state === "published"));
  return found.length === 1 ? found[0] ?? null : null;
}

function optionFor(node: CompositionNodeIdentity, release: CompositionRelease, current: CompositionRelease | null): FirmwareOption {
  const sameProduct = node.productId != null && node.vendorId === IOT_EDU_VENDOR_ID && release.productId === node.productId && release.vendorId === IOT_EDU_VENDOR_ID;
  const sameFunction = current != null && applicationProfile(release.components) === applicationProfile(current.components);
  const group: FirmwareOption["group"] = !sameProduct || !sameFunction || node.softwareVersion == null
    ? "incompatible"
    : release.softwareVersion > node.softwareVersion
      ? "newer"
      : release.softwareVersion < node.softwareVersion
        ? "older"
        : "current";
  const recipe = release.components.filter((component) => component.id !== MATTER_CORE_ID).map((component) => `${component.name} r${component.revision}`).join(", ") || "recipe not recorded";
  return {
    id: release.buildId,
    group,
    softwareVersion: release.softwareVersion,
    softwareVersionString: release.softwareVersionString,
    state: release.state,
    productId: release.productId,
    compatible: group === "newer",
    detail: group === "incompatible"
      ? sameProduct
        ? `${release.softwareVersionString} changes the device function. ${recipe}.`
        : `Product ${hex(release.productId)} does not match this node. ${recipe}.`
      : group === "older"
        ? `Historical recipe only. ${recipe}. The original image is not served as a downgrade.`
        : recipe,
  };
}

function groupRank(group: FirmwareOption["group"]): number {
  if (group === "newer") return 0;
  if (group === "older") return 1;
  return 2;
}

function singleProduct(devices: ResolvedDevice[]): number | null {
  if (devices.length !== 1) return null;
  return devices[0]?.productId ?? null;
}

function recipeKey(devices: ResolvedDevice[]): string {
  return devices
    .map((device) => `${device.versionId}|${device.pins.map((pin) => `${pin.name}=${pin.gpio ?? ""}`).sort().join(",")}`)
    .sort()
    .join(";");
}

function endpointKey(devices: ResolvedDevice[]): string {
  return devices.flatMap((device) => device.endpoints).sort().join("|");
}

function releaseIdentity(release: CompositionRelease): ReleaseIdentity {
  return {
    state: release.state,
    softwareVersion: release.softwareVersion,
    softwareVersionString: release.softwareVersionString,
    recipeFingerprint: release.recipeFingerprint,
    buildId: release.buildId,
    applicationSha256: release.applicationSha256,
  };
}

function hex(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`;
}
