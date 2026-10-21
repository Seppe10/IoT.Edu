# Architecture

Phase 0 has no running desktop application. This document records the intended local-first shape so later phases can implement it without inventing a second design.

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

## Storage interfaces (to implement in Phase 1)

- `CatalogRepository`
- `NodeRepository`
- `FirmwareBuildService`
- `MatterManagementService`
- `OtaDeploymentService`

A future PostgreSQL catalogue must replace `CatalogRepository` only.

## Trust boundary

The browser never runs host OS commands. The local API owns subprocesses (IDF, esptool, ota_image_tool.py, Matter controller). Custom and AI-generated code is untrusted until the user accepts it.

## Phase 0 reality

Only firmware reference sources, import tooling, and documentation exist. No Fastify server, no React app, no matter.js controller.
