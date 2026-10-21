# Firmware integration

**Phase 3: the desktop native builder compiles the modular DHT11 package. The reference tree stays unchanged.**

Working reference: `reference/matter-dht11/` (allowlisted sources only; not edited).

Generated application: `firmware/out/dht11-node/` (gitignored). `scripts/build_modular_dht11.sh` recreates that directory, then builds it with the same ESP-IDF v5.4.1 and esp-matter environment as the reference.

## Layout

| Piece | Path | Role |
|---|---|---|
| Reference application | `reference/matter-dht11/` | Original monolithic `sensors` project. Preserved byte-for-byte in git. |
| Core stack | `firmware/components/iotedu_core/` | NVS, Matter node, OpenThread, GPIO9 factory reset, `esp_matter::start`. |
| DHT11 driver | `firmware/components/iotedu_dht11/` | Single-wire driver plus temperature and humidity endpoints. |
| Generator | `packages/firmware-builder/src/workspace.ts` | Writes a clean workspace. Refuses any output directory inside the reference tree. |
| Entry point | generated `main/app_main.cpp` | `iotedu_core_prepare`, `iotedu_dht11_register`, `iotedu_core_start`. |

`main/idf_component.yml` in the generated workspace is a byte copy of `reference/matter-dht11/main/idf_component.yml`. The manifest stays on `main`. Putting it on `iotedu_core` made the component manager rewrite `dependencies.lock` (button 4.1.6 became 4.2.2, with LCD and touch patch bumps). That earlier binary was discarded. The recorded modular build keeps the reference lock.

## Behaviour retained

From the reference `main/app_main.cpp` and DHT11 driver:

- `nvs_flash_init`, with its return value ignored, as in the reference
- Matter `node::create` with the same attribute and identify callbacks
- `temperature_sensor::create` and `humidity_sensor::create`
- OpenThread platform config from a byte copy of `app_openthread_config.h` when Thread is enabled
- `esp_matter::start`
- Fabric-removed commissioning window (`OpenBasicCommissioningWindow`, 300 s, DNS-SD only)
- Factory-reset button via BSP GPIO9, long press 5000 ms
- OTA Requestor through `CONFIG_ENABLE_OTA_REQUESTOR=y`
- DHT11 poll task, stack 4096, priority 5, 2 s period, Matter units Celsius×100 (`int16`) and humidity percent×100 (`uint16`)

The desktop application does not subscribe to those measurement clusters.

## Versioning

Both compiled images embed application version `1.0`, project name `sensors`, and ESP-IDF `v5.4.1`. Both CHIP GN arguments set `chip_config_software_version_number = 1`.

The reference reaches that Matter number through CMake `PROJECT_VER_NUMBER 1`. Its generated `CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER=0` stays unused because `CONFIG_APP_PROJECT_VER_FROM_CONFIG` is unset.

The modular workspace sets all three together:

- CMake `PROJECT_VER "1.0"` and `PROJECT_VER_NUMBER 1`
- `CONFIG_APP_PROJECT_VER_FROM_CONFIG=y`
- `CONFIG_APP_PROJECT_VER="1.0"`
- `CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER=1`

`ota_image_tool.py` reads the CMake pair. Neither build enables `CONFIG_CHIP_OTA_IMAGE_BUILD`, so neither produced a Matter `.ota` file.

## Pins

`CONFIG_IOTEDU_DHT11_PIN` defaults to GPIO4 and accepts 0–27. The generator runs pin-conflict checks against `board-profiles/esp32h2.json` before writing the workspace. GPIO9 is rejected because it is the BOOT / factory-reset button. GPIO8 remains reserved as a strapping pin in that profile.

The reference `main/Kconfig.projbuild` symbols `CONFIG_SHTC3_I2C_SDA_PIN`, `CONFIG_SHTC3_I2C_SCL_PIN`, and `CONFIG_PIR_DATA_PIN` are not copied. The DHT11 reference driver does not read them. The modular image therefore has a single GPIO4 assignment, the DHT11 data pin.

## Partition template

`partitions.csv`, `sdkconfig.defaults`, and `sdkconfig.defaults.esp32h2` are copied from the reference. Dual OTA slots are `0x1E0000` on 4 MB flash. `ota_0` is at `0x20000`; `ota_1` is at `0x200000`. The partition table offset stays `0xC000`.

The copied partition CSV is the partition-layout id `8aec3f810b0c800a1540aedf84bf340721b8b47cc1569b8f2587add74669ef73`.
