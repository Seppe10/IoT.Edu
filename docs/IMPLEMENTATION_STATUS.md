# Implementation status

Last updated: 2026-10-21 (Phase 1 local desktop shell).

## Phase 0 gate

**Met for compilation.** Imported allowlisted sources built with ESP-IDF v5.4.1 into `sensors.bin` (1,591,552 bytes, 19% of the OTA slot free) at 2026-10-21T10:45:14Z. Hardware flash, live commissioning, and OTA remain pending. The reference sources were not refactored in Phase 1.

Importer tests: `python3 -m unittest tests.test_import_reference_firmware -v` — 7 tests, OK, re-run before commit `f979ca0`.

Generated and **not** committed: `reference/matter-dht11/build/`, `sdkconfig`, `managed_components/`, `docs/baseline-build.log`.

## Phase 1

**Met for the local shell.** React + TypeScript UI, Fastify API, Zod contracts, and JSON storage are in place. Commissioning, firmware packages, and OTA jobs are explicitly simulated. PostgreSQL and GitHub are not integrated.

### What works

- Navigation across overview, pair, node details, component library, firmware builder, AI draft, OTA preflight, deployment record, and settings.
- Persistent local JSON for nodes, builds, and OTA jobs (`DATA_DIR`, atomic writes, pairing codes redacted from the audit log).
- Read-only catalogue. DHT11 is experimental and selectable for a mock package. LDR, PIR, RGB, and endpoint templates are not selectable.
- Mock package writes `SIMULATED.txt` and is not deployable. Native and Docker builds are rejected.
- OTA preflight blocks unknown mandatory checks. Deploy stays disabled. A saved blocked job records every stage as `not_observed`.
- AI draft returns 503 and shows no generated code.
- Settings reports capabilities: commissioning and firmware/OTA are `mock_only`, Bluetooth is `unsupported`, Thread dataset / USB / AI are `needs_setup`. No controller identity is loaded.

### Browser check (2026-10-21)

Walked on `http://127.0.0.1:5173` against the dev API:

- Paired a simulated node, renamed it to “Bench H2 renamed”, refreshed identity, and requested a commissioning window. Both maintenance actions explain that no Matter session exists. Matter node id stays unassigned. Reachable count stays 0.
- Library search for LDR returns only the planned entry, with selection disabled.
- Builder created package `1.1` / version number 2 as simulated, deployable false. Partition layout id prefix `8aec3f810b0c`.
- Preflight against that package and the simulated node was Blocked. Deploy stayed disabled. Saving the blocked preflight opened a deployment record whose eight stages are `not_observed`.
- AI form submission showed: “No AI provider is configured. The rest of IoT.Edu continues to work without one.” Preview stayed empty.
- Settings listed the capability states above and stated that a missing credential is not replaced.
- Overview then showed 1 paired node, 0 reachable, 0 applicable updates, 0 active OTA jobs, firmware “Not read”.

Figma frames were not available (no edit access). Visual comparison to the wireframes was not done.

### Commands

```text
npm install
npm test          # 19 vitest tests, all passed
npm run typecheck # passed for all six workspaces
npm run dev       # API 127.0.0.1:3847, UI 127.0.0.1:5173
```

| Suite | Result |
|---|---|
| `@iotedu/contracts` (2) | Passed |
| `@iotedu/catalog` (3) | Passed |
| `@iotedu/firmware-builder` (5) | Passed |
| `@iotedu/matter-controller` (1) | Passed |
| `@iotedu/local-api` (7) | Passed |
| `@iotedu/desktop-ui` (1) | Passed |
| Typecheck, all workspaces | Passed |
| `npm run build` (Vite production bundle) | Passed |
| Hardware | Not run |

## Hardware verification

None. No USB flash, no live commissioning, no live SoftwareVersion read, no Matter OTA transfer.

## Remaining limitations

- Firmware is still the original monolithic `sensors` project.
- No Matter `.ota` image (`CONFIG_CHIP_OTA_IMAGE_BUILD` unset).
- Test VID/PID and example DAC providers.
- `esp_bsp_generic` pulls unused LCD/LVGL components.
- Unknown Kconfig symbol `ENABLE_WIFI_AP` in defaults (warning only).
- Bluetooth commissioning, Thread dataset, USB flash, native compile, OTA Provider, and AI are not implemented.
- `npm audit` originally reported 8 advisories. Same-major upgrades cleared Fastify, React Router, and Vite. Vitest 3.2.7 and its development dependencies `@vitest/mocker` and `tinypool` remain vulnerable; the published fix is Vitest 5, which was not applied. See `docs/DEPENDENCY_AUDIT.md`.
- Figma pixel match is unverified. The nine screens follow the specification; no functional divergence from that screen list was found.
- The IDE accessibility snapshot still omits some static table-cell names. Chrome’s accessibility tree exposes them after the table-cell display fix (`docs/DECISIONS.md`).

## Not started

Phase 2 has not been started. `docs/PHASE2_DATABASE.md` is still a design note. The running application has no PostgreSQL client and no GitHub catalogue client.
