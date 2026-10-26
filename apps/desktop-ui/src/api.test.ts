import { describe, expect, it } from "vitest";
import { apiErrorFromResponse } from "./api";

describe("API errors", () => {
  it("keeps the Matter error code that selects the failed stage", () => {
    const error = apiErrorFromResponse(400, {
      error: {
        code: "identity_read_failed",
        message: "The CASE session is available, but Basic Information was aborted.",
        detail: { stage: "read_basic_information", completed: ["locate_peer", "discover_operational", "case_session"] },
      },
    });
    expect(error.code).toBe("identity_read_failed");
    expect(error.detail).toMatchObject({ stage: "read_basic_information" });
  });

  it("explains an unregistered route instead of a generic 404", () => {
    const error = apiErrorFromResponse(404, {
      message: "Route GET:/api/firmware-library not found",
      error: "Not Found",
      statusCode: 404,
    });
    expect(error.code).toBe("route_not_found");
    expect(error.message).toBe("Route GET:/api/firmware-library not found");
    expect(error.status).toBe(404);
  });

  it("keeps a structured component-not-found response", () => {
    const error = apiErrorFromResponse(404, {
      error: { code: "not_found", message: "Firmware component not found." },
    });
    expect(error.code).toBe("not_found");
    expect(error.message).toBe("Firmware component not found.");
  });
});
