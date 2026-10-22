import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, readBoardProfile } from "./app.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function defaultDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) throw new Error("Set DATA_DIR. No home directory is available.");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "IoT.Edu");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "IoT.Edu");
  return path.join(process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "iotedu");
}

const host = process.env.IOTEDU_HOST ?? "127.0.0.1";
if (host !== "127.0.0.1") {
  throw new Error("Refusing to bind the administrative API outside 127.0.0.1");
}

const port = Number(process.env.PORT ?? 3847);
const profile = await readBoardProfile(repoRoot);
const app = await buildApp({
  dataDir: defaultDataDir(),
  repoRoot,
  catalogDir: path.join(repoRoot, "catalog/manifests"),
  profile,
  matterMode: process.env.MATTER_MODE === "mock" ? "mock" : "live",
});

await app.listen({ host, port });
console.log(`IoT.Edu API listening on http://${host}:${port}`);
