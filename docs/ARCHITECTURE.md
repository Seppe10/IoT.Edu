# Architecture

Phase 1 implements the desktop shell and local records. Matter, native compilation, USB flash, and OTA transfer stay behind the same interfaces and are not live yet.

## Intended layers

| Layer | Technology | Responsibility |
|---|---|---|
| UI | React + TypeScript + Vite | Desktop screens; talks only to the local API |
| Local API | Node.js LTS + TypeScript + Fastify, bound to `127.0.0.1` | Validation, jobs, persistence of non-secret records |
| Matter service | Pinned matter.js | Management fabric “IoT.Edu Management”, commissioning, OTA Provider |
| Firmware builder | ESP-IDF v5.4.1 + esp-matter | Workspace generation and real artifacts |
| Catalogue | Local JSON manifests + source trees | Component discovery; future PostgreSQL adapter implements the same interface |
| Records | Atomic JSON under `DATA_DIR` | Nodes, packages, jobs, preferences |
| Secrets | Protected storage, not ordinary JSON | Controller keys, fabric credentials, Thread datasets, AI keys |
| AI | Optional server-side adapter | Draft components; disabled by default |
| USB flash | WebSerial or documented esptool fallback | First-time install only |

## Storage interfaces (Phase 1)

- `CatalogRepository` — `LocalCatalogRepository` reads `catalog/manifests/*.json`
- `NodeRepository` — atomic JSON under `DATA_DIR`
- `FirmwareBuildService` — mock packages only; native and Docker modes are rejected
- `MatterManagementService` — simulated commissioning; no session and no invented node id
- `OtaDeploymentService` — preflight blocks unknown mandatory checks; simulated artifacts are not deployable

A future PostgreSQL catalogue must replace `CatalogRepository` only. Node, build, and OTA job files stay local JSON.

## Trust boundary

The browser never runs host OS commands. The local API owns subprocesses (IDF, esptool, ota_image_tool.py, Matter controller). Custom and AI-generated code is untrusted until the user accepts it.

## Phase 1 reality

- UI: Vite, React 19, React Router 7, bound to `127.0.0.1:5173`, proxying `/api`.
- API: Fastify 5 on `127.0.0.1:3847`. Any other host is refused. CORS allows only the local UI origins.
- Records: nodes, builds, OTA jobs, and an audit log under `DATA_DIR`. Writes are atomic. Pairing codes are redacted from the audit log.
- Catalogue: read-only manifests. No database client and no GitHub client.
- Mock builds write `SIMULATED.txt` with `deployable: false` and do not invoke ESP-IDF.
- `POST /api/ai/draft` returns 503 when no provider is configured.
- Reference firmware under `reference/matter-dht11/` is the Phase 0 import and is left unmodified.
- Phase 2 adds `firmware/components/iotedu_core` and `firmware/components/iotedu_dht11`. `scripts/build_modular_dht11.sh` generates a gitignored workspace and compiles it with ESP-IDF. The desktop `FirmwareBuildService` still returns mock packages and still rejects native and Docker modes.

Figma file `ctgVnYSDl6CAmnc2sXTfKk` could not be read (no edit access on the Figma MCP session). Screen structure follows the specification’s nine management screens. Pixel match to the wireframes is unverified.
