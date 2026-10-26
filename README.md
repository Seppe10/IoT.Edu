# IoT.Edu

Local desktop node-management hub for ESP32-H2 Matter-over-Thread devices.

The application commissions nodes onto an **IoT.Edu Management** fabric, builds firmware from a local component catalogue, flashes a board over USB the first time, and deploys later images with Matter OTA. It does **not** display sensor readings, drive actuators, or replace Apple Home / Google Home / Alexa.

## Current status

**Phase 7 — the ESP32-H2 is running firmware 1.3.0 and is on both Apple Home and the IoT.Edu management fabric.** The desktop UI is the Vite development server with the local API. It is not a packaged macOS application. Matter OTA has not been deployed. `hardwareVerified` remains false.

| Capability | Status |
|---|---|
| Reference firmware import (allowlist + hashes) | Done |
| Source audit | Done (`docs/SOURCE_AUDIT.md`) |
| Baseline ESP-IDF compile of imported sources | **Passed** (`sensors.bin` 1,591,552 bytes, 19% OTA slot free) |
| Desktop UI and local API | Done |
| Local JSON catalogue | Done (no PostgreSQL, no GitHub) |
| Modular DHT11 firmware | Compiled with ESP-IDF v5.4.1. Not hardware-verified |
| Native firmware builder and Matter OTA packaging | Done in software. Two packages, `1.1.0` and `1.2.0` |
| USB writing | Implemented for compiled packages on macOS. No board written yet |
| Matter management controller | Matter.js 0.18.0. Identity persists. Smart-home-first commissioning is implemented. No device has joined |
| Matter OTA Provider | Matter.js 0.18.0 provider, BDX, and local image storage. No device has requested an image |
| PostgreSQL / GitHub catalogue | Explicitly out of scope |

## Supported platform

- macOS host
- Node.js 22.14.0 or newer for the desktop app and API
- ESP-IDF **v5.4.1** via `IDF_PATH` (and `IDF_ACTIVATE` on Espressif EIM installs)
- `ESP_MATTER_PATH` pointing at an esp-matter checkout that contains `connectedhomeip/connectedhomeip`

Do not use a different IDF major/minor than 5.4.1 unless a later audit supersedes that pin.

## Repository layout

```text
iotedu/
├── apps/desktop-ui/              React + TypeScript desktop (Vite, 127.0.0.1:5173)
├── apps/local-api/               Fastify API (127.0.0.1:3847)
├── packages/contracts/           Zod request and record contracts
├── packages/catalog/             Read-only local catalogue
├── packages/firmware-builder/    Partition checks, native builds, and USB write planning
├── packages/matter-controller/   Mock management service (no controller identity)
├── catalog/manifests/            Component JSON
├── board-profiles/esp32h2.json
├── docs/
├── reference/matter-dht11/       imported allowlisted firmware sources
├── scripts/
├── tests/test_import_reference_firmware.py
└── toolchain.lock.json
```

## Run the desktop app

Requires Node.js 22.14.0 or newer.

```bash
npm install
npm test
npm run typecheck
npm run dev
```

The UI is at `http://127.0.0.1:5173` and proxies `/api` to `http://127.0.0.1:3847`. Records go to `DATA_DIR` when set, otherwise the OS application-support directory for IoT.Edu. The API refuses any bind host other than `127.0.0.1`.

## Import the reference zip

```bash
python3 scripts/import_reference_firmware.py "$HOME/matter-dht11.zip"
python3 -m unittest tests.test_import_reference_firmware -v
```

Set `MATTER_DHT11_ZIP` if the archive is not at `$HOME/matter-dht11.zip`. The importer refuses to overwrite modified sources without `--force`.

## Baseline firmware build

```bash
export IDF_PATH             # ESP-IDF v5.4.1
export ESP_MATTER_PATH      # esp-matter checkout
export IDF_ACTIVATE         # required on EIM hosts; path to activate_idf_v5.4.1.sh
./scripts/baseline_build.sh
```

`$IDF_PATH/export.sh` is the standard activator. This host’s EIM layout does not satisfy `export.sh`; see `docs/DECISIONS.md`.

Build trees (`build/`, `sdkconfig`, `managed_components/`) are gitignored.

## Documentation

| File | Role |
|---|---|
| `docs/SOURCE_AUDIT.md` | Zip inventory, hashes, firmware facts |
| `docs/IMPLEMENTATION_STATUS.md` | Commands, tests, blockers |
| `docs/DECISIONS.md` | Discrepancies and toolchain choices |
| `docs/ARCHITECTURE.md` | Phase 1 local API, UI, and storage |
| `docs/COMPONENT_CATALOGUE.md` | Local manifests and status rules |
| Remaining `docs/*.md` | Later phases; no unimplemented feature is marked complete |

## What this project will not do in the initial release

PostgreSQL, GitHub catalogue sync, cloud backend, mobile app, custom Thread Border Router, sensor dashboards, production Matter certification.
