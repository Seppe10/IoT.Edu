import { recipeFingerprint } from "@iotedu/firmware-builder/firmware-release";
import { describe, expect, it } from "vitest";
import {
  COMPONENT_PRODUCT,
  driverNames,
  firmwareOptions,
  legalGpios,
  pinIsRemappable,
  planOtaComposition,
  type CatalogueComponent,
  type CompositionNodeIdentity,
  type CompositionRelease,
  type CompositionSelection,
} from "./ota-composition.js";

const limits = {
  gpioMin: 0,
  gpioMax: 27,
  reservedGpio: [
    { gpio: 8, reason: "ESP32-H2 strapping pin" },
    { gpio: 9, reason: "BOOT / factory-reset button" },
  ],
  adc1Channels: [
    { channel: 0, gpio: 1 },
    { channel: 1, gpio: 2 },
    { channel: 2, gpio: 3 },
    { channel: 3, gpio: 4 },
    { channel: 4, gpio: 5 },
  ],
};

const core = { versionId: "matter-core-iotedu-r2", revision: 2, name: "IoT.Edu Matter-over-Thread core" };

function pin(name: string, gpio: number, peripheral: string, constraints: string): CatalogueComponent["pins"][number] {
  const remappable = pinIsRemappable(constraints, peripheral);
  return {
    name,
    gpio,
    peripheral,
    remappable,
    constraints,
    drivers: driverNames(peripheral),
    legalGpios: legalGpios({ peripheral, remappable, gpio }, limits),
  };
}

const catalogue: CatalogueComponent[] = [
  {
    id: "custom-dht11",
    name: "DHT11 Temperature and Humidity",
    type: "sensor",
    revision: 2,
    versionId: "custom-dht11-r2",
    validationState: "validated",
    productId: COMPONENT_PRODUCT["custom-dht11"] ?? null,
    pins: [pin("data", 4, "gpio", "Default GPIO 4. dht11_init_pin accepts GPIO 0-27 except GPIO 8 and GPIO 9.")],
    endpoints: ["humidity_sensor", "temperature_sensor"],
    clusters: [],
    dependencies: [{ id: "matter-core-iotedu", type: "matter_core", constraint: "revision 2" }],
  },
  {
    id: "custom-photosensitive-light",
    name: "Photosensitive Light Sensor",
    type: "sensor",
    revision: 2,
    versionId: "custom-photosensitive-light-r2",
    validationState: "validated",
    productId: COMPONENT_PRODUCT["custom-photosensitive-light"] ?? null,
    pins: [pin("adc", 4, "adc1", "Fixed. ADC_CHANNEL_3 maps to GPIO 4 on ESP32-H2.")],
    endpoints: ["light_sensor"],
    clusters: ["IlluminanceMeasurement"],
    dependencies: [{ id: "matter-core-iotedu", type: "matter_core", constraint: "revision 2" }],
  },
  {
    id: "custom-rgb-led",
    name: "RGB LED Controller",
    type: "actuator",
    revision: 3,
    versionId: "custom-rgb-led-r3",
    validationState: "validated",
    productId: COMPONENT_PRODUCT["custom-rgb-led"] ?? null,
    pins: [
      pin("red", 4, "ledc", "GPIO 4. GPIO 8 and GPIO 9 stay reserved."),
      pin("green", 10, "ledc", "GPIO 10. GPIO 8 and GPIO 9 stay reserved."),
      pin("blue", 5, "ledc", "GPIO 5. GPIO 8 and GPIO 9 stay reserved."),
    ],
    endpoints: ["extended_color_light"],
    clusters: ["OnOff", "LevelControl", "ColorControl"],
    dependencies: [{ id: "matter-core-iotedu", type: "matter_core", constraint: "revision 2" }],
  },
];

function device(id: string, versionId: string, revision: number, pins: { name: string; gpio: number }[], endpoints: string[]): CompositionRelease["components"][number] {
  const component = catalogue.find((item) => item.id === id);
  return {
    id,
    name: component?.name ?? id,
    type: component?.type ?? "actuator",
    revision,
    versionId,
    productId: COMPONENT_PRODUCT[id] ?? null,
    pins,
    endpoints,
    clusters: component?.clusters ?? [],
  };
}

const rgbPins = [{ name: "red", gpio: 4 }, { name: "green", gpio: 10 }, { name: "blue", gpio: 5 }];
const rgbR3 = device("custom-rgb-led", "custom-rgb-led-r3", 3, rgbPins, ["extended_color_light"]);
const rgbR2 = device("custom-rgb-led", "custom-rgb-led-r2", 2, rgbPins, ["extended_color_light"]);

function release(partial: Partial<CompositionRelease> & Pick<CompositionRelease, "buildId" | "softwareVersion" | "softwareVersionString" | "productId" | "components">): CompositionRelease {
  return {
    state: "release_candidate",
    vendorId: 0xfff1,
    recipeFingerprint: "abc",
    applicationSha256: "a".repeat(64),
    hasOta: true,
    ...partial,
  };
}

const releases: CompositionRelease[] = [
  release({ buildId: "dht-5", softwareVersion: 5, softwareVersionString: "1.4.0", productId: 0x8000, components: [device("custom-dht11", "custom-dht11-r2", 2, [{ name: "data", gpio: 4 }], ["humidity_sensor", "temperature_sensor"])] }),
  release({ buildId: "rgb-16", softwareVersion: 7, softwareVersionString: "1.6.0", productId: 0x8002, components: [rgbR2] }),
  release({ buildId: "light-17", softwareVersion: 8, softwareVersionString: "1.7.0", productId: 0x8001, components: [device("custom-photosensitive-light", "custom-photosensitive-light-r2", 2, [{ name: "adc", gpio: 4 }], ["light_sensor"])] }),
  release({ buildId: "rgb-18", softwareVersion: 9, softwareVersionString: "1.8.0", productId: 0x8002, components: [rgbR3] }),
  release({ buildId: "rgb-19", softwareVersion: 10, softwareVersionString: "1.9.0", productId: 0x8002, components: [rgbR3] }),
  release({ buildId: "rgb-110", softwareVersion: 11, softwareVersionString: "1.10.0", productId: 0x8002, components: [rgbR3] }),
];

const rgbNode: CompositionNodeIdentity = {
  vendorId: 0xfff1,
  productId: 0x8002,
  softwareVersion: 10,
  softwareVersionString: "1.9.0",
};

function plan(selection: CompositionSelection, node: CompositionNodeIdentity = rgbNode, extra: CompositionRelease[] = []) {
  return planOtaComposition({
    node,
    core,
    catalogue,
    releases: [...releases, ...extra],
    selection,
    limits,
    buildRunning: false,
  });
}

describe("OTA composition planner", () => {
  it("matches the stored RGB revision 3 recipe fingerprint inputs", () => {
    const fingerprint = recipeFingerprint([
      { versionId: "matter-core-iotedu-r2", gpio: null },
      { versionId: "custom-rgb-led-r3", gpio: 4 },
      { versionId: "custom-rgb-led-r3", gpio: 10 },
      { versionId: "custom-rgb-led-r3", gpio: 5 },
    ]);
    expect(fingerprint.startsWith("1d2444f6a630")).toBe(true);
  });

  it("keeps the current firmware and components without an update", () => {
    const result = plan({ firmware: "keep", componentIds: "keep", gpio: [] });
    expect(result.action).toBe("none");
    expect(result.summary).toBe("No changes selected — OTA update is not required.");
    expect(result.otaBuildId).toBeNull();
    expect(result.prepare).toBeNull();
    expect(result.provenance).toBe("matched-release");
    expect(result.current?.components.map((item) => item.versionId)).toEqual(["custom-rgb-led-r3"]);
    expect(result.migration).toBe("unchanged");
  });

  it("reuses the newer RGB package when the recipe is unchanged", () => {
    const result = plan({ firmware: "rgb-110", componentIds: "keep", gpio: [] });
    expect(result.action).toBe("reuse");
    expect(result.otaBuildId).toBe("rgb-110");
    expect(result.otaSoftwareVersion).toBe(11);
    expect(result.migration).toBe("unchanged");
    expect(result.proposed.productId).toBe(0x8002);
    expect(result.prepare).toBeNull();
  });

  it("restores an older RGB revision 3 recipe as the newer forward package", () => {
    const result = plan({ firmware: "rgb-18", componentIds: "keep", gpio: [] });
    expect(result.action).toBe("reuse");
    expect(result.otaBuildId).toBe("rgb-110");
    expect(result.summary).toMatch(/1\.8\.0/);
    expect(result.summary).toMatch(/not served/);
    expect(result.summary).toMatch(/1\.10\.0/);
    expect(result.checks.find((check) => check.id === "version")?.detail).toMatch(/not rewritten/);
  });

  it("refuses to serve or rebuild RGB revision 2 by editing its header", () => {
    const result = plan({ firmware: "rgb-16", componentIds: "keep", gpio: [] });
    expect(result.action).toBe("blocked");
    expect(result.otaBuildId).toBeNull();
    expect(result.blockers.map((item) => item.code)).toContain("integration_unsupported");
    expect(result.blockers.map((item) => item.message).join(" ")).toMatch(/revision 3/);
    expect(result.blockers.map((item) => item.message).join(" ")).toMatch(/OTA header/);
  });

  it("keeps the commissioned product when RGB and photosensitive share GPIO 4", () => {
    const result = plan({ firmware: "keep", componentIds: ["custom-rgb-led", "custom-photosensitive-light"], gpio: [], mode: "replace" });
    expect(result.action).toBe("blocked");
    expect(result.blockers.map((item) => item.code)).toContain("gpio_conflict");
    expect(result.blockers.map((item) => item.code)).not.toContain("no_product_policy");
    expect(result.blockers.map((item) => item.code)).not.toContain("integration_unsupported");
    expect(result.blockers.map((item) => item.message).join(" ")).toMatch(/GPIO 4/);
    expect(result.proposed.productId).toBe(0x8002);
    expect(result.targetProductId).toBe(0x8002);
    expect(result.alternatives.find((item) => item.pinName === "red")?.gpios).not.toContain(4);
    expect(result.alternatives.find((item) => item.pinName === "red")?.gpios).not.toContain(8);
    expect(result.alternatives.find((item) => item.pinName === "red")?.gpios).not.toContain(9);
    expect(result.checks.find((check) => check.id === "wiring")?.status).toBe("warning");
    expect(result.prepare).toBeNull();
  });

  it("plans RGB plus photosensitive under the retained product when red moves", () => {
    const result = plan({
      firmware: "keep",
      mode: "add",
      componentIds: ["custom-photosensitive-light"],
      gpio: [{ componentId: "custom-rgb-led", pinName: "red", gpio: 6 }],
    });
    expect(result.blockers.map((item) => item.code)).not.toContain("gpio_conflict");
    expect(result.action).toBe("compile");
    expect(result.migration).toBe("additive");
    expect(result.endpointMigration.risk).toBe("B");
    expect(result.acknowledgementRequired).toBe(false);
    expect(result.proposed.productId).toBe(0x8002);
    expect(result.prepare?.kind).toBe("retained");
    expect(result.prepare?.targetProductId).toBe(0x8002);
    expect(result.endpointMigration.slots).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, role: "extended_color_light", disposition: "preserved" }),
      expect.objectContaining({ id: 2, role: "light_sensor", disposition: "added" }),
    ]));
    expect(result.wiringChange).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/not hands-free/);
    expect(result.checks.find((check) => check.id === "native_build")?.status).toBe("warning");
  });

  it("blocks replacing RGB with a photosensitive product", () => {
    const result = plan({ firmware: "light-17", componentIds: "keep", gpio: [] });
    expect(result.action).toBe("blocked");
    expect(result.migration).toBe("identity-change");
    expect(result.blockers.map((item) => item.code)).toContain("product_mismatch");
    expect(result.summary).toMatch(/blocked/);
    expect(result.preservation).toMatch(/factory|NVS|commissioning window/i);
    expect(result.preservation).not.toMatch(/factory-reset the board/);
  });

  it("replaces RGB functionality while retaining product 0x8002", () => {
    const result = plan({ firmware: "keep", mode: "replace", componentIds: ["custom-photosensitive-light"], gpio: [] });
    expect(result.action).toBe("compile");
    expect(result.migration).toBe("functionality-replacement");
    expect(result.endpointMigration.risk).toBe("C");
    expect(result.acknowledgementRequired).toBe(true);
    expect(result.proposed.productId).toBe(0x8002);
    expect(result.targetProductId).toBe(0x8002);
    expect(result.referenceProducts).toEqual([expect.objectContaining({ componentId: "custom-photosensitive-light", productId: 0x8001 })]);
    expect(result.proposed.endpoints).toEqual(["light_sensor"]);
    expect(result.endpointMigration.slots).toEqual([
      expect.objectContaining({ id: 1, role: "extended_color_light", disposition: "retired" }),
      expect.objectContaining({ id: 2, role: "light_sensor", disposition: "added" }),
    ]);
    expect(result.prepare).toMatchObject({
      kind: "retained",
      nodeType: null,
      targetProductId: 0x8002,
      targetVendorId: 0xfff1,
      softwareVersion: 12,
      softwareVersionString: "1.11.0",
      retiredEndpointIds: [1],
    });
    expect(result.prepare?.components[0]).toMatchObject({
      id: "custom-photosensitive-light",
      versionId: "custom-photosensitive-light-r2",
      reserveEndpointIds: [1],
      pins: [{ name: "adc", gpio: 4 }],
    });
    expect(result.otaBuildId).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/Apple Home may need to refresh/);
    expect(result.warnings.join(" ")).toMatch(/GPIO 4/);
    expect(result.checks.find((check) => check.id === "endpoints")?.status).toBe("warning");
    expect(result.checks.find((check) => check.id === "requestor")?.status).toBe("passed");
    expect(result.checks.find((check) => check.id === "product")?.detail).toMatch(/0x8001/);
    expect(result.checks.find((check) => check.id === "product")?.detail).toMatch(/0x8002/);
    expect(result.blockers).toEqual([]);
  });

  it("does not reuse the standalone photosensitive image for another product", () => {
    const result = plan({ firmware: "keep", mode: "replace", componentIds: ["custom-photosensitive-light"], gpio: [] });
    expect(result.otaBuildId).not.toBe("light-17");
    expect(result.proposed.productId).not.toBe(0x8001);
  });

  it("refuses to remove the last function", () => {
    const result = plan({ firmware: "keep", mode: "remove", componentIds: ["custom-rgb-led"], gpio: [] });
    expect(result.action).toBe("blocked");
    expect(result.blockers.map((item) => item.code)).toContain("empty_composition");
    expect(result.prepare).toBeNull();
  });

  it("does not treat a component reference product as the target fingerprint", () => {
    const standalone = recipeFingerprint([
      { versionId: "matter-core-iotedu-r2", gpio: null },
      { versionId: "custom-photosensitive-light-r2", gpio: 4 },
    ]);
    const retained = recipeFingerprint([
      { versionId: "target-product:8002", gpio: null },
      { versionId: "matter-core-iotedu-r2", gpio: null },
      { versionId: "custom-photosensitive-light-r2", gpio: 4 },
      { versionId: "retired-endpoints:1", gpio: null },
    ]);
    expect(retained).not.toBe(standalone);
    expect(standalone.startsWith("2a2fd762b860")).toBe(true);
  });

  it("does not invent components when the running release is ambiguous", () => {
    const result = plan(
      { firmware: "keep", componentIds: ["custom-rgb-led"], gpio: [] },
      rgbNode,
      [release({ buildId: "rgb-19-copy", softwareVersion: 10, softwareVersionString: "1.9.0", productId: 0x8002, components: [rgbR3] })],
    );
    expect(result.provenance).toBe("unknown");
    expect(result.action).toBe("blocked");
    expect(result.blockers.map((item) => item.code)).toContain("recipe_unknown");
  });

  it("previews a new DHT11 SoftwareVersion when its data pin moves", () => {
    const node: CompositionNodeIdentity = { vendorId: 0xfff1, productId: 0x8000, softwareVersion: 5, softwareVersionString: "1.4.0" };
    const result = plan({ firmware: "keep", componentIds: ["custom-dht11"], gpio: [{ componentId: "custom-dht11", pinName: "data", gpio: 6 }] }, node);
    expect(result.action).toBe("compile");
    expect(result.prepare).toMatchObject({ nodeType: "environmental-dht11", gpio: 6, softwareVersion: 12, softwareVersionString: "1.11.0" });
    expect(result.proposed.productId).toBe(0x8000);
    expect(result.summary).toMatch(/does not compile/);
    expect(result.wiringChange).toBe(true);
  });

  it("rejects a reserved or fixed pin", () => {
    const node: CompositionNodeIdentity = { vendorId: 0xfff1, productId: 0x8000, softwareVersion: 5, softwareVersionString: "1.4.0" };
    const reserved = plan({ firmware: "keep", componentIds: ["custom-dht11"], gpio: [{ componentId: "custom-dht11", pinName: "data", gpio: 8 }] }, node);
    expect(reserved.blockers.map((item) => item.code)).toContain("gpio_unsupported");
    const fixed = plan({ firmware: "keep", componentIds: ["custom-photosensitive-light"], gpio: [{ componentId: "custom-photosensitive-light", pinName: "adc", gpio: 5 }] }, {
      vendorId: 0xfff1,
      productId: 0x8001,
      softwareVersion: 8,
      softwareVersionString: "1.7.0",
    });
    expect(fixed.blockers.map((item) => item.code)).toContain("gpio_fixed");
    expect(fixed.action).toBe("blocked");
  });

  it("labels firmware history without offering another product as compatible", () => {
    const options = firmwareOptions(rgbNode, releases);
    expect(options[0]?.id).toBe("keep");
    expect(options.find((item) => item.id === "rgb-110")?.group).toBe("newer");
    expect(options.find((item) => item.id === "rgb-110")?.compatible).toBe(true);
    expect(options.find((item) => item.id === "rgb-18")?.group).toBe("older");
    expect(options.find((item) => item.id === "rgb-18")?.compatible).toBe(false);
    expect(options.find((item) => item.id === "light-17")).toBeUndefined();
    expect(options.find((item) => item.id === "rgb-19")).toBeUndefined();
  });

  it("excludes a same-product image that replaces the device function", () => {
    const photo = release({
      buildId: "photo-12",
      softwareVersion: 12,
      softwareVersionString: "1.11.0",
      productId: 0x8002,
      components: [device("custom-photosensitive-light", "custom-photosensitive-light-r2", 2, [{ name: "adc", gpio: 4 }], ["light_sensor"])],
    });
    const combined = release({
      buildId: "rgb-photo-13",
      softwareVersion: 13,
      softwareVersionString: "1.12.0",
      productId: 0x8002,
      components: [rgbR3, device("custom-photosensitive-light", "custom-photosensitive-light-r2", 2, [{ name: "adc", gpio: 4 }], ["light_sensor"])],
    });
    const options = firmwareOptions(rgbNode, [...releases, photo, combined]);
    expect(options.find((item) => item.id === "photo-12")).toBeUndefined();
    expect(options.find((item) => item.id === "rgb-photo-13")).toBeUndefined();
    expect(options.find((item) => item.id === "rgb-110")?.group).toBe("newer");
    const blocked = plan({ firmware: "photo-12", componentIds: "keep", gpio: [] }, rgbNode, [photo, combined]);
    expect(blocked.action).toBe("blocked");
    expect(blocked.blockers.map((item) => item.code)).toContain("function_mismatch");
    expect(blocked.otaBuildId).toBeNull();
  });

  it("does not allocate a version while a build is running", () => {
    const node: CompositionNodeIdentity = { vendorId: 0xfff1, productId: 0x8000, softwareVersion: 5, softwareVersionString: "1.4.0" };
    const result = planOtaComposition({
      node,
      core,
      catalogue,
      releases,
      selection: { firmware: "keep", componentIds: ["custom-dht11"], gpio: [{ componentId: "custom-dht11", pinName: "data", gpio: 7 }] },
      limits,
      buildRunning: true,
    });
    expect(result.action).toBe("blocked");
    expect(result.prepare).toBeNull();
    expect(result.blockers.map((item) => item.code)).toContain("build_busy");
  });

  it("keeps the rollback warning on an unchanged plan", () => {
    const result = plan({ firmware: "keep", componentIds: "keep", gpio: [] });
    expect(result.rollback).toMatch(/without application rollback/);
    expect(result.checks.find((check) => check.id === "rollback")?.status).toBe("warning");
    expect(result.checks.find((check) => check.id === "fabrics")?.detail).toMatch(/Apple Home/);
  });
});
