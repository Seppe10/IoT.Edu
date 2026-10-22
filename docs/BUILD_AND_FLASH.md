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

## Desktop native build

With `IDF_PATH`, `ESP_MATTER_PATH`, and `IDF_ACTIVATE` set, the local API accepts `mode: "native"` for the verified DHT11 package. It writes an isolated workspace under `DATA_DIR/builds/<id>/workspace`, compiles it through `scripts/idf_exec.sh`, and stores artifacts under `DATA_DIR/builds/<id>/artifacts`.

The package contains the application image, bootloader, partition table, OTA data initialiser, merged USB image, Matter `.ota` image, `flasher_args.json`, sdkconfig, dependency lock, build log, and SHA-256 sums. `ota_image_tool.py create` and `show` supply the OTA header. The application `.bin` is not a Matter OTA image.

Mock mode still writes `SIMULATED.txt` and refuses download as firmware. Docker mode is rejected. A compiled package can be selected for USB writing. Matter OTA transfer is not started by the builder.

## USB writing

macOS uses the local ESP-IDF v5.4.1 tool through `scripts/idf_exec.sh`. The browser does not open the serial port. WebSerial was not used: the desktop UI is a page on `127.0.0.1`, and the reliable path on this Mac is the already installed tool with the package metadata.

The write command is built from `flasher_args.json`: chip `esp32h2`, the recorded flash mode, size, and frequency, and the recorded offsets for the bootloader, partition table, `ota_data_initial.bin`, and `sensors.bin`. Baud is fixed at 115200. The merged `usb-image.bin` is checked against those pieces and is not written, because its padding covers NVS, factory data, and the secure-cert partition.

`--erase-all`, `erase_flash`, and `erase_region` are rejected. NVS is not an argument. One write or monitor may use a given port at a time. The accepted port names are `/dev/cu.usbmodem*`, `/dev/cu.usbserial*`, `/dev/cu.wchusbserial*`, and `/dev/cu.SLAB_USBtoUART*`.

Before changing flash, the tool probes the connected chip and continues only when the probe reports ESP32-H2. The board is then reset into download mode. If that fails, hold BOOT (GPIO9), press and release RESET, release BOOT, and try again. After a successful write the tool hard-resets the board.

The serial monitor is optional and runs at 115200. Saved logs are redacted. Observed lines can mark boot, Matter, OpenThread, DHT11 task, and version checks. GPIO9 factory reset stays unknown until someone performs it on a board when it is safe. A successful write does not change the package from `compiled` to hardware-verified, and it does not commission a fabric.

No board was written from this application in Phase 4.

## Matter OTA image

The original reference project leaves `CONFIG_CHIP_OTA_IMAGE_BUILD` unset. Native packages create the `.ota` file after compilation with the pinned Matter SDK tool, using the same version number and string written into CMake and sdkconfig.
