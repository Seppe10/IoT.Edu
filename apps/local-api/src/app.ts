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
  renameNodeSchema,
  type BuildJob,
  type OtaJob,
} from "@iotedu/contracts";
import { loadReferenceLayout, type BoardProfile } from "@iotedu/firmware-builder";
import { MockMatterManagementService } from "@iotedu/matter-controller";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { LocalFirmwareBuildService, LocalOtaService } from "./services.js";
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
}

export async function buildApp(paths: AppPaths): Promise<FastifyInstance> {
  const nodes = new JsonNodeRepository(path.join(paths.dataDir, "nodes.json"));
  const builds = new JsonJobRepository<BuildJob>(path.join(paths.dataDir, "builds.json"));
  const otas = new JsonJobRepository<OtaJob>(path.join(paths.dataDir, "ota-jobs.json"));
  const catalog = new LocalCatalogRepository(paths.catalogDir, paths.repoRoot);
  const matter = new MockMatterManagementService(nodes);
  const firmware = new LocalFirmwareBuildService(catalog, builds, paths.dataDir, paths.repoRoot, paths.profile);
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
  app.get("/api/capabilities", async () => matter.getCapabilities());

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
    return reply.code(job.status === "failed" ? 400 : 201).send({ job });
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
    return { artifacts: job.artifacts, simulated: job.simulated };
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
    buildMode: "mock_only" as const,
    expectedIdfVersion: "v5.4.1",
    idfPathConfigured: Boolean(process.env.IDF_PATH),
    espMatterPathConfigured: Boolean(process.env.ESP_MATTER_PATH),
    toolchainProbed: false,
    dockerProbed: false,
    controllerIdentityLoaded: false,
    fabricLabel: "IoT.Edu Management",
    notes: [
      "Toolchain paths are read from the environment when a native build is added. This API does not probe them yet.",
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
