import { describe, expect, it } from "vitest";
import { classifyCompilerOutput, readIdfVersion } from "./compiler-diagnostics.js";

describe("compiler diagnostics", () => {
  it("separates component warnings from ESP-Matter warnings", () => {
    const workspace = "/tmp/iotedu-build";
    const text = [
      "ESP-IDF v5.4.1",
      `${workspace}/main/dht11_matter.cpp:12:5: warning: unused variable [-Wunused-variable]`,
      `/Users/me/esp/esp-matter/components/esp_matter/esp_matter_attribute.cpp:4:3: warning: old declaration [-Wdeprecated]`,
      `${workspace}/components/iotedu_dht11/dht11.c:8:1: error: unknown type`,
    ].join("\n");
    const diagnostics = classifyCompilerOutput(text, workspace);
    expect(diagnostics.filter((item) => item.origin === "component")).toHaveLength(2);
    expect(diagnostics.filter((item) => item.origin === "sdk")).toHaveLength(1);
    expect(readIdfVersion(text)).toBe("5.4.1");
    expect(readIdfVersion("Building /Users/me/.espressif/v5.4.1/esp-idf/components/mbedtls/port/aes.c.obj")).toBe("5.4.1");
  });

  it("keeps an inlined third-party warning attached to its translation unit", () => {
    const text = [
      "    inlined from 'void Camera()' at /esp/esp-matter/connectedhomeip/src/app/clusters/camera-av-settings-user-level-management-server/CameraAvSettingsUserLevelManagementCluster.cpp:1348:47:",
      "/esp/esp-matter/connectedhomeip/src/lib/core/Optional.h:72:13: warning: value may be used uninitialized [-Wmaybe-uninitialized]",
    ].join("\n");
    const [diagnostic] = classifyCompilerOutput(text, "/tmp/iotedu-build");
    expect(diagnostic?.origin).toBe("sdk");
    expect(diagnostic?.file).toContain("Optional.h");
    expect(diagnostic?.message).toContain("CameraAvSettingsUserLevelManagementCluster.cpp");
  });
});
