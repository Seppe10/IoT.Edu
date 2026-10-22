# Phase 7 hardware verification

Recorded 2026-10-22 on the macOS development computer. Automated software tests and physical hardware tests are listed separately. A simulated session is not used as a hardware result.

Phase 6 was committed as `86c1098` before this run. The software workflow does not complete Phase 7. Physical verification is still pending.

## Host evidence

`/dev/cu.*` contained only `cu.BLTH`, `cu.Bluetooth-Incoming-Port`, and `cu.WONDERBOOM2`. No `usbmodem`, `usbserial`, `wchusbserial`, or `SLAB_USBtoUART` device was present.

`GET /api/programmer/ports` returned `{"ports":[]}`. The Hardware verification screen showed “No USB serial device is connected” and left **Flash 1.1.0** disabled after the confirmation checkbox was turned on. No chip probe and no USB write were started.

The compiled packages remain in `data/phase3`:

| Package | Build | SoftwareVersion | Verification |
|---|---|---|---|
| 1.1.0 | `15de6997-2cde-4bbc-b745-c9054b02f3c4` | 2 | compiled |
| 1.2.0 | `9fe1c617-a099-41d8-9dea-ad6b4f8c262f` | 3 | compiled |

The simulated 1.1.0 record `4a967a4a-9ae3-42dc-8ced-8718ad0c3bcf` is not selectable for the write.

## Automated software tests

Re-run before the Phase 6 commit, with the Matter UDP port free: 61 vitest tests and all workspace typechecks passed. The Matter.js runtime test reopened the same controller root credential.

After the Phase 7 chip-probe tests were added, the suite was 63 tests. `@iotedu/firmware-builder` was 25. Typechecks passed. These tests do not program a board.

## Physical workflow

| Test | Expected | Actual | Status | Evidence | Corrective action |
|---|---|---|---|---|---|
| A1 | A USB serial device is present. | No allowed USB serial port is connected. | Blocked | `/dev/cu.*` listing and `GET /api/programmer/ports`. | Connect the ESP32-H2 with a data cable and detect the port again. |
| A2 | The connected chip reports ESP32-H2. | No board to probe. | Blocked | Probe was not called. | Run Confirm chip. Do not flash if the probe does not report ESP32-H2. |
| A3 | A compiled 1.1.0 package with a deployable `sensors.ota` is stored on this computer. | Software check, not a board: 1.1.0 / SoftwareVersion 2, build `15de6997-2cde-4bbc-b745-c9054b02f3c4`. | Pass | Build record in `data/phase3`. | None for the package. This does not program the board. |
| A4 | USB write of 1.1.0 finishes and leaves NVS and factory data in place. | Write not started. | Blocked | Flash stayed disabled. | Flash only after A2 passes. The programmer preserves NVS. |
| A5 | Serial output shows a boot banner and no panic. | No serial capture. | Blocked | No monitor session. | Monitor after a successful write. |
| A6 | Matter and OpenThread start, and the DHT11 task logs. | No serial capture. | Blocked | No monitor session. | Read the serial log. Do not infer these from a compile. |
| A7 | The serial banner reports firmware 1.1.0. | Version banner not captured. | Blocked | No monitor session. | Compare the banner with the package. |
| B1 | Apple Home commissions the board onto the HomePod mini Thread network, and temperature and humidity appear in Home. | Not observed. | Not tested | The application cannot see Apple Home. | Commission in Home after A passes. If Home rejects vendor 0xFFF1 / product 0x8000 or the example device certificate, record the error and do not factory-reset the board. |
| C1 | The stored Matter controller identity is still loaded. | The management identity is stored and will be reused. | Pass | `GET /api/controller/status`: `identityLoaded` true, `persisted` true, Matter.js 0.18.0. Public credential id `89541a1fad904d0567791e6562bd293f94082102`. | None. This is not a device CASE session. |
| C2 | A live CASE read returns SoftwareVersion 2 and the device vendor, product, and node id. | No management-fabric node is stored. | Not tested | `GET /api/nodes` has no live node. | Open a commissioning window in Apple Home and pair from IoT.Edu. Do not factory-reset on failure. |
| D1 | The device requests 1.2.0 and a later read reports SoftwareVersion 3. | No OTA job is stored. | Not tested | `GET /api/ota/jobs` is empty. | Run only after A, B, and C pass. Do not mark success from a transfer alone. |
| E1 | Recovery checks run only after A–D pass. | Not started. | Not tested | No update has been applied. | Do not interrupt a flash write or erase controller credentials. |

## What was not done

- No ESP32-H2 was detected, probed, or flashed.
- Apple Home commissioning was not attempted.
- No management fabric was added to a device.
- No Matter OTA transfer ran, and no device reported SoftwareVersion 3.
- Stage E was not started.
- Controller storage was not regenerated or deleted.

## Next action

Connect the ESP32-H2, open Hardware verification, and run Detect serial device. Continue only while each stage’s status comes from the board, Apple Home, or a live SoftwareVersion read.
