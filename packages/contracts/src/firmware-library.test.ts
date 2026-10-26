import { libraryComponentSchema, libraryValidationResponseSchema } from "./firmware-library.js";
import { describe, expect, it } from "vitest";

describe("firmware library contracts", () => {
  it("accepts a native compile result only as an explicit boolean", () => {
    const parsed = libraryValidationResponseSchema.safeParse({
      ok: true,
      fingerprint: "a".repeat(64),
      nativeCompile: true,
      integration: { functionName: "sensor_init", signature: "esp_err_t sensor_init(uint16_t endpoint_id)", endpointOwnedBy: "host" },
      issues: [],
      files: [],
    });
    expect(parsed.success).toBe(true);
    expect(libraryValidationResponseSchema.safeParse({
      ok: true,
      fingerprint: "a".repeat(64),
      nativeCompile: "yes",
      integration: null,
      issues: [],
      files: [],
    }).success).toBe(false);
  });

  it("requires a name and description", () => {
    const parsed = libraryComponentSchema.safeParse({
      id: "custom-0123456789ab",
      name: " ",
      description: "",
      type: "sensor",
      provenance: "custom",
      target: "esp32h2",
      compatibility: null,
      gpio: [],
      files: [],
      revision: 1,
      contentHash: "b".repeat(64),
      validation: { fingerprint: "c".repeat(64), nativeCompile: false, validatedAt: "", issues: [] },
      createdAt: "",
      updatedAt: "",
    });
    expect(parsed.success).toBe(false);
  });
});
