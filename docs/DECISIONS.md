# Decisions and discrepancies

Phase 0 only. Nothing below is a claim that later phases are complete.

## Order of precedence applied

1. Allowlisted source from `matter-dht11.zip`.
2. Pinned ESP-IDF v5.4.1 / host esp-matter checkout APIs.
3. Standalone implementation specification.
4. Addendum A: **not found as a file** in the workspace. Items attributed to it were taken from the specification text.
5. Figma: not used in Phase 0 (no UI yet).

## Confirmed discrepancies

### Software version number 0 vs 1

`CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER=0` in the original generated `sdkconfig`, while CMake sets `PROJECT_VER_NUMBER 1`.

On ESP-IDF + this Matter SDK, `chip_config_software_version_number` uses `PROJECT_VER_NUMBER` unless `CONFIG_APP_PROJECT_VER_FROM_CONFIG` is set. That option is **not** set. Expected live Basic Information `SoftwareVersion` is therefore **1**, and `SoftwareVersionString` is **`"1.0"`** from `esp_app_get_description()`.

OTA header generation (if enabled) also uses `PROJECT_VER_NUMBER` / `PROJECT_VER`. The unused Kconfig `0` is the trap, not the runtime value.

**Still unverified on hardware.**

### DHT11 pin vs leftover SHTC3 Kconfig

Driver uses GPIO4. `Kconfig.projbuild` still has SHTC3 SDA default 4 from the upstream sensors example. Those Kconfig symbols are unused by the DHT11 driver.

### `esp_matter_ota.h` “not yet used”

Application source includes the header and does not call OTA APIs. Requestor start still happens inside `esp_matter::start` when `CONFIG_ENABLE_OTA_REQUESTOR=y`.

### `CONFIG_CHIP_OTA_IMAGE_BUILD` disabled

The original zip has `sensors.bin` but no Matter `.ota` container. Phase 3 must generate `.ota` with `ota_image_tool.py`; it cannot reuse an archive artifact that does not exist.

### LwIP IPv6 address count

Base defaults set 6; H2 overlay sets 8. Overlay wins.

### Host ESP-IDF layout

`$IDF_PATH/export.sh` failed: EIM stores the venv at `tools/python/v5.4.1/venv`, not `python_env/idf5.4_py3.10_env`. Baseline builds must use `IDF_ACTIVATE`. A v5.4.4 tree also exists on the host and is **not** the pinned toolchain.

Sourcing the EIM activator under `set -u` failed on unbound `ZSH_VERSION`. The baseline script now disables nounset while sourcing.

### Archive vs description

The zip matches an ESP32-H2 Matter-over-Thread DHT11 project named `sensors`, with GPIO4 and dual 4 MB OTA partitions. It also contains hundreds of megabytes of build artifacts and BSP/LCD transitive components that the application does not use directly.

### Test VID/PID

`0xFFF1` / `0x8000` and `CONFIG_ENABLE_TEST_SETUP_PARAMS=y` are development identifiers.

## Alternatives considered

- Importing `managed_components/` from the zip: rejected. Allowlist forbids it; Component Manager should resolve from `dependencies.lock`.
- Using host ESP-IDF v5.4.4: rejected. Lockfile and original build are v5.4.1.
- Treating original `sensors.bin` as a verified baseline for this repo: rejected. The binary was built on another tree; this repo must compile the imported sources.

### CHIP GN environment

`find_program(gn)` failed until pigweed CIPD `gn` was prepended from `$ESP_MATTER_PATH/connectedhomeip/connectedhomeip/.environment/cipd/packages/pigweed`.

GN configure then failed until `_PW_ACTUAL_ENVIRONMENT_ROOT` pointed at that `.environment` directory. The baseline script sets `PW_PROJECT_ROOT`, `PW_ROOT`, and `_PW_ACTUAL_ENVIRONMENT_ROOT` from `ESP_MATTER_PATH` rather than sourcing CHIP `activate.sh` (which would replace the IDF Python venv).

### Local binary matches archive binary size

This host’s `sensors.bin` is 1,591,552 bytes — the same size as `matter-dht11/build/sensors.bin` in the zip. That is size equality, not a byte-for-byte hash comparison.

## Remaining issues

- Addendum A file still missing.
- Live SoftwareVersion on a board is unknown (expected 1 / `"1.0"` from CMake, not Kconfig 0).
- Host `esp-matter` git hash is not proven identical to the original author’s checkout.
- No board has been USB-flashed from this repository.
