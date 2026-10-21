# Implementation status

Last updated: 2026-10-21 (Phase 0 complete for source + baseline compile).

## Phase 0 gate

**Met for compilation.** Imported allowlisted sources built with ESP-IDF v5.4.1 into `sensors.bin`. Hardware flash, commissioning, and OTA remain pending.

## Files created

- `scripts/import_reference_firmware.py`
- `scripts/baseline_build.sh`
- `tests/test_import_reference_firmware.py`
- `tests/__init__.py`
- `reference/matter-dht11/` (12 allowlisted files)
- `docs/source-import-report.json`
- `docs/SOURCE_AUDIT.md`
- `docs/ARCHITECTURE.md` (planned)
- `docs/FIRMWARE_INTEGRATION.md` (no refactor yet)
- `docs/BUILD_AND_FLASH.md`
- `docs/MATTER_INTEGRATION.md` (not implemented)
- `docs/COMPONENT_CATALOGUE.md` (not implemented)
- `docs/SECURITY.md`
- `docs/HARDWARE_TEST_PLAN.md` (all pending)
- `docs/DECISIONS.md`
- `docs/PHASE2_DATABASE.md` (design only)
- `docs/IMPLEMENTATION_STATUS.md`
- `toolchain.lock.json`
- `README.md`
- `.gitignore`

Generated and **not** committed: `reference/matter-dht11/build/`, `sdkconfig`, `managed_components/`, `docs/baseline-build.log`.

## Functionality completed

- Safe zip import of the specification allowlist with hash report.
- Source audit of target, partitions, OTA requestor, fabrics, Thread, commissioning, DHT11 GPIO4, endpoints.
- Native baseline firmware compile on macOS.

## Commands executed

```text
python3 -c '...zipfile inventory of matter-dht11.zip...'
python3 scripts/import_reference_firmware.py <archive>
python3 -m unittest tests.test_import_reference_firmware -v
# 7 tests, OK

export IDF_PATH           # v5.4.1 via EIM
export ESP_MATTER_PATH    # host esp-matter checkout
export IDF_ACTIVATE       # activate_idf_v5.4.1.sh
./scripts/baseline_build.sh
```

Failed attempts (documented, then fixed):

1. `$IDF_PATH/export.sh` — EIM venv path mismatch.
2. Sourcing EIM activator from another script — `$0` check exits.
3. EIM `-e` PATH replaced `/usr/bin` — `tee` missing.
4. CHIP `gn` not on PATH.
5. Stale incomplete `build/` directory.
6. Missing `_PW_ACTUAL_ENVIRONMENT_ROOT` during `chip_gn` configure.

Successful build: `RESULT=success` at 2026-10-21T10:45:14Z, ~14.5 minutes.

## Tests

| Suite | Result |
|---|---|
| `tests.test_import_reference_firmware` (7 tests, including real zip hashes) | Passed |
| UI / API | Not written |
| Hardware | Not run |

## Hardware verification

None. No USB flash, no commissioning, no live SoftwareVersion read.

## Remaining limitations

- Desktop application does not exist yet.
- Firmware is the original monolithic `sensors` project; not modularised.
- No Matter `.ota` image (flag unset in both original and local sdkconfig).
- Test VID/PID and example DAC providers.
- `esp_bsp_generic` pulls unused LCD/LVGL components.
- Unknown Kconfig symbol `ENABLE_WIFI_AP` in defaults (warning only).

## Exact next steps (Phase 1)

1. Scaffold the npm workspace: `apps/desktop-ui`, `apps/local-api`, `packages/contracts`.
2. Implement local JSON repositories and mock Matter/build capabilities.
3. Implement the nine Figma screens against the local API, with no sensor dashboard.
4. Load a local catalogue with DHT11 as experimental and other drivers as planned/template.
5. Keep native commissioning/OTA capabilities marked unavailable until Phases 5–6.
