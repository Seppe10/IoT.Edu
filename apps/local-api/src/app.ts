import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import cors from "@fastify/cors";
import { LocalCatalogRepository } from "@iotedu/catalog";
import {
  aiDraftRequestSchema,
  commissionRequestSchema,
  firmwareBuildRequestSchema,
  otaRequestSchema,
  programRequestSchema,
  renameNodeSchema,
  type BuildJob,
  type OtaJob,
} from "@iotedu/contracts";
import { inspectToolchain, loadReferenceLayout, type BoardProfile } from "@iotedu/firmware-builder";
import { MockMatterManagementService } from "@iotedu/matter-controller";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { LocalProgrammerService, ProgrammerError, type MonitorRunner, type PortLister, type UsbRunner } from "./programmer-service.js";
import { LocalFirmwareBuildService, LocalOtaService, type NativeRunner } from "./services.js";
import { JsonJobRepository, JsonNodeRepository, appendAudit, redact } from "./store.js";

const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

const UPLOAD_EXTENSIONS = new Set([".c", ".h", ".cpp", ".hpp", ".txt"]);

export interface AppPaths {
  dataDir: string;
  repoRoot: string;
  catalogDir: string;
  profile: BoardProfile;
  nativeAvailable?: boolean;
  runNative?: NativeRunner;
  runProgram?: UsbRunner;
  runMonitor?: MonitorRunner;
  listPorts?: PortLister;
}

export async function buildApp(paths: AppPaths): Promise<FastifyInstance> {
  const nodes = new JsonNodeRepository(path.join(paths.dataDir, "nodes.json"));
  const builds = new JsonJobRepository<BuildJob>(path.join(paths.dataDir, "builds.json"));
  const otas = new JsonJobRepository<OtaJob>(path.join(paths.dataDir, "ota-jobs.json"));
  const catalog = new LocalCatalogRepository(paths.catalogDir, paths.repoRoot);
  const toolchain = await inspectToolchain();
  const nativeAvailable = paths.nativeAvailable ?? toolchain.nativeAvailable;
  const matter = new MockMatterManagementService(nodes);
  const firmware = new LocalFirmwareBuildService(catalog, builds, paths.dataDir, paths.repoRoot, paths.profile, {
    nodes,
    nativeAvailable,
    runNative: paths.runNative,
  });
  await firmware.recoverInterrupted();
  const programmer = new LocalProgrammerService(
    builds,
    paths.dataDir,
    paths.repoRoot,
    paths.profile,
    nativeAvailable,
    paths.runProgram,
    paths.runMonitor,
    paths.listPorts,
  );
  await programmer.recoverInterrupted();
  const ota = new LocalOtaService(builds, otas, nodes, paths.profile, paths.repoRoot);
  const auditFile = path.join(paths.dataDir, "audit.jsonl");

  const app = Fastify({ logger: false });
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.has(origin)) callback(null, true);
      else callback(new Error("Origin is not allowed"), false);
    },
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: "invalid_input", message: error.issues.map((issue) => issue.message).join("; ") },
      });
    }
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message === "Node not found" ? 404 : 400;
    return reply.code(status).send({ error: { code: "request_failed", message } });
  });

  app.get("/api/health", async () => ({ ok: true, bind: "127.0.0.1" }));
  app.get("/api/capabilities", async () => {
    const report = await matter.getCapabilities();
    if (nativeAvailable) {
      report.firmwareBuild = "available";
      report.usbFlash = "available";
      report.notes = [
        ...report.notes,
        "Native firmware compilation is available. A compiled package is not hardware-verified.",
        "USB writing is available for a compiled ESP32-H2 package. NVS is not erased. A finished write is not hardware verification.",
      ];
    }
    return report;
  });

  app.get("/api/nodes", async () => ({ nodes: await nodes.list() }));
  app.get("/api/nodes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const node = await nodes.getById(id);
    if (!node) return reply.code(404).send({ error: { code: "not_found", message: "Node not found" } });
    return { node };
  });
  app.post("/api/nodes/commission", async (request) => {
    const body = commissionRequestSchema.parse(request.body);
    const result = await matter.commission(body);
    await appendAudit(auditFile, {
      action: "commission",
      path: body.path,
      nodeId: result.node.id,
      simulated: true,
      pairingCode: body.pairingCode ? "redacted" : undefined,
    });
    return result;
  });
  app.post("/api/nodes/:id/refresh", async (request) => {
    const { id } = request.params as { id: string };
    return matter.refreshNode(id);
  });
  app.post("/api/nodes/:id/commissioning-window", async (request) => {
    const { id } = request.params as { id: string };
    const node = await nodes.getById(id);
    if (!node) throw new Error("Node not found");
    return matter.openCommissioningWindow(id);
  });
  app.post("/api/nodes/:id/rename", async (request) => {
    const { id } = request.params as { id: string };
    const body = renameNodeSchema.parse(request.body);
    const node = await nodes.getById(id);
    if (!node) throw new Error("Node not found");
    const updated = {
      ...node,
      name: body.name,
      updatedAt: new Date().toISOString(),
      history: [...node.history, { at: new Date().toISOString(), kind: "rename", detail: `Renamed to ${body.name}` }],
    };
    await nodes.save(updated);
    return { node: updated };
  });

  app.get("/api/catalog", async (request) => {
    const query = request.query as { q?: string; status?: "verified" | "experimental" | "template" | "planned" };
    const components = await catalog.search(query.q ?? "", query.status);
    return { components };
  });
  app.get("/api/catalog/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const component = await catalog.getById(id);
    if (!component) return reply.code(404).send({ error: { code: "not_found", message: "Component not found" } });
    return { component };
  });

  app.get("/api/firmware/layout", async () => loadReferenceLayout(paths.repoRoot, paths.profile));

  app.post("/api/builds/validate", async (request) => {
    const body = firmwareBuildRequestSchema.parse(request.body);
    return firmware.validate(body);
  });
  app.post("/api/builds", async (request, reply) => {
    const body = firmwareBuildRequestSchema.parse(request.body);
    const job = await firmware.build(body);
    await appendAudit(auditFile, { action: "build", id: job.id, status: job.status, simulated: job.simulated });
    if (job.status === "failed") {
      const message = job.validation.issues.find((issue) => issue.level === "error")?.message
        ?? job.logs.at(-1)
        ?? "Build rejected";
      return reply.code(400).send({ job, error: { code: "build_rejected", message } });
    }
    return reply.code(job.status === "running" ? 202 : 201).send({ job });
  });
  app.post("/api/builds/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await firmware.cancel(id);
    if (!job) return reply.code(404).send({ error: { code: "not_found", message: "Build not found" } });
    return { job };
  });
  app.get("/api/builds/:id/log", async (request, reply) => {
    const { id } = request.params as { id: string };
    const log = await firmware.readLog(id);
    if (!log) return reply.code(404).send({ error: { code: "not_found", message: "Build not found" } });
    return log;
  });
  app.get("/api/builds", async () => ({ jobs: await firmware.list() }));
  app.get("/api/builds/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await firmware.get(id);
    if (!job) return reply.code(404).send({ error: { code: "not_found", message: "Build not found" } });
    return { job };
  });
  app.get("/api/builds/:id/artifacts", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await firmware.get(id);
    if (!job) return reply.code(404).send({ error: { code: "not_found", message: "Build not found" } });
    return { artifacts: job.artifacts, simulated: job.simulated, verification: job.verification };
  });
  app.get("/api/builds/:id/download/:name", async (request, reply) => {
    const { id, name } = request.params as { id: string; name: string };
    const job = await firmware.get(id);
    if (!job) return reply.code(404).send({ error: { code: "not_found", message: "Build not found" } });
    const safeName = path.basename(name);
    const artifact = safeName === name ? job.artifacts.find((item) => item.name === safeName) : undefined;
    if (!artifact) return reply.code(404).send({ error: { code: "not_found", message: "Artifact not found" } });
    if (artifact.simulated || job.simulated || job.verification === "simulated") {
      return reply.code(409).send({
        error: { code: "simulated_artifact", message: "Simulated packages cannot be downloaded as firmware." },
      });
    }
    const diagnostic = safeName === "build.log" || safeName === "sdkconfig";
    if (job.status !== "succeeded" && !diagnostic) {
      return reply.code(409).send({
        error: { code: "build_not_successful", message: "Only a successful build can be downloaded as firmware." },
      });
    }
    const root = path.resolve(paths.dataDir);
    const absolute = path.resolve(root, artifact.relativePath);
    if (!absolute.startsWith(`${root}${path.sep}`)) {
      return reply.code(400).send({ error: { code: "rejected_path", message: "Artifact path is outside the data directory." } });
    }
    const bytes = await readFile(absolute);
    return reply.header("content-disposition", `attachment; filename="${safeName}"`).type("application/octet-stream").send(bytes);
  });

  app.get("/api/programmer/ports", async () => ({ ports: await programmer.portsAvailable() }));
  app.post("/api/programmer/sessions", async (request, reply) => {
    try {
      const session = await programmer.start(programRequestSchema.parse(request.body));
      await appendAudit(auditFile, {
        action: "program",
        id: session.id,
        buildId: session.buildId,
        status: session.status,
        eraseAll: false,
      });
      const code = session.status === "running" ? 202 : session.status === "succeeded" ? 201 : 200;
      return reply.code(code).send({ session });
    } catch (error) {
      if (error instanceof ProgrammerError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });
  app.get("/api/programmer/sessions", async () => ({ sessions: await programmer.list() }));
  app.get("/api/programmer/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await programmer.get(id);
    if (!session) return reply.code(404).send({ error: { code: "not_found", message: "Programming session not found" } });
    return { session };
  });
  app.post("/api/programmer/sessions/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await programmer.cancel(id);
    if (!session) return reply.code(404).send({ error: { code: "not_found", message: "Programming session not found" } });
    return { session };
  });
  app.get("/api/programmer/sessions/:id/log", async (request, reply) => {
    const { id } = request.params as { id: string };
    const log = await programmer.readLog(id);
    if (!log) return reply.code(404).send({ error: { code: "not_found", message: "Programming session not found" } });
    return log;
  });
  app.post("/api/programmer/sessions/:id/monitor", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return { session: await programmer.monitor(id) };
    } catch (error) {
      if (error instanceof ProgrammerError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });
  app.post("/api/programmer/sessions/:id/save-log", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await programmer.saveLog(id);
    } catch (error) {
      if (error instanceof ProgrammerError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });
  app.get("/api/programmer/sessions/:id/saved-log", async (request, reply) => {
    const { id } = request.params as { id: string };
    const text = await programmer.savedLog(id);
    if (text === null) return reply.code(404).send({ error: { code: "not_found", message: "No saved log" } });
    return reply.type("text/plain").send(text);
  });

  app.post("/api/uploads", async (request, reply) => {
    const body = request.body as { fileName?: string; content?: string };
    const fileName = path.basename(body.fileName ?? "");
    const extension = path.extname(fileName).toLowerCase();
    if (!fileName || fileName !== body.fileName || !UPLOAD_EXTENSIONS.has(extension)) {
      return reply.code(400).send({
        error: { code: "rejected_upload", message: "Only a single .c, .h, .cpp, .hpp, or .txt file name is accepted." },
      });
    }
    const content = body.content ?? "";
    if (content.length > 200_000) {
      return reply.code(400).send({ error: { code: "upload_too_large", message: "Upload exceeds 200 kB." } });
    }
    const id = randomUUID();
    const dir = path.join(paths.dataDir, "uploads", id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, fileName), content, "utf8");
    await writeFile(
      path.join(dir, "meta.json"),
      JSON.stringify({ id, fileName, trusted: false, compiled: false }, null, 2),
      "utf8",
    );
    return reply.code(201).send({
      uploadId: id,
      trusted: false,
      message: "Stored as untrusted source. It has not been compiled or executed.",
    });
  });

  app.post("/api/ota/preflight", async (request) => ota.preflight(otaRequestSchema.parse(request.body)));
  app.post("/api/ota/jobs", async (request, reply) => {
    const body = otaRequestSchema.parse(request.body);
    const job = await ota.deploy(body);
    await appendAudit(auditFile, { action: "ota", id: job.id, status: job.status, nodeId: body.nodeId });
    return reply.code(job.status === "blocked" || job.status === "failed" ? 409 : 201).send({ job });
  });
  app.get("/api/ota/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await ota.get(id);
    if (!job) return reply.code(404).send({ error: { code: "not_found", message: "OTA job not found" } });
    return { job };
  });
  app.get("/api/ota/jobs", async () => ({ jobs: await otas.list() }));

  app.post("/api/ai/draft", async (request, reply) => {
    aiDraftRequestSchema.parse(request.body);
    return reply.code(503).send({
      error: {
        code: "ai_disabled",
        message: "No AI provider is configured. The rest of IoT.Edu continues to work without one.",
      },
    });
  });

  app.get("/api/settings", async () => ({
    applicationVersion: "0.1.0",
    dataDir: paths.dataDir,
    buildMode: nativeAvailable ? "native" : "mock_only",
    expectedIdfVersion: "v5.4.1",
    idfPathConfigured: toolchain.idfPathConfigured,
    espMatterPathConfigured: toolchain.espMatterPathConfigured,
    toolchainProbed: true,
    dockerProbed: false,
    controllerIdentityLoaded: false,
    fabricLabel: "IoT.Edu Management",
    notes: [
      nativeAvailable
        ? "Native builds use the configured ESP-IDF v5.4.1 environment. Docker remains unavailable."
        : "Native builds need IDF_PATH, ESP_MATTER_PATH, and IDF_ACTIVATE. Mock packages remain available.",
      nativeAvailable
        ? "A compiled package can be written over USB. NVS is not erased. Writing the image does not verify startup or commission the node."
        : "USB writing needs the same ESP-IDF environment as a native build. Simulated packages cannot be written.",
      "No Matter controller identity exists. A missing credential file is not replaced automatically.",
    ],
  }));

  app.get("/api/controller/status", async () => ({
    identityLoaded: false,
    fabricLabel: "IoT.Edu Management",
    persisted: false,
    message: "Controller storage has not been created. IoT.Edu will not generate a replacement identity in this release.",
  }));

  app.get("/api/events", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const buildsNow = await firmware.list();
    const otasNow = await otas.list();
    reply.raw.write(`data: ${JSON.stringify({ builds: buildsNow, otaJobs: otasNow })}\n\n`);
    reply.raw.end();
  });

  app.addHook("onSend", async (request, _reply, payload) => {
    if (typeof payload === "string" && request.url.startsWith("/api/")) {
      return redact(payload);
    }
    return payload;
  });

  return app;
}

export async function readBoardProfile(repoRoot: string): Promise<BoardProfile> {
  const raw = JSON.parse(await readFile(path.join(repoRoot, "board-profiles/esp32h2.json"), "utf8")) as BoardProfile;
  return raw;
}
