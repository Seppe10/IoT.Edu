import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)));

async function sourceText(): Promise<string> {
  const files = (await readdir(src, { recursive: true })).filter((name) => String(name).endsWith(".tsx"));
  const chunks = await Promise.all(files.map((name) => readFile(path.join(src, String(name)), "utf8")));
  return chunks.join("\n");
}

describe("desktop UI boundaries", () => {
  it("does not render a sensor or actuator dashboard", async () => {
    const text = await sourceText();
    expect(text).not.toMatch(/recharts|chart\.js|TemperatureMeasurement|RelativeHumidityMeasurement|actuator control/i);
    expect(text).toContain("Pair New Node");
    expect(text).toContain("Settings");
  });
});
