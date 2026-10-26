import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileLibraryComponent, componentRegister } from "./library-compile.js";

const sensor = Buffer.from("static const int data_gpio = 4;\n");
const header = Buffer.from("#pragma once\n");
const cmake = Buffer.from('idf_component_register(SRCS "sensor.c" INCLUDE_DIRS "include" PRIV_REQUIRES esp_adc)\n');

describe("component compile harness", () => {
  it("copies the component registration instead of executing the uploaded CMake", () => {
    const text = componentRegister([
      { name: "sensor.c", data: sensor },
      { name: "include/sensor.h", data: header },
      { name: "CMakeLists.txt", data: cmake },
    ], false);
    expect(text).toContain('SRCS "sensor.c"');
    expect(text).toContain('INCLUDE_DIRS "include"');
    expect(text).toContain("REQUIRES esp_adc");
    expect(text).not.toContain("execute_process");
  });

  it("reports a missing ESP-IDF installation as unavailable", async () => {
    const report = await compileLibraryComponent(
      [{ name: "sensor.c", data: sensor }],
      { idfPath: null },
    );
    expect(report).toEqual({ available: false, ran: false, success: false, diagnostics: [] });
  });

  it("turns injected compiler output into errors and warnings without running idf.py", async () => {
    const failed = await compileLibraryComponent(
      [{ name: "sensor.c", data: sensor }, { name: "CMakeLists.txt", data: cmake }],
      {
        idfPath: "/tmp",
        run: async (project) => {
          const generated = await readFile(path.join(project, "components/uploaded/CMakeLists.txt"), "utf8");
          expect(generated).toContain("idf_component_register");
          return { code: 1, text: "sensor.c:2:5: error: expected ';'\nsensor.c:3:1: warning: unused variable 'data_gpio'" };
        },
      },
    );
    expect(failed.available).toBe(true);
    expect(failed.ran).toBe(true);
    expect(failed.success).toBe(false);
    expect(failed.diagnostics.map((item) => item.level)).toEqual(["error", "warning"]);
    const clean = await compileLibraryComponent(
      [{ name: "sensor.c", data: Buffer.from("int sensor_init(void) { return 0; }\n") }],
      { idfPath: "/tmp", run: async () => ({ code: 0, text: "" }) },
    );
    expect(clean.success).toBe(true);
    expect(clean.diagnostics).toEqual([]);
    const matter = await compileLibraryComponent(
      [{ name: "sensor.cpp", data: Buffer.from("#include <esp_matter.h>\n") }],
      { idfPath: "/tmp", run: async () => ({ code: 1, text: "data_model/generated/zap-generated/attributes does not exist" }) },
    );
    expect(matter.success).toBe(false);
    expect(matter.diagnostics[0]?.message).toMatch(/ESP-Matter integration compilation did not finish/);
  });
});
