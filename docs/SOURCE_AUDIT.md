# Source audit — `matter-dht11.zip`

**Status:** source import complete. Baseline compile of imported sources on this host: **Passed** (`scripts/baseline_build.sh` → `RESULT=success`). Hardware flash and live cluster reads: **not verified**.

Archive inspected without extracting build artifacts, `managed_components/`, `sdkconfig`, or `__MACOSX/`.

## Archive inventory

| Property | Observed |
|---|---|
| Archive name | `matter-dht11.zip` |
| Compressed size | 505,068,272 bytes (~482 MiB) |
| Uncompressed total | 1,593,474,662 bytes |
| Zip entries | 14,617 (11,971 files, 2,646 directories) |
| Top-level members | `matter-dht11/`, `__MACOSX/` |
| Enclosing directory | `matter-dht11` (supported by the importer) |
| Dominant extras | `.ninja`, `.obj`, `.png`, `build/`, `managed_components/` |

The archive contains a previously generated ESP-IDF build tree. That tree was **not** imported.

`project_description.json` inside the archive records an absolute developer path and `IDF_PATH` from the original machine. Those generated files stay out of version control.

## Import method

`scripts/import_reference_firmware.py`:

- Detects a single enclosing directory.
- Imports only the allowlist below.
- Rejects path traversal, Unix symlinks in zip metadata, duplicates, extra allowlist mismatches, and overwrite of modified files unless `--force`.
- Skips `__MACOSX/` and every non-allowlisted member, including `build/` and `managed_components/`.
- Writes SHA-256 hashes to `docs/source-import-report.json` using relative destination paths.

Imported location: `reference/matter-dht11/`.

## Allowlist and SHA-256

| Original relative path | SHA-256 | Size |
|---|---|---|
| `CMakeLists.txt` | `f52c4cb93322c9ed74e62bf55c172b45750b502afb6b27d8970fb51964baea66` | 1386 |
| `sdkconfig.defaults.esp32h2` | `dab703a8d278f6ab4e452c48e00732cc8fa06bcce985c256f25c8c6ad0fa7a8a` | 549 |
| `partitions.csv` | `235146db08d657522030042da8288cd18f069c07211b434a406a5f7e96403be7` | 551 |
| `sdkconfig.defaults` | `ff10578a754e0c958c9fd64fc066703f159a06479ba3c82d9bbb1dd81f9a6e91` | 1155 |
| `dependencies.lock` | `86d766fce6e730433be382c805a6a3679332cb38e56bf41f81618c73045a1115` | 10397 |
| `main/CMakeLists.txt` | `bcda095efa9a4295f1de6f7c9ec08e932f041ab502aba06bbdb14abb700b09e2` | 548 |
| `main/app_openthread_config.h` | `1b5a5008ae5744eba85f4ff671203357d35ae05172ed8880028fc68d06b43fbc` | 1504 |
| `main/idf_component.yml` | `3a71b33cd709d61a8107b6def58a90fb56a7adfdf52926320968f487bed906f4` | 241 |
| `main/app_main.cpp` | `6f8da2ebc69f0d154961deaf0f26973107595588602f936202e8772062614bb3` | 17793 |
| `main/Kconfig.projbuild` | `d0284d00d1de10487bb1ce862aeff540c4f5578859f4496c6e9eb64a823241a2` | 417 |
| `main/drivers/dht11.c` | `52c62933a4fa2ae05f6949ac4cdeaf096148dd32023e4cf354c560b7a02925c6` | 8022 |
| `main/drivers/dht11.h` | `1052a9e243504f70bf3470bd27bbbf917578e9c1bd60f9a03dc3c96b3331cd42` | 808 |

## Secret / path scan of imported sources

Imported allowlisted files contain **no** local usernames, absolute home paths, API tokens, or PEM private keys.

The **generated** `sdkconfig` and `build/project_description.json` inside the zip do contain absolute developer paths and default OpenThread test network parameters. They were not imported. Treat them as prototype-only if inspected later.

`dht11.h` has duplicated `#pragma once` / includes. Left unchanged.

## ESP-IDF target and version

| Item | Evidence | Value |
|---|---|---|
| Target | `sdkconfig.defaults.esp32h2`, archive `sdkconfig`, `dependencies.lock` | `esp32h2` |
| IDF version used to lock components | `dependencies.lock` `idf.version` | `5.4.1` |
| Original build IDF | archive `project_description.json` `git_revision` | `v5.4.1` |
| Host checkout used for Phase 0 | `IDF_PATH` env, EIM | `v5.4.1` |
| Additional host checkout **not used** | `esp/esp-idf` describe | `v5.4.4-1-ge33cc478aa` |

## Firmware project name

CMake `project(sensors)`. Archive artifacts: `sensors.bin`, `sensors.elf`, `sensors.map`.

`PROJECT_VER` = `"1.0"`. `PROJECT_VER_NUMBER` = `1`.

## `ESP_MATTER_PATH`

Root `CMakeLists.txt` **requires** `ESP_MATTER_PATH` and fails CMake if unset.

It then sets:

- `MATTER_SDK_PATH = ${ESP_MATTER_PATH}/connectedhomeip/connectedhomeip`
- `EXTRA_COMPONENT_DIRS`:
  - `${ESP_MATTER_PATH}/examples/common`
  - `${MATTER_SDK_PATH}/config/esp32/components`
  - `${ESP_MATTER_PATH}/components`

`main/CMakeLists.txt` privately includes `${ESP_MATTER_PATH}/examples/common/utils` (`app_reset.h`, `common_macros.h`).

Host `ESP_MATTER_PATH` observed revision: `2cb668c95de4f24786d20b7cb03c171d6e27b79e`. Connected Home IP describe: `v1.4.2.0-1652-g8f943388af`. The zip does not record the original esp-matter git hash.

## Dependencies and component registration

`main/idf_component.yml` declares:

- `espressif/cmake_utilities` `^1` only when `idf_version >=5.0` **and** `target in [esp32c2]` (so **not** applied for `esp32h2`).
- `esp_bsp_generic` `^3`.

`dependencies.lock` target `esp32h2`, manifest hash `8c1c1450a93571e04525267e4a2464d7f58258516b7da520b41a4c16edd72036`. Direct lockfile dependencies include BSP, delta OTA, encrypted image, RCP update, secure cert manager, JSON helpers, and mdns. Many LCD/LVGL packages are pulled in transitively by `esp_bsp_generic` even though this firmware is a sensor node.

Application sources registered as `SRC_DIRS "." "drivers"`.

## Custom partition table

`CONFIG_PARTITION_TABLE_CUSTOM=y`, filename `partitions.csv`, offset `0xC000`, flash size `4MB`.

| Name | Type | Offset | Size |
|---|---|---|---|
| `esp_secure_cert` | 0x3F | `0xd000` | `0x2000` encrypted |
| `nvs` | data/nvs | `0x10000` | `0xC000` |
| `nvs_keys` | data/nvs_keys | after nvs | `0x1000` encrypted |
| `otadata` | data/ota | after nvs_keys | `0x2000` |
| `phy_init` | data/phy | after otadata | `0x1000` |
| `ota_0` | app/ota_0 | `0x20000` | `0x1E0000` (1,966,080 bytes) |
| `ota_1` | app/ota_1 | `0x200000` | `0x1E0000` |
| `fctry` | data/nvs | `0x3E0000` | `0x6000` |

This is dual-OTA on 4 MB flash, matching the specification description.

Archive `flasher_args.json`:

| Image | Offset |
|---|---|
| bootloader | `0x0` |
| partition table | `0xc000` |
| otadata initial | `0x1d000` |
| application `sensors.bin` | `0x20000` |

Chip: `esp32h2`. Flash: DIO, 4MB, 48 MHz. Do not assume these offsets remain identical after a future rebuild.

## Matter OTA Requestor

- `CONFIG_ENABLE_OTA_REQUESTOR=y` in `sdkconfig.defaults` and generated `sdkconfig`.
- `CONFIG_OTA_AUTO_REBOOT_ON_APPLY=y`, delay 5000 ms.
- `CONFIG_CHIP_OTA_IMAGE_BUILD` is **not** set. The archive contains **no** `.ota` file.
- `app_main.cpp` includes `esp_matter_ota.h` with a comment “Not yet used”. OTA requestor start is still performed by `esp_matter` on `kDnssdInitialized` (`esp_matter_core.cpp` → `esp_matter_ota_requestor_start()`).
- `CONFIG_ESP_MATTER_OTA_PROVIDER_ENABLED` is not set (device is a requestor, not a provider).

Matter OTA container generation must use `connectedhomeip/connectedhomeip/src/app/ota_image_tool.py` in a later phase. That tool was found on the host checkout. Commands: `create`, `show`, `extract`, `change_header`.

## Matter fabric limit

Generated `sdkconfig`: `CONFIG_MAX_FABRICS=5`.

`sdkconfig.defaults` sets `CONFIG_LWIP_IPV6_NUM_ADDRESSES=6` with a comment `MAX_FABRIC + 1`. `sdkconfig.defaults.esp32h2` then overrides LwIP addresses to `8`. The H2 overlay wins for Thread.

## Thread / OpenThread

`sdkconfig.defaults.esp32h2`: OpenThread enabled, SRP client, native radio, Wi-Fi station disabled, CLI disabled, log level NOTE.

`app_openthread_config.h`: `RADIO_MODE_NATIVE`, `HOST_CONNECTION_MODE_NONE`, NVS storage partition `"nvs"`.

`app_main.cpp` calls `set_openthread_platform_config()` when `CHIP_DEVICE_CONFIG_ENABLE_THREAD` is defined.

Generated `sdkconfig` also contains default OpenThread test network name/keys. Those are SDK defaults, **not** imported, and must not be treated as a production Thread dataset.

## Commissioning

- BLE: `CONFIG_BT_ENABLED=y`, NimBLE, `CONFIG_ENABLE_CHIPOBLE=y`, `CONFIG_USE_BLE_ONLY_FOR_COMMISSIONING=y`.
- `CONFIG_CHIP_ENABLE_PAIRING_AUTOSTART=y`.
- `CONFIG_ENABLE_TEST_SETUP_PARAMS=y`, `CONFIG_USE_TEST_SERIAL_NUMBER="TEST_SN"`.
- VID `0xFFF1`, PID `0x8000` (Matter test identifiers).
- On `kFabricRemoved`, if fabric count is 0, opens a **basic** commissioning window for 300 s advertised with **DNS-SD only** (`kDnssdOnly`), not BLE.
- `CONFIG_SUPPORT_ADMINISTRATOR_COMMISSIONING_CLUSTER=y`.
- Factory DAC / commissionable data providers are the **example/test** providers, not `SEC_CERT_DAC_PROVIDER`.

Prototype-only credentials. Do not describe them as production provisioning.

## Factory reset

`factory_reset_button_register()` uses `bsp_iot_button_create` and `app_reset_button_register`.

H2 overlay: 1 GPIO button, `CONFIG_BSP_BUTTON_1_GPIO=9`, active low. Long-press 5000 ms from `sdkconfig.defaults`. GPIO9 is the ESP32-H2-DevKitM-1 BOOT button. Comments in `app_main.cpp` say the factory-reset button “Needs to be removed”; the call is still present.

## Device SoftwareVersion

Discrepancy investigation (Addendum A):

| Source | Value |
|---|---|
| CMake `PROJECT_VER` | `"1.0"` |
| CMake `PROJECT_VER_NUMBER` | `1` |
| Generated `CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER` | `0` (Kconfig default) |
| `CONFIG_APP_PROJECT_VER_FROM_CONFIG` | not set |

In the pinned Matter SDK `config/esp32/components/chip/CMakeLists.txt`:

- If `CONFIG_APP_PROJECT_VER_FROM_CONFIG`: use `CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER`.
- Else if `PROJECT_VER_NUMBER` is defined: use `PROJECT_VER_NUMBER`.
- Else: `0`.

Therefore **compiled** `CHIP_CONFIG_SOFTWARE_VERSION_NUMBER` is expected to be **`1`**, not `0`. `CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER=0` is unused unless that Kconfig option is enabled.

ESP32 `ConfigurationManagerImpl`:

- `GetSoftwareVersion()` returns `CHIP_CONFIG_SOFTWARE_VERSION_NUMBER` → expected **1**.
- `GetSoftwareVersionString()` copies `esp_app_get_description()->version` → expected **`"1.0"`** from `PROJECT_VER`.

If `CONFIG_CHIP_OTA_IMAGE_BUILD` were enabled, `ota-image.cmake` would stamp the OTA header with `PROJECT_VER_NUMBER` / `PROJECT_VER` (`1` / `"1.0"`), which would match the cluster — **not** the unused Kconfig `0`.

**Hardware verification pending:** the live Basic Information cluster has not been read from a running node in this repository.

## DHT11 pin assignment

Hardcoded in `main/drivers/dht11.c`:

```c
#define DHT11_PIN GPIO_NUM_4
```

Not a Kconfig option. `main/Kconfig.projbuild` still contains unused SHTC3 I2C defaults (SDA 4, SCL 5) and PIR default 7 from the upstream sensors example. SDA default 4 would conflict with DHT11 if that Kconfig were ever wired up. DHT11 does not currently read those symbols.

## Matter endpoints and clusters

Created in `app_main.cpp`:

1. Matter node via `node::create`.
2. `temperature_sensor::create` → Temperature Measurement cluster. Values published as Celsius × 100 (`int16`).
3. `humidity_sensor::create` → Relative Humidity Measurement cluster. Values published as percent × 100 (`uint16`).

A FreeRTOS task polls DHT11 every 2 s and updates those attributes on the Matter thread. IoT.Edu desktop software must **not** subscribe to those measurement clusters.

Root-node commissioning / OTA / descriptor clusters come from the esp-matter node template (not re-listed in application source).

`CONFIG_ESP_MATTER_MAX_DYNAMIC_ENDPOINT_COUNT=4`.

## Firmware size and OTA slot (from original archive, not this repo’s build)

| Artifact | Size |
|---|---|
| `sensors.bin` | 1,591,552 bytes |
| OTA slot `0x1E0000` | 1,966,080 bytes |
| Utilisation | 80.95% (below the 90% warning threshold) |
| Headroom | 374,528 bytes |
| bootloader.bin | 21,696 bytes |
| partition-table.bin | 3,072 bytes |
| ota_data_initial.bin | 8,192 bytes |

No Matter `.ota` image in the archive.

## Build and flashing metadata (archive)

- Flash size 4 MB, DIO, 48 MHz.
- Monitor baud 115200, RISC-V toolchain prefix `riscv32-esp-elf-`.
- Original compiler recorded as `riscv32-esp-elf` `esp-14.2.0_20241119`.
- `CONFIG_CHIP_OTA_IMAGE_BUILD` disabled.

## Baseline compilation (this repository)

**Passed** on 2026-10-21 with ESP-IDF **v5.4.1** and the host `esp-matter` checkout (`2cb668c9`, connectedhomeip `v1.4.2.0-1652-g8f943388af`).

| Result | Value |
|---|---|
| Command | `scripts/baseline_build.sh` |
| Duration | ~14.5 minutes after toolchain env was correct |
| `sensors.bin` | 1,591,552 bytes (`0x184900`) |
| OTA slot free | 19% (`0x5b700` of `0x1E0000`) |
| Flash map | `0x0` bootloader, `0xc000` table, `0x1d000` otadata, `0x20000` app |
| Matter `.ota` | not generated (`CONFIG_CHIP_OTA_IMAGE_BUILD` unset) |

Local `sensors.bin` size matches the original zip artifact (1,591,552 bytes).

Toolchain notes that blocked earlier attempts are in `docs/DECISIONS.md` (EIM `export.sh`, `gn` PATH, `_PW_ACTUAL_ENVIRONMENT_ROOT`).

## What was not done in Phase 0

- No modular refactor of the firmware.
- No desktop UI.
- No Matter controller.
- No USB flash of a board.
- Addendum A was not present as a separate file in the workspace; requirements attributed to it were taken from this specification.
