# Build and flash

## Toolchain

Pin ESP-IDF **v5.4.1**, target **esp32h2**. Set:

| Variable | Purpose |
|---|---|
| `IDF_PATH` | ESP-IDF v5.4.1 tree |
| `ESP_MATTER_PATH` | esp-matter tree with `connectedhomeip/connectedhomeip` |
| `IDF_ACTIVATE` | On Espressif EIM hosts: `activate_idf_v5.4.1.sh` |
| `IDF_TOOLS_PATH` | Tool install root when using EIM |

This host also has ESP-IDF v5.4.4 and v6.0. Do not use them for this project.

`$IDF_PATH/export.sh` failed here because EIM does not create `python_env/idf5.4_py3.10_env`. `scripts/baseline_build.sh` loads environment from `bash "$IDF_ACTIVATE" -e` and then runs `python "$IDF_PATH/tools/idf.py"`.

Docker builder: **not implemented**. Docker Engine 29.4.3 is present on the host but unused.

## Baseline command

```bash
export IDF_PATH ESP_MATTER_PATH IDF_ACTIVATE
./scripts/baseline_build.sh
```

Log: `docs/baseline-build.log` (gitignored).

**Baseline result (2026-10-21):** `RESULT=success`. `sensors.bin` 1,591,552 bytes; 19% free in the 0x1E0000 OTA slot. Required env: `IDF_PATH`, `ESP_MATTER_PATH`, `IDF_ACTIVATE`, plus pigweed `gn` and `_PW_ACTUAL_ENVIRONMENT_ROOT` which the script now sets from `ESP_MATTER_PATH`.

## Original archive flashing map (do not assume after a rebuild)

From zip `flasher_args.json`:

```text
0x0      bootloader/bootloader.bin
0xc000   partition_table/partition-table.bin
0x1d000  ota_data_initial.bin
0x20000  sensors.bin
```

Flash: ESP32-H2, DIO, 4MB, 48 MHz. Avoid full-chip erase by default. USB flashing of a live board is **Hardware verification pending**.

## Matter OTA image

Not produced by the original project (`CONFIG_CHIP_OTA_IMAGE_BUILD` unset). Later native builds must run `ota_image_tool.py create` and `show` from the Matter SDK. The application `.bin` is not an OTA image.
