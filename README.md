# IoT.Edu

Local desktop node-management hub for ESP32-H2 Matter-over-Thread devices.

The application commissions nodes onto an **IoT.Edu Management** fabric, builds firmware from a local component catalogue, flashes a board over USB the first time, and deploys later images with Matter OTA. It does **not** display sensor readings, drive actuators, or replace Apple Home / Google Home / Alexa.

## Current status

**Phase 0 — source and environment validation.**

| Capability | Status |
|---|---|
| Reference firmware import (allowlist + hashes) | Done |
| Source audit | Done (`docs/SOURCE_AUDIT.md`) |
| Baseline ESP-IDF compile of imported sources | **Passed** (`sensors.bin` 1,591,552 bytes, 19% OTA slot free) |
| Desktop UI / local API | Not started |
| Modular DHT11 firmware | Not started (original sources preserved) |
| USB flashing / Matter controller / OTA Provider | Not started |
| PostgreSQL / GitHub catalogue | Explicitly out of scope |

## Supported platform (Phase 0)

- macOS host
- Node.js 22 LTS (observed 22.14.0) for later application work
- ESP-IDF **v5.4.1** via `IDF_PATH` (and `IDF_ACTIVATE` on Espressif EIM installs)
- `ESP_MATTER_PATH` pointing at an esp-matter checkout that contains `connectedhomeip/connectedhomeip`

Do not use a different IDF major/minor than 5.4.1 unless a later audit supersedes that pin.

## Repository layout (so far)

```text
iotedu/
├── docs/                         audit, decisions, later-phase placeholders
├── reference/matter-dht11/       imported allowlisted firmware sources
├── scripts/import_reference_firmware.py
├── scripts/baseline_build.sh
├── tests/test_import_reference_firmware.py
├── toolchain.lock.json
└── README.md
```

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
| `docs/ARCHITECTURE.md` | Planned local-first architecture (not implemented) |
| Remaining `docs/*.md` | Later phases; no unimplemented feature is marked complete |

## What this project will not do in the initial release

PostgreSQL, GitHub catalogue sync, cloud backend, mobile app, custom Thread Border Router, sensor dashboards, production Matter certification.
