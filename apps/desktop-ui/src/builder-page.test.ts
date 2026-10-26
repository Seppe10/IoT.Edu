import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));

describe("firmware builder page", () => {
  it("shows the component workflow and removes the old package sections", async () => {
    const builder = await readFile(path.join(directory, "pages/BuilderPage.tsx"), "utf8");
    const library = await readFile(path.join(directory, "pages/CatalogPage.tsx"), "utf8");
    const form = await readFile(path.join(directory, "firmware-library-form.ts"), "utf8");
    const text = `${builder}\n${library}\n${form}`;
    expect(text).toContain("Create, validate and manage reusable firmware components for sensors and actuators.");
    expect(text).toContain("Upload Custom Code");
    expect(text).toContain("Firmware Name");
    expect(text).toContain("Component Type");
    expect(text).toContain(">Sensor<");
    expect(text).toContain(">Actuator<");
    expect(text).toContain("GPIO Configuration");
    expect(text).toContain("+ Add GPIO Pin");
    expect(text).toContain("Validate this component before saving it.");
    expect(text).toContain("Create Firmware saves a reusable component. It does not compile or flash ESP32-H2 firmware.");
    expect(text).toContain("Firmware Library");
    expect(text).toContain("Custom Code");
    expect(text).toContain("Approved Code");
    expect(text).toContain("Edit Firmware");
    expect(text).toContain("No GPIO pins are required.");
    expect(text).toContain('getElementById("build-firmware")');
    expect(text).toContain("scrollBuilderForm");
    expect(builder).not.toMatch(/Build mode|Create simulated package|Matter endpoints|Partition layout|Firmware Packages|Build History|Local components|SoftwareVersion|Version string|Approved local|Select for builder|Component Library|dangerouslySetInnerHTML/i);
    expect(library).not.toMatch(/experimental|planned|template|Select for builder|Component Library|TemperatureMeasurement|RelativeHumidityMeasurement/i);
  });
});
