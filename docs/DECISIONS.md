# Decisions and discrepancies

Phase 0 decisions stay in force. Phase 1 notes are appended below and do not change the firmware audit.

## Order of precedence applied

1. Allowlisted source from `matter-dht11.zip`.
2. Pinned ESP-IDF v5.4.1 / host esp-matter checkout APIs.
3. Standalone implementation specification.
4. Addendum A: **not found as a file** in the workspace. Items attributed to it were taken from the specification text.
5. Figma: used for screen list only. The file could not be opened. See Phase 1 below.

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

## Phase 1

### Figma wireframes were not readable

`create_session` and `get_metadata` on file `ctgVnYSDl6CAmnc2sXTfKk` failed with no edit access. The desktop UI follows the specification’s nine screens (overview, pair, node details, library, builder, AI draft, OTA preflight, deployment record, settings). Layout, type, and colour were not checked against the frames.

### Mock boundaries

- Commissioning writes a local simulated node. `matterNodeId`, VID, PID, software version, and reachability stay null. No controller identity is created.
- Firmware packages in this phase are `SIMULATED.txt` records. Native and Docker modes return `toolchain_mode_unavailable`. ESP-IDF is not invoked.
- OTA preflight treats an unknown mandatory check as blocking. A simulated artifact fails the deployable-image check. The saved job is `blocked`, every stage is `not_observed`, and the node version is unchanged.
- AI drafts return HTTP 503. The rest of the app keeps working.

### Empty JSON body on maintenance actions

`POST /api/nodes/:id/refresh` and `POST /api/nodes/:id/commissioning-window` send no body. The UI was setting `Content-Type: application/json` anyway, and Fastify rejected the empty body. The client now sets that header only when a body is present.

### Blocked OTA save

`POST /api/ota/jobs` returns 409 with the job when preflight is not allowed. The preflight screen treats a `blocked` job as a saved record and does not also paint it as a request failure.

## Remaining issues

- Addendum A file still missing.
- Live SoftwareVersion on a board is unknown (expected 1 / `"1.0"` from CMake, not Kconfig 0).
- Host `esp-matter` git hash is not proven identical to the original author’s checkout.
- No board has been USB-flashed from this repository.
- Figma frames were not compared.
- `npm audit` still reports Vitest development advisories. The fix is Vitest 5, a major upgrade, and was not forced. See `docs/DEPENDENCY_AUDIT.md`.
- The IDE snapshot can still omit static cell names. The browser accessibility tree includes them.

### Table cells missing from the accessibility tree

The node-list action cell used `class="row"`, and `.row` sets `display: flex`. A table cell with a non-table `display` leaves the table formatting context. Chrome then dropped that row’s cells from the accessibility tree, which is why the snapshot showed the action links and not the node name, hardware, firmware, or reachability.

The actions now sit in a flex container inside the cell. Header cells use `scope`. Each table has a caption. After the change, the accessibility tree for the overview contains the table, caption, column headers, row headers, and cells, including “Bench H2 renamed” and “Not read”. Computed `display` on the settings header and value cells is `table-cell`.

### Figma

Still no edit access to file `ctgVnYSDl6CAmnc2sXTfKk`. Uncertainties that do not block the local shell: spacing, type, colour, and component visual style versus the wireframes. The implemented screens are the specification’s nine management screens. No sensor dashboard was added.

## Phase 2

### Version path

The reference image reports application `1.0` and Matter software version number 1 because CMake `PROJECT_VER_NUMBER` is 1. `CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER=0` is present and unused.

The modular image sets `CONFIG_APP_PROJECT_VER_FROM_CONFIG`, `CONFIG_APP_PROJECT_VER="1.0"`, and `CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER=1`, and the generated CMake file repeats `PROJECT_VER "1.0"` / `PROJECT_VER_NUMBER 1`. The compiled application string and the Matter GN version are therefore the same pair on both images. A later package that only updates the Kconfig number will follow the modular path.

### Dependency lock

The first modular attempt stored `idf_component.yml` on `iotedu_core`. The component manager then offered button 4.2.2 and rewrote the lock, including LCD and touch patch bumps. That binary is not the recorded result.

The generator now copies `reference/matter-dht11/main/idf_component.yml` onto generated `main/`. The recorded build downloaded button 4.1.6, printed the 4.2.2 notice, and left `dependencies.lock` equal to the reference (10,397 bytes).

### Inherited BSP dependencies

`esp_bsp_generic` still pulls the same LCD, touch, and LVGL managed components as the reference. They are inherited from the copied manifest. The application component set gained only `iotedu_core` and `iotedu_dht11` (135 components versus 137).

### Unused SHTC3 and PIR Kconfig

The reference sdkconfig still contains `CONFIG_SHTC3_I2C_SDA_PIN=4`, `CONFIG_SHTC3_I2C_SCL_PIN=5`, and `CONFIG_PIR_DATA_PIN=7` from `main/Kconfig.projbuild`. The DHT11 driver does not read them. Those symbols are absent from the modular sdkconfig. DHT11 data is `CONFIG_IOTEDU_DHT11_PIN=4`.

## Phase 3

### One version pair, written in every place that consumes it

A native package sets CMake `PROJECT_VER` and `PROJECT_VER_NUMBER`, and the generated sdkconfig sets `CONFIG_APP_PROJECT_VER_FROM_CONFIG`, `CONFIG_APP_PROJECT_VER`, and `CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER` to the same pair. The Matter OTA header is then created with `ota_image_tool.py create` using that number and string, and `ota_image_tool.py show` is checked against the application description. The application `.bin` is not treated as an OTA image.

### `esp_bsp_generic` stays

Factory reset still calls `bsp_iot_button_create` from `esp_bsp_generic`, then `app_reset_button_register`. The button component supplies the callback API used inside `app_reset`, and it does not provide `bsp_iot_button_create`. Replacing the manifest would change the button construction path and the dependency lock. The lock remains the byte copy of `reference/matter-dht11/dependencies.lock`. A build that rewrites the lock is rejected.

### One native build at a time

Each package has its own workspace, and a second invocation of that workspace is refused. The API also runs only one native compile at a time so two Matter builds do not compete for the host. Mock packages can still be created while a native build is running.

### API source scan

`apps/local-api/src/api.test.ts` scans `apps/` for flash, esptool, and subprocess usage. It previously also scanned `packages/`, which matched the comment that names `ota_image_tool.py` in the version-sdkconfig helper. The desktop and API sources are still the scan target. Mock artifacts remain `SIMULATED.txt` with `deployable: false`.
