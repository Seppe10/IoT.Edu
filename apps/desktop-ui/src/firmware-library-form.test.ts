import { describe, expect, it } from "vitest";
import type { LibraryComponent } from "@iotedu/contracts";
import {
  addGpioRow,
  addLibraryFiles,
  blankLibraryForm,
  canSaveLibrary,
  customSelectionOptions,
  duplicateLibraryName,
  filterFirmwareLibrary,
  libraryFormFromComponent,
  libraryUploadPath,
  localLibraryIssues,
  removeGpioRow,
  saveLibraryLabel,
  scrollBuilderForm,
  withLibraryChange,
} from "./firmware-library-form";

function component(overrides: Partial<LibraryComponent> = {}): LibraryComponent {
  return {
    id: "custom-0123456789ab",
    name: "DHT11 Temperature and Humidity",
    description: "Reads temperature and humidity.",
    type: "sensor",
    provenance: "custom",
    target: "esp32h2",
    compatibility: null,
    gpio: [{ name: "data_gpio", gpio: 4, description: "Sensor data" }],
    files: [{ name: "sensor.c", sha256: "a".repeat(64), bytes: 12 }],
    revision: 3,
    contentHash: "b".repeat(64),
    validation: { fingerprint: "c".repeat(64), nativeCompile: false, validatedAt: "2026-10-24T00:00:00.000Z", issues: [], integration: null },
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("firmware library form", () => {
  it("starts a new upload and keeps Create Firmware unavailable until validation", () => {
    const form = blankLibraryForm();
    expect(form.selectionId).toBe("");
    expect(form.codeSource).toBe("upload");
    expect(form.gpio).toHaveLength(1);
    expect(saveLibraryLabel(form)).toBe("Create Firmware");
    expect(canSaveLibrary(form)).toBe(false);
    const validated = {
      ...form,
      validation: {
        ok: true,
        fingerprint: "d".repeat(64),
        nativeCompile: true,
        integration: null,
        issues: [],
        files: [],
        stageId: "stage-0123456789ab",
      },
    };
    expect(canSaveLibrary(validated)).toBe(true);
    expect(canSaveLibrary({ ...validated, validation: { ...validated.validation, issues: [{ level: "warning", code: "native_compile_warning", message: "unused" }] } })).toBe(false);
    expect(canSaveLibrary({ ...validated, validation: { ...validated.validation, nativeCompile: false, ok: false } })).toBe(false);
    expect(canSaveLibrary(withLibraryChange(validated, { name: "Changed" }))).toBe(false);
    expect(canSaveLibrary(withLibraryChange(validated, { description: "Changed" }))).toBe(false);
    expect(canSaveLibrary(withLibraryChange(validated, { type: "actuator" }))).toBe(false);
  });

  it("checks required fields, sensor or actuator, files, and GPIO rows", () => {
    const form = blankLibraryForm();
    expect(localLibraryIssues(form)).toEqual(expect.arrayContaining([
      "Firmware Name is required.",
      "Description is required.",
      "Component Type is required.",
      "Upload source files or keep the saved files.",
    ]));
    const filled = {
      ...form,
      name: "PIR Motion Detector",
      description: "Detects motion.",
      type: "actuator" as const,
      newFiles: [{ name: "pir.c", contentBase64: "YQ==" }],
      gpio: [{ key: "one", name: "Data", gpio: "4", description: "" }],
    };
    expect(localLibraryIssues(filled)).toEqual([]);
    const second = addGpioRow(filled);
    expect(second.gpio).toHaveLength(2);
    expect(second.validation).toBeNull();
    const removed = removeGpioRow(second, second.gpio[1]?.key ?? "");
    expect(removed.gpio).toHaveLength(1);
    const duplicate = localLibraryIssues({
      ...filled,
      gpio: [
        { key: "one", name: "Data", gpio: "4", description: "" },
        { key: "two", name: "data", gpio: "4", description: "" },
      ],
    });
    expect(duplicate).toEqual(expect.arrayContaining([
      "Connection “data” is used more than once.",
      "GPIO 4 is assigned more than once.",
    ]));
    expect(localLibraryIssues({ ...filled, gpio: [{ key: "one", name: "Data", gpio: "99", description: "" }] })
      .some((issue) => issue.includes("outside ESP32-H2"))).toBe(true);
    expect(localLibraryIssues({ ...filled, gpio: [{ key: "one", name: "Data", gpio: "9", description: "" }] })).toEqual([]);
  });

  it("loads an edit without copying an approved component into the selector", () => {
    const custom = component();
    const approved = component({
      id: "approved-temp",
      name: "Approved Temp Sensor",
      provenance: "approved",
      type: "actuator",
    });
    const editing = libraryFormFromComponent(custom);
    expect(editing.selectionId).toBe(custom.id);
    expect(editing.name).toBe(custom.name);
    expect(editing.description).toBe(custom.description);
    expect(editing.type).toBe("sensor");
    expect(editing.gpio[0]?.gpio).toBe("4");
    expect(editing.retainedFiles.map((file) => file.name)).toEqual(["sensor.c"]);
    expect(editing.baseRevision).toBe(3);
    expect(editing.validation).toBeNull();
    expect(saveLibraryLabel(editing)).toBe("Update Firmware");
    expect(canSaveLibrary(editing)).toBe(false);
    expect(customSelectionOptions([custom, approved]).map((item) => item.id)).toEqual([custom.id]);
    expect(duplicateLibraryName(editing, [custom, approved])).toBeNull();
    expect(duplicateLibraryName({ ...editing, name: "approved temp sensor" }, [approved])).toMatch(/already exists/);
  });

  it("filters the library and scrolls to the builder form", () => {
    const custom = component();
    const approved = component({ id: "approved-temp", name: "RGB Status Indicator", description: "Status lamp", provenance: "approved", type: "actuator" });
    expect(filterFirmwareLibrary([custom, approved], "humidity", "all").map((item) => item.id)).toEqual([custom.id]);
    expect(filterFirmwareLibrary([custom, approved], "ACTUATOR", "all").map((item) => item.id)).toEqual([approved.id]);
    expect(filterFirmwareLibrary([custom, approved], "", "approved").map((item) => item.id)).toEqual([approved.id]);
    expect(filterFirmwareLibrary([custom, approved], "", "custom").map((item) => item.id)).toEqual([custom.id]);
    const calls: ScrollIntoViewOptions[] = [];
    scrollBuilderForm({ scrollIntoView: (options) => { if (options) calls.push(options); } });
    expect(calls[0]?.block).toBe("start");
    const replaced = addLibraryFiles(libraryFormFromComponent(custom), [{ name: "sensor.c", contentBase64: "Yg==" }]);
    expect(replaced.retainedFiles).toEqual([]);
    expect(replaced.newFiles).toHaveLength(1);
    expect(replaced.validation).toBeNull();
  });

  it("accepts ESP-IDF names and nested component paths", () => {
    expect(libraryUploadPath("CMakeLists.txt")).toBe("CMakeLists.txt");
    expect(libraryUploadPath("Kconfig")).toBe("Kconfig");
    expect(libraryUploadPath("Kconfig.projbuild")).toBe("Kconfig.projbuild");
    expect(libraryUploadPath("drivers/photosensitive_sensor.cpp")).toBe("drivers/photosensitive_sensor.cpp");
    expect(libraryUploadPath("include/photosensitive_sensor.h")).toBe("include/photosensitive_sensor.h");
    expect(libraryUploadPath("sensor.c")).toBe("sensor.c");
    expect(libraryUploadPath("install.sh")).toBeNull();
    expect(libraryUploadPath("../sensor.c")).toBeNull();
  });
});
