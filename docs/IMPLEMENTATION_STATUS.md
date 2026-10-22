# Implementation status

Last updated: 2026-10-22 (Phase 4 USB write workflow; no board has been programmed).

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

## Phase 2

**Met for host compilation of the modular DHT11 firmware.** The reference tree `reference/matter-dht11/` is unmodified. `scripts/build_modular_dht11.sh` generated `firmware/out/dht11-node` and compiled it with ESP-IDF v5.4.1 and the same esp-matter tree used for the reference. The desktop app still builds mock packages only.

Both images target ESP32-H2, enable the OTA Requestor, set `CONFIG_MAX_FABRICS=5`, keep OpenThread enabled, keep the GPIO9 factory-reset button, and use the same `partitions.csv`. `dependencies.lock` is byte-identical (10,397 bytes). Managed component directories match (24 names). The IDF component list grew from 135 to 137 by adding `iotedu_core` and `iotedu_dht11`.

| | Reference | Modular DHT11 |
|---|---|---|
| Result | success, image on disk from the 2026-10-21 rebuild | success, 2026-10-21T12:08:28Z |
| `sensors.bin` | 1,591,552 bytes (`0x184900`) | 1,591,904 bytes (`0x184a60`) |
| sha256 | `7d52dcac6c55381c9813f39b8fd58485f7aab7a85f912f536a01be3a4f623d6a` | `427c7ce6cc1bab14e78ec28c74628cc93097f41005c9baa4845079bb62d665d0` |
| App description | `1.0`, project `sensors`, IDF `v5.4.1` | `1.0`, project `sensors`, IDF `v5.4.1` |
| Matter software version | `chip_config_software_version_number = 1` | `chip_config_software_version_number = 1` |
| Kconfig version | number 0, unused | number 1, `CONFIG_APP_PROJECT_VER="1.0"`, from-config enabled |
| OTA slot `0x1E0000` (1,966,080 bytes) | 374,528 bytes free (`0x5B700`, 19%) | 374,176 bytes free (`0x5B5A0`, 19%) |
| DHT11 data | hardcoded GPIO4 | `CONFIG_IOTEDU_DHT11_PIN=4` |

The modular image is 352 bytes larger. Both binaries fit the OTA slot with the same 19% free figure reported by `check_sizes.py`. Partition offsets are unchanged, so the two images are layout-compatible. Hashes differ, which this refactor is expected to do. Details and implications are in `docs/FIRMWARE_INTEGRATION.md` and `docs/DECISIONS.md`.

### Commands after the modular sources landed

```text
npm test          # 22 vitest tests, all passed
npm run typecheck # passed for all six workspaces
./scripts/build_modular_dht11.sh
```

| Suite | Result |
|---|---|
| `@iotedu/contracts` (2) | Passed |
| `@iotedu/catalog` (3) | Passed |
| `@iotedu/firmware-builder` (8) | Passed |
| `@iotedu/matter-controller` (1) | Passed |
| `@iotedu/local-api` (7) | Passed |
| `@iotedu/desktop-ui` (1) | Passed |
| Typecheck, all workspaces | Passed |
| Reference `sensors.bin` | Built |
| Modular `sensors.bin` | Built |
| Hardware | Not run |

The Vite production bundle was produced during Phase 1 finalisation. Phase 2 did not change UI sources.

## Phase 3

**Met for a native ESP-IDF build started through the local API and shown in the Firmware Builder.** Mock mode remains. Docker mode is rejected. The reference tree and the committed component sources were not modified by the builds. `esp_bsp_generic` was investigated and left in place; see `docs/DECISIONS.md`.

Two packages were compiled on 2026-10-21 with ESP-IDF v5.4.1. Both target ESP32-H2, keep the OTA Requestor, `CONFIG_MAX_FABRICS=5`, OpenThread, GPIO9 factory reset, DHT11 on GPIO4, the reference partition layout `8aec3f810b0c…`, and the reference dependency lock. Neither image was flashed or offered over Matter.

| | SoftwareVersion 2 / `1.1.0` | SoftwareVersion 3 / `1.2.0` |
|---|---|---|
| Job | `15de6997-2cde-4bbc-b745-c9054b02f3c4` | `9fe1c617-a099-41d8-9dea-ad6b4f8c262f` |
| Result | compiled | compiled |
| Duration | 662 s | 729 s |
| `sensors.bin` | 1,591,904 bytes | 1,591,904 bytes |
| `sensors.bin` sha256 | `d79605ff4ec584b2fc34d85e0cb9a77d173ea6c71a237e7504232585a8862ae0` | `502860b5edbe7e38abe047f3813941eef35247186cf95a1068f569cf15d4bb25` |
| App description | `sensors` `1.1.0` | `sensors` `1.2.0` |
| Matter `.ota` | 1,591,985 bytes, VID 0xFFF1, PID 0x8000, version 2 / `1.1.0` | 1,591,985 bytes, VID 0xFFF1, PID 0x8000, version 3 / `1.2.0` |
| OTA slot free | 374,176 bytes (19%) | 374,176 bytes (19%) |

The application images are the same length because the version occupies a fixed field. Their hashes differ, and the OTA headers carry different version numbers and strings. The `.ota` digest matches the application image. The application `.bin` is not marked deployable. Only `sensors.ota` is.

A GPIO9 request returned HTTP 400 with status `failed` and no artifacts. A simulated package stayed `SIMULATED.txt` and its download returned HTTP 409. After the API was stopped and started again on the same `DATA_DIR`, both compiled jobs were still `succeeded` / `compiled`.

### Commands after the native builder landed

```text
npm test          # 31 vitest tests, all passed
npm run typecheck # passed for all six workspaces
```

| Suite | Result |
|---|---|
| `@iotedu/contracts` (2) | Passed |
| `@iotedu/catalog` (3) | Passed |
| `@iotedu/firmware-builder` (12) | Passed |
| `@iotedu/matter-controller` (1) | Passed |
| `@iotedu/local-api` (12) | Passed |
| `@iotedu/desktop-ui` (1) | Passed |
| Typecheck, all workspaces | Passed |
| Native package `1.1.0` | Compiled through the API |
| Native package `1.2.0` | Compiled through the API |
| Hardware | Not run |

## Hardware verification

None. No USB write has been performed, no live commissioning, no live SoftwareVersion read, no Matter OTA transfer, no GPIO9 reset, and no DHT11 reading has been observed. Compilation, a valid OTA header, and a software flashing workflow do not satisfy `docs/HARDWARE_TEST_PLAN.md`.

## Phase 4

**Met for the software workflow.** The Firmware Builder can prepare a USB write of a compiled ESP32-H2 package. The local API uses the package `flasher_args.json` offsets and the individual images. It does not write the merged image, because that image’s padding covers NVS. Full-chip erase is rejected. Simulated packages are rejected. A finished write stays `compiled`; it is not marked hardware-verified.

No ESP32-H2 was programmed during this phase. Serial startup was not observed on hardware. The in-app checklist therefore stays pending.

### Commands

```text
npm test          # 45 vitest tests, all passed
npm run typecheck # passed for all six workspaces
```

| Suite | Result |
|---|---|
| `@iotedu/contracts` (3) | Passed |
| `@iotedu/catalog` (3) | Passed |
| `@iotedu/firmware-builder` (21) | Passed |
| `@iotedu/matter-controller` (1) | Passed |
| `@iotedu/local-api` (16) | Passed |
| `@iotedu/desktop-ui` (1) | Passed |
| Typecheck, all workspaces | Passed |
| USB write on a connected ESP32-H2 | Not run |
| Serial startup capture | Not run |

## Remaining limitations

- Docker builds are unavailable.
- The OTA Provider is not running, so a compiled `.ota` file still cannot be deployed. Preflight keeps unknown live checks blocking.
- USB writing is implemented for macOS and a compiled package. No board was written in Phase 4, so startup, Matter, OpenThread, DHT11, and GPIO9 remain pending.
- Test VID/PID and example DAC providers.
- `esp_bsp_generic` still pulls the same unused LCD/LVGL components. The dependency lock was not changed.
- Unknown Kconfig symbol `ENABLE_WIFI_AP` in defaults (warning only).
- Bluetooth commissioning, Thread dataset, and AI are not implemented.
- `npm audit` still reports Vitest 3.2.7, `@vitest/mocker`, and `tinypool`. The published fix is Vitest 5, which was not applied. See `docs/DEPENDENCY_AUDIT.md`.
- Figma pixel match is unverified.
- The IDE accessibility snapshot still omits some static table-cell names. Chrome’s accessibility tree exposes them after the table-cell display fix (`docs/DECISIONS.md`).

## Not started

Phase 5 has not been started. The Matter controller and OTA Provider are unchanged.

`docs/PHASE2_DATABASE.md` is a separate design note for a future PostgreSQL catalogue and GitHub client. The running application has no PostgreSQL client and no GitHub catalogue client.
