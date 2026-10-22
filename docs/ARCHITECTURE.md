# Architecture

Phase 4 adds a USB write workflow for compiled packages. Matter commissioning and OTA transfer stay simulated. A USB write has not been run on a board.

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
| USB flash | Local ESP-IDF tool on macOS, using package metadata | Compiled packages only. NVS is not erased. Hardware verification pending |

## Storage interfaces (Phase 1)

- `CatalogRepository` — `LocalCatalogRepository` reads `catalog/manifests/*.json`
- `NodeRepository` — atomic JSON under `DATA_DIR`
- `FirmwareBuildService` — mock packages and native ESP-IDF builds. USB writing accepts a compiled package and rejects a simulated one.
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
- Phase 2 adds `firmware/components/iotedu_core` and `firmware/components/iotedu_dht11`. `scripts/build_modular_dht11.sh` generates a gitignored workspace and compiles it with ESP-IDF.
- Phase 3 connects the Firmware Builder to that pipeline. Mock mode remains for labelled simulations. Native mode generates an isolated workspace under `DATA_DIR`, runs ESP-IDF v5.4.1, and stores the application image, merged USB image, and Matter `.ota` image. Docker mode stays unavailable. A compiled package is not hardware-verified.
- Phase 4 adds USB writing for a compiled package. The local API builds the command from `flasher_args.json`, refuses erase and simulated packages, and can open a serial monitor afterwards. The Matter controller and OTA Provider are unchanged. No board has been written.

Figma file `ctgVnYSDl6CAmnc2sXTfKk` could not be read (no edit access on the Figma MCP session). Screen structure follows the specification’s nine management screens. Pixel match to the wireframes is unverified.
