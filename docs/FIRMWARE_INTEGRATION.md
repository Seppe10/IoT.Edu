# Firmware integration

**Phase 0: original sources preserved and compiled. No modular refactor yet.**

Working tree: `reference/matter-dht11/` (allowlisted files only).

## Behaviour to retain in later extraction

From `main/app_main.cpp` and drivers, a future core-stack must keep:

- `nvs_flash_init`
- Matter `node::create` with attribute and identify callbacks
- `temperature_sensor::create` and `humidity_sensor::create`
- OpenThread platform config when Thread is enabled
- `esp_matter::start`
- Fabric-removed commissioning window (`OpenBasicCommissioningWindow`, 300 s, DNS-SD only)
- Factory-reset button via BSP GPIO9 (still present despite comments saying it should be removed)
- OTA Requestor via stack config, not a direct `app_main` call
- DHT11 poll task publishing TemperatureMeasurement and RelativeHumidityMeasurement in Matter ×100 units

Phase 2 should replace in-app `dht11_init` / endpoint creation with a generated `iotedu_dht11_register` without changing those Matter attributes.

## Versioning (canonical source still missing)

Today versions come from CMake:

- `PROJECT_VER "1.0"`
- `PROJECT_VER_NUMBER 1`

Kconfig `CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER=0` is unused unless `CONFIG_APP_PROJECT_VER_FROM_CONFIG` is enabled. A later builder must emit one canonical number/string for CMake, Basic Information, and `ota_image_tool.py`.

## Pins

DHT11 data: GPIO4 (hardcoded). BOOT/factory reset: GPIO9. GPIO remapping and conflict detection are not implemented.

## Partition template

Keep `partitions.csv` and `sdkconfig.defaults` / `sdkconfig.defaults.esp32h2` layering. Dual OTA 0x1E0000 slots on 4 MB flash.
