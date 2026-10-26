import { readFile } from "node:fs/promises";

export async function loadEnvFile(file: string): Promise<void> {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    if (process.env[key] == null) process.env[key] = value;
  }
}
