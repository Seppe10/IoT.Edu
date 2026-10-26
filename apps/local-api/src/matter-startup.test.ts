import { describe, expect, it } from "vitest";
import { matterStartupFromLog } from "./programmer-service.js";

describe("Matter startup from a saved boot log", () => {
  it("treats the RGB registration failure as Matter not started and a later server line as started", () => {
    const stopped = "App version: 1.6.0\nFailed to register the RGB light, err:261";
    expect(matterStartupFromLog(stopped, false)).toBe("failed");
    const recovered = `${stopped}\nServer Listening...`;
    expect(matterStartupFromLog(recovered, false)).toBe("started");
    expect(matterStartupFromLog("App version: 1.6.0\nchip[DL]: OpenThread started: OK", true)).toBe("unknown");
    expect(matterStartupFromLog("App version: 1.8.0\nServer Listening...", false)).toBe("started");
    expect(matterStartupFromLog("App version: 1.6.0", false)).toBe("unknown");
  });
});
