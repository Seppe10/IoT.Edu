# Phase 7 hardware verification

Recorded 2026-10-22 on the macOS development computer. Automated software tests and physical hardware tests are listed separately. A simulated session is not used as a hardware result.

Phase 6 was committed as `86c1098`. The software workflow commit is `7499fa4`. USB installation of firmware 1.1.0 was performed on 2026-10-22. Apple Home commissioning of firmware 1.3.0 is recorded below. The IoT.Edu management fabric was installed by the Pair New Node screen at 23:51 and again at 23:52. Apple Home later removed fabric index `0x3`. Fabric index `0x4` remains, and the Pair New Node recovery at 00:07 stored the node record. Matter OTA has not started. The application record still has `hardwareVerified` false.

## Host evidence

The first scan, before the board was plugged in, found only Bluetooth serial devices. That scan is kept below. A later scan found the ESP32-H2.

## Earlier scan, no board



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

## USB session, 2026-10-22 19:44

New ports: `/dev/cu.usbmodem143401` (Espressif USB JTAG/serial, vendor `0x303a`, product `0x1001`) and `/dev/cu.usbmodem5AF61108281` (WCH USB serial, vendor `0x1a86`, product `0x55d3`). The write used `/dev/cu.usbmodem143401`.

Chip probe, repeated immediately before the write: `Chip is ESP32-H2 (revision v0.1)`, USB-Serial/JTAG, crystal 32 MHz. Programming session `ccfd7cb0-85a5-4012-ba85-6ea02ad88da9`. Package `15de6997-2cde-4bbc-b745-c9054b02f3c4`, firmware 1.1.0, SoftwareVersion 2. `eraseAll` is false. `nvsPreserved` is true.

Regions written, each with `Hash of data verified`:

| Offset | File | Bytes | Erase range reported by esptool |
|---|---|---|---|
| `0x0` | `bootloader.bin` | 21,696 | `0x00000000`–`0x00005fff` |
| `0xc000` | `partition-table.bin` | 3,072 | `0x0000c000`–`0x0000cfff` |
| `0x1d000` | `ota_data_initial.bin` | 8,192 | `0x0001d000`–`0x0001efff` |
| `0x20000` | `sensors.bin` | 1,591,904 | `0x00020000`–`0x001a4fff` |

No `erase_flash`, `erase_region`, or `--erase-all` appeared. The erased ranges do not include `esp_secure_cert` (`0xd000`), `nvs` (`0x10000`), `nvs_keys` (`0x1c000`), `phy_init` (`0x1f000`), or `fctry` (`0x3e0000`). The application ends at `0x1a4a60`, inside `ota_0`.

Serial monitor baud was 115200. The saved log is `data/phase3/programmer/ccfd7cb0-85a5-4012-ba85-6ea02ad88da9/serial-redacted.log`. The first capture attached while the board was already running. A later chip probe asserted RTS reset, which is not a factory reset, and the second capture includes the application boot.

Observed boot lines:

```text
I (530) boot: Loaded app from partition at offset 0x20000
I (551) app_init: Project name:     sensors
I (553) app_init: App version:      1.1.0
I (566) app_init: ESP-IDF:          v5.4.1
I (578) efuse_init: Chip rev:         v0.1
I (698) chip[DL]: NVS set: chip-counters/reboot-count = 11 (0xB)
I (798) chip[DL]: OpenThread started: OK
I (1278) chip[FP]: Fabric index 0x2 was retrieved from storage. Compressed FabricId 0xF39A15BCB96D066C, FabricId 0x0000000036854C93, NodeId 0x000000006BDC66A6, VendorId 0x1384
I (1358) chip[SVR]: Fabric already commissioned. Disabling BLE advertisement
I (1368) chip[SVR]: Server Listening...
W (2688) iotedu_dht11: DHT11 read failed: ESP_ERR_TIMEOUT
```

No Guru Meditation, panic, abort, or reboot loop was present. The ROM line `ESP-ROM:esp32h2` was not in the capture. The in-app version check looks for `App "sensors" version` and therefore stayed unknown; the captured line is `App version: 1.1.0`.

NVS was used after boot (`NVS set: chip-counters/reboot-count`). An existing Matter fabric was loaded from storage, so the flash did not clear Matter credentials. This session did not commission the board. OpenThread started. In the first capture it later logged `Role detached -> leader` after `Attach attempt 1, AnyPartition`. That is not an observation that it joined the HomePod mini network. Operational advertisement failed: `Failed to advertise operational node: 3`.

The DHT11 task is running on GPIO4 and polling. Every read logged `No response: low handshake` and `ESP_ERR_TIMEOUT`. `Failed to initialize DHT11 driver` did not appear. No temperature or humidity value was read.

## Physical workflow

| Test | Expected | Actual | Status | Evidence | Corrective action |
|---|---|---|---|---|---|
| A1 | A USB serial device is present. | `/dev/cu.usbmodem143401` and `/dev/cu.usbmodem5AF61108281` appeared. | Pass | `system_profiler` and `GET /api/programmer/ports`. | None. |
| A2 | The connected chip reports ESP32-H2. | Probe accepted. `Chip is ESP32-H2 (revision v0.1)`. | Pass | Probe of `/dev/cu.usbmodem143401` before the write. | None. |
| A3 | A compiled 1.1.0 package with a deployable `sensors.ota` is stored on this computer. | 1.1.0 / SoftwareVersion 2, build `15de6997-2cde-4bbc-b745-c9054b02f3c4`. | Pass | Build record and write plan. | None. This check is the package, not the board. |
| A4 | USB write of 1.1.0 finishes and leaves NVS and factory data in place. | Write succeeded. Four region hashes verified. Protected partitions were outside the erase ranges. | Pass | Session `ccfd7cb0-85a5-4012-ba85-6ea02ad88da9`. `hardwareVerified` remains false. | None for the write. |
| A5 | Serial output shows a boot banner and no panic. | Application loaded from `0x20000`. No panic or reboot loop. The ROM banner was not captured. | Pass | Second serial capture after RTS reset. | None. |
| A6 | Matter and OpenThread start, and the DHT11 task logs. | Matter server reached `Server Listening`. OpenThread logged `OpenThread started: OK`. Early DHT11 reads timed out. A later capture, at about 1190 s uptime, logged 24°C and 48%RH. | Pass for startup. Sensor reads recovered without a firmware change. | Serial log quoted above, plus the 2026-10-22 20:20 capture. | Leave GPIO4 unchanged. Confirm the wiring checklist below. |
| A7 | The serial banner reports firmware 1.1.0. | `App version: 1.1.0`, project name `sensors`, ESP-IDF v5.4.1. | Pass | `app_init` lines. | None. |
| B1 | Apple Home commissions the board onto the HomePod mini Thread network, and temperature and humidity appear in Home. | Not observed. | Not tested | The application cannot see Apple Home. | Commission in Home after A passes. If Home rejects vendor 0xFFF1 / product 0x8000 or the example device certificate, record the error and do not factory-reset the board. |
| C1 | The stored Matter controller identity is still loaded. | The management identity is stored and will be reused. | Pass | `GET /api/controller/status`: `identityLoaded` true, `persisted` true, Matter.js 0.18.0. Public credential id `89541a1fad904d0567791e6562bd293f94082102`. | None. This is not a device CASE session. |
| C2 | A live CASE read returns SoftwareVersion 2 and the device vendor, product, and node id. | No management-fabric node is stored. | Not tested | `GET /api/nodes` has no live node. | Open a commissioning window in Apple Home and pair from IoT.Edu. Do not factory-reset on failure. |
| D1 | The device requests 1.2.0 and a later read reports SoftwareVersion 3. | No OTA job is stored. | Not tested | `GET /api/ota/jobs` is empty. | Run only after A, B, and C pass. Do not mark success from a transfer alone. |
| E1 | Recovery checks run only after A–D pass. | Not started. | Not tested | No update has been applied. | Do not interrupt a flash write or erase controller credentials. |

## What was not done

- Apple Home commissioning was not attempted. The board already had a fabric in NVS from before this flash. That is not a new commissioning result.
- The device was not observed joining the HomePod mini Thread network.
- No IoT.Edu management fabric was added, and no CASE read of SoftwareVersion was made from IoT.Edu.
- No Matter OTA transfer ran, and no device reported SoftwareVersion 3 to IoT.Edu.
- Stage E was not started.
- No factory reset was performed. Controller storage was not regenerated or deleted.

## Diagnosis, 2026-10-22 20:20

No firmware was edited, rebuilt, or reflashed. No factory reset was performed. No Thread dataset was written. No Matter credential was deleted or replaced. The QR-code wizard, a second fabric, and OTA were not started.

### Existing Matter fabric

Confirmed from the boot log, which loaded the fabric from NVS after the USB write:

- The device considers itself commissioned. It logged `Fabric already commissioned. Disabling BLE advertisement` and `CASE Server enabling CASE session setups`.
- Commissioning mode was 0. `Updating services using commissioning mode 0` means the commissioning window is closed, and the device is not advertising as commissionable.
- One ACL entry was loaded.
- Stored fabric metadata: fabric index `0x2`, compressed fabric id `0xF39A15BCB96D066C`, fabric id `0x0000000036854C93`, node id `0x000000006BDC66A6`, vendor id `0x1384`.
- Vendor id `0x1384` is the value stored with that fabric. It is not sufficient to identify the commissioner. It is also not the firmware development vendor `0xFFF1`. This session does not establish that the fabric is the current Apple Home.
- The fabric can be retained. The flash left NVS in place, and the device loaded this fabric on the following boot. IoT.Edu has not joined it and has not opened a CASE session to this node. Reuse depends on a controller that already administers this fabric being able to reach the node on the Thread network stored in the device.

### Thread network

Confirmed from the first serial capture:

- OpenThread logged `OpenThread started: OK`, then `Setting OpenThread device type to ROUTER`.
- The role went `disabled -> detached`.
- At about 27.8 s it logged `Attach attempt 1, AnyPartition reattaching with Active Dataset`.
- At about 34.4 s it logged `Allocate router id 32`, then `Role detached -> leader`, partition id `0x66f1706`.
- `DuaManager: Failed to perform next registration: InvalidState` followed that transition. The task continued.

Becoming leader after an any-partition attach means the device did not find an existing partition for its stored dataset and formed its own. That is not attachment to the HomePod mini. The current boot was not reset again to recapture the role. Its early log shows `disabled -> detached` and the advertisement failure at about 1.4 s. The leader line above is from the preceding boot, which ran long enough to show the transition.

The serial log does not contain the Thread network name, PAN ID, extended PAN ID, or an IPv6 address. Those values were not read by another interface. The network key and PSKc were not printed or requested.

On the Mac, at the same time:

- `en0` has a route for `fd86:d11b:6356:1::/64` through `10.0.0.8`. The 20:20 note described that neighbor as an Apple device. That identification is withdrawn in the Phase 7B section: the host is the Google TV Streamer.
- A six-second `_meshcop._udp` browse on the LAN returned one border router: `Google Inc. Google TV Streamer #0A62`, network name `NEST-PAN-985A`. That name came from the Mac’s mDNS browse, not from the ESP32-H2.
- A HomeKit browse returned `Basestation A6F1137MA0673`. No service name containing HomePod mini was observed.
- The macOS application firewall is enabled. Multicast browse on `en0` still returned the records above. The firewall does not explain the device-side advertisement error.

Hypothesis at 20:20, corrected by Phase 7B: the ULA route belongs to the Google TV Streamer, not to a separate Apple border router. The device dataset still has not been matched to `NEST-PAN-985A`.

### Operational advertisement error 3

Confirmed in the installed ESP-Matter tree and the boot log:

- `CHIP_ERROR_INCORRECT_STATE` is `CHIP_CORE_ERROR(0x03)` in `src/lib/core/CHIPError.h`. The core part is 0, so the integer printed by this firmware is `3`.
- `DnssdServer::StartServer` logs the three failures. `AdvertiseOperational` first logs `Advertise operational node F39A15BCB96D066C-000000006BDC66A6`, which shows the fabric table is present, and then returns the error from `ServiceAdvertiser::Advertise`.
- `DiscoveryImplPlatform::Advertise`, `RemoveServices`, and `FinalizeServiceUpdate` all return `CHIP_ERROR_INCORRECT_STATE` when `mState` is not `kInitialized`. `InitImpl` sets `kInitializing` and returns success if `ChipDnssdInit` succeeds. `kInitialized` is set later, in `HandleDnssdInit`.
- On this OpenThread build, that callback is reached from the SRP client notification after the SRP host removal completes. `StartServer` did not log `Failed to initialize advertiser`. The captured log also has no `SRP Client was started` and no `SRP update succeeded`.
- Wi-Fi DNS-SD is not in this image. The 1.1.0 sdkconfig leaves `CONFIG_ENABLE_WIFI_STATION` unset, and the ESP32 platform config defines the Wi-Fi feature from that setting. Thread SRP is enabled.

The failure at 1.4 s happened while the role was still detached. It is the advertiser remaining in `kInitializing`, not a DNS-SD status code and not a rejected fabric credential. A later retry depends on the SRP client finishing initialization and posting `kDnssdInitialized`. No such retry was present in the captured windows. The separate Thread finding explains why that callback may never arrive: a single-node leader has no border-router SRP server. That link is the working explanation. A continuous log from 1.4 s through the leader transition was not captured on the current boot.

No firmware change is recommended for this error. The smallest next step is to determine whether the stored dataset is the intended HomePod network, without replacing it.

### DHT11

Confirmed:

- GPIO4 is the configured data pin. The boot log shows `GPIO[4]` as input, with pull-up and pull-down disabled. That matches `dht11_init`.
- GPIO8 remains the reserved strapping pin. GPIO9 is the factory-reset button and was configured as an input with pull-up. Neither is the sensor pin. No other GPIO claim for GPIO4 appeared.
- The driver drives GPIO4 low for 20 ms, releases it for 30 µs, then switches to input and waits up to 1000 µs for the sensor to pull the line low. The early log stopped at `No response: low handshake`, before bit timing or the checksum. The poll task waits 2 s before the first read and 2 s between reads.
- The internal pull-up is off. A bare four-pin DHT11 needs an external 4.7 kΩ to 10 kΩ resistor from the data pin to 3.3 V. A three-pin module usually includes that resistor. Power should be 3.3 V with a common ground. A 5 V data level is not suitable for this GPIO.
- At about 1190 s of uptime the same task logged `DHT11 Temperature: 24°C, Humidity: 48%RH` on four consecutive reads, and updated Matter temperature attribute 2400 and humidity attribute 4800. The driver and GPIO assignment can read this sensor. The early timeout was the sensor not pulling the line low. It is not a reason to move the pin or change the timing.

The part type, the presence of the external resistor, and whether the wiring was reseated after the first capture were not visually confirmed.

### Fixes

None applied. No destructive operation is proposed for approval yet.

Recommended, and not yet done:

- Leave the stored fabric, the Thread dataset, and firmware 1.1.0 in place.
- In Apple Home, look for the existing accessory before removing anything. Do not start a new commission while the window is closed and the node is leading its own partition.
- Confirm which border router is intended. The Mac currently sees the Google TV Streamer network `NEST-PAN-985A` and an Apple device routing a ULA. A HomePod mini service name was not observed.
- Confirm the DHT11 is a 3.3 V connection on GPIO4, with common ground and a pull-up, and leave it if the 24°C / 48%RH readings match the room.

### Verification of this diagnosis

| Check | Result |
|---|---|
| Boot of the flashed 1.1.0 image | Already observed. No panic or reboot loop. Not repeated. |
| OpenThread role | Leader of partition `0x66f1706` on the boot that was observed past 34 s. Current boot was left running. |
| Matter operational discovery from the Mac | Not observed. The device returned advertisement error 3, and no device IPv6 address was available to probe. |
| Existing fabric | Still loaded. Commissioning window closed. Not deleted. |
| DHT11 | Early reads timed out. Live reads at about 1190 s returned 24°C and 48%RH. |

## Phase 7B, 2026-10-22 20:28

No dataset was written. No credential was deleted. No factory reset, firmware edit, or reflash was performed. No commissioning window was opened. The QR-code wizard, a second fabric, and OTA were not started.

The Wi-Fi network observed on `en0` is `Juve4ever`. The ESP32-H2 was still running the same boot, at about 1520 s uptime, and was still logging DHT11 readings of 24°C and 48%RH. No new OpenThread role line was printed. The serial monitor was not used to reset the board.

### Thread border routers

One `_meshcop._udp` advertisement was present:

| Field | Value |
|---|---|
| Instance | `Google Inc. Google TV Streamer #0A62` |
| Host | `Android_NN8GBBNT.local` |
| IPv4 | `10.0.0.8` |
| Vendor / model | Google Inc. / Google TV Streamer |
| Network name | `NEST-PAN-985A` |
| Extended PAN ID | `7d026da3c59ccb20` |
| Partition ID | `0x5ae437d2` |
| Role from the state bitmap | leader |
| Thread interface | active |
| Backbone router | active and primary |
| Off-mesh prefix | `fd86:d11b:6356:1::/64` |

The network key, PSKc, border-agent id, and extended address were not recorded. The Mac route for `fd86:d11b:6356:1::/64` uses `fe80::ecb:47af:1ecb:dd5a%en0`, which resolves to this same Google host. The earlier description of `10.0.0.8` as an Apple device was an OUI guess and is withdrawn.

Other service browse results on the same LAN:

- `_matter._tcp` and `_matterc._udp`: browse started and returned no instances.
- `_airplay._tcp`: `Family room TV` is Sony model `XR-83A90J` at `Android.local` (`10.0.0.245`). `Master Bedroom` is model `AppleTV5,3` at `Master-Bedroom.local` (`10.0.0.128`). That model is an Apple TV HD and does not provide a Thread radio. No AirPlay instance with a HomePod model was present.
- `_hap._tcp`: `Basestation A6F1137MA0673`, model `VMB5000`, host `VMB5000-2.local`. This is not a HomePod.

No HomePod mini border router is visible. Apple and Google are not participating in two advertised Thread networks. The only advertised Thread network is `NEST-PAN-985A`. The Apple TV HD is on the same Wi-Fi and is not advertising MeshCoP.

The ESP32-H2’s observed partition was `0x66f1706`. The Google border router’s partition is `0x5ae437d2`. These are different partitions. The device’s own network name and extended PAN ID are still not available from serial output, so the stored dataset has not been compared byte for byte with `NEST-PAN-985A`. The different partition, after an any-partition attach using the stored dataset, shows that the device did not join the Google network.

### Existing Matter fabric

Unchanged and still loaded. One fabric was retrieved: index `0x2`, fabric id `0x0000000036854C93`, compressed id `0xF39A15BCB96D066C`, node id `0x000000006BDC66A6`, vendor id `0x1384`. One ACL entry is loaded. Commissioning mode remains 0. No second fabric line was logged, so fabric index 1 is not present.

Public vendor lists associate `0x1384` with Apple Keychain and `0x1349` with Apple Home. An Apple Matter engineer has described `0x1384` as the Connected Services fabric, which can remain after a device is removed from Apple Home. That association is not proof that this node is currently registered in this Apple Home. The absent index 1 is consistent with an earlier fabric having been removed, and it does not identify that missing fabric.

The operational instance `F39A15BCB96D066C-000000006BDC66A6` did not appear in `_matter._tcp`. No IPv6 address for the ESP32-H2 was observed, so no reachability test or CASE session was attempted. An existing administrator was not shown to be able to communicate with the node. The fabric, ACL, and commissioning records were left in place.

### Recovery options

A. The stored dataset is correct and the intended border router is unavailable.

- Evidence: the device has an active dataset, fails to find a matching partition, and becomes leader. No HomePod mini is advertising on this LAN. That is exactly what a correct Apple dataset does when its border router is off or out of radio range.
- Action: power the HomePod mini, join it to `Juve4ever`, and place it within Thread range of the ESP32-H2. Then recapture serial.
- Matter credentials: preserved.
- Thread dataset: unchanged.
- Apple Home commissioning: not repeated.
- Limit: if the HomePod is already on and in range, this option is no longer sufficient.

B. The stored dataset is stale and does not match the intended network.

- Evidence: the only visible Thread network is `NEST-PAN-985A`, and the device formed a different partition. This is also explained by option A if the intended network is an absent HomePod network. The device dataset itself was not read.
- Action: none until the HomePod has been checked. Do not copy the Google dataset onto the device.
- Matter credentials: can stay. A dataset change would still be a separate approval.
- Thread dataset: would change only if a later, approved migration is required.
- Apple Home commissioning: not required by this option alone.
- Limit: the running firmware has no Thread command interface, so the dataset cannot be inspected without a firmware change or a border-router log.

C. The stored fabric belongs to an older Apple configuration.

- Evidence: the only loaded fabric is index `0x2` with vendor `0x1384`. Apple Home’s vendor id `0x1349` is not present. Index 2 without index 1 fits a Keychain fabric left behind after the Home fabric was removed.
- Action: inspect Apple Home before concluding this. Do not delete the fabric from the device.
- Matter credentials: preserved while this remains a hypothesis.
- Thread dataset: unchanged.
- Apple Home commissioning: would have to be repeated only if Home no longer has the accessory and no Connected Services path can add a fabric.
- Limit: vendor id and fabric index do not prove the current contents of Apple Home.

D. The original administrator and Thread credentials are unrecoverable, so the device must be recommissioned.

- Evidence: not established. The Keychain fabric and the active dataset are both still on the device. No attempt has been made to reach the node from the iPhone that may still hold that fabric.
- Action: defer. Factory reset is the action that would make this option true by discarding the remaining credentials.
- Matter credentials: a factory reset deletes them.
- Thread dataset: a factory reset clears it.
- Apple Home commissioning: must be repeated after a reset.
- Limit: reset also closes the possibility of recovering the current fabric.

### Operational discovery

No connectivity change was made, so there is no recovered session to verify.

- OpenThread attachment to `NEST-PAN-985A` or to a HomePod network was not observed.
- The last observed role remains leader of partition `0x66f1706`. The current boot was not reset to reprint that line.
- No ESP32-H2 IPv6 address was available. The Mac can route the Google prefix `fd86:d11b:6356:1::/64`; that is the border router’s prefix, not a path to this node.
- DNS-SD initialization still has no observed completion. The captured windows contain no `SRP Client was started` and no successful operational advertisement.
- The existing fabric has not established an operational session.

### Earlier recovery proposal

The 20:28 proposal treated the stored fabric as something to recover. That is withdrawn. The board has not been commissioned into the intended Apple Home, and the stored fabric is not that home.

## First-time Apple Home plan, 2026-10-22 20:51

Nothing was erased. The QR-code wizard was not added. No factory reset was performed.

### HomePod mini

A second MeshCoP advertisement is now present, alongside the Google TV Streamer.

| | HomePod mini | Google TV Streamer |
|---|---|---|
| AirPlay instance | `Bedroom` | `Family room TV` is a Sony television, not this border router |
| AirPlay model | `AudioAccessory5,1` | not an Apple speaker |
| MeshCoP vendor / model | Apple / BorderRouter | Google Inc. / Google TV Streamer |
| Network name | `MyHome3` | `NEST-PAN-985A` |
| Extended PAN ID | `fe452b04d60d4efb` | `7d026da3c59ccb20` |
| Partition | `0xc3f97d13` | `0x5ae437d2` |
| Reported role | router, backbone router active and primary | leader, backbone router active and primary |

These are two Thread networks. `MyHome3` is the HomePod mini network and is the intended one. `NEST-PAN-985A` is not. The ESP32-H2’s last observed partition, `0x66f1706`, matches neither. A six-second serial sample at 20:51 produced no bytes, so a role change after the HomePod appeared was not observed.

The accessory is not expected to be listed in Apple Home.

### Why the commissioning window is closed

Firmware 1.1.0 booted with one fabric already in NVS, so it followed the commissioned path:

- `Server::Init` sees a non-zero fabric count, logs `Fabric already commissioned. Disabling BLE advertisement`, and does not open a commissioning window. The autostart path runs only when the fabric count is zero. `CONFIG_CHIP_ENABLE_PAIRING_AUTOSTART` is enabled, and the window it would open lasts `CONFIG_CHIP_DISCOVERY_TIMEOUT_SECS` (900 seconds).
- `esp_matter` then shuts down BLE because `CONFIG_USE_BLE_ONLY_FOR_COMMISSIONING` is set and a fabric exists.
- `iotedu_core` opens a window only after `kFabricRemoved`, and only when the fabric count is zero. That callback did not run.
- DNS-SD was updated with commissioning mode 0.

The stored record is fabric index `0x2`, vendor id `0x1384`. Public lists call that vendor Apple Keychain, which is not Apple Home’s vendor id `0x1349`. Its origin is otherwise unknown. It is not evidence that this board is in the intended home. While it remains, Apple Home has nothing to scan: BLE is off and the device is not commissionable.

### What has to be cleared

The unknown fabric cannot be kept for a first Apple Home commission. The iPhone cannot open a commissioning window on a fabric it does not administer, and this firmware will not open one itself while any fabric is stored.

The unknown Thread dataset should be cleared in the same operation. It did not join `MyHome3` or `NEST-PAN-985A`. Apple Home installs the current HomePod dataset during commissioning. Keeping the old dataset leaves the board on an unidentified network.

The supported operation that clears both is the GPIO9 factory reset already built into firmware 1.1.0. Holding BOOT for 5 seconds logs `Factory reset triggered`, and releasing it calls `esp_matter::factory_reset()`. That erases Matter fabrics, ACLs, and the Thread dataset from NVS, then reboots. It does not rewrite the application. The `fctry` partition is not the source of the onboarding code.

No smaller supported action is available. The running image has no command that deletes only the fabric.

This reset is proposed, not performed.

### Onboarding payload

`CONFIG_ENABLE_TEST_SETUP_PARAMS` and `CONFIG_EXAMPLE_COMMISSIONABLE_DATA_PROVIDER` are enabled. `CONFIG_ENABLE_ESP32_FACTORY_DATA_PROVIDER` is not. The passcode and discriminator are the public development values compiled into the image, not a per-device secret in `fctry`:

| Field | Value |
|---|---|
| Vendor / product | `0xFFF1` / `0x8000` |
| Discriminator | `0xF00` |
| Passcode | `20202021` |
| BLE QR payload | `MT:Y.K9042C00KA0648G00` |
| Manual code | `34970112332` |

The QR string was derived from those fields with BLE rendezvous and checked against the Matter test vector `MT:00000CQM00KA0648G00`. Firmware 1.1.0 does not print either code. The example DAC provider supplies the public development certificate for vendor `0xFFF1`, product `0x8000`. Apple Home can reject that certificate. The code is valid for this firmware only while a commissioning window is open. It does nothing while the current fabric keeps the window closed.

### Proposed wizard

Do not build it until the reset is approved. IoT.Edu cannot be the first commissioner: Matter.js has no Bluetooth commissioning, and the Pair page’s new-device path already says so. The wizard should show the QR and manual code above for the iPhone to scan, and it should say that the code is only useful during the 900-second window after a reset. It should not submit that code to `/api/nodes/commission`. The existing “already in a smart-home ecosystem” path remains the later secondary-administrator step, after Apple Home has joined the board to `MyHome3`.

### iPhone steps, after the reset is approved

Do not hold BOOT until that approval is given.

1. Keep the HomePod mini in `Bedroom` powered, on Wi-Fi `Juve4ever`, and near the ESP32-H2. Leave the Google TV Streamer out of the commissioning path.
2. In the Home app, confirm the sensor is absent. Do not try to add it before the reset.
3. Hold GPIO9 (BOOT) for 5 seconds. Release it when serial logs `Factory reset triggered` and then `Starting factory reset`.
4. Within 15 minutes of the reboot, in the Home app choose Add Accessory and scan `MT:Y.K9042C00KA0648G00`, or enter `34970112332`.
5. Let Home place the accessory on `MyHome3`. Do not select another network.
6. If Home rejects vendor `0xFFF1`, product `0x8000`, or the development certificate, stop and record the message. Do not reset again and do not start IoT.Edu secondary commissioning.
7. After the accessory is responsive in Home, secondary IoT.Edu commissioning is a separate later step. It is not part of this reset.

## Factory-reset button, 2026-10-22 21:02

The GPIO9 handler in the flashed 1.1.0 image is active. `sensors.bin` contains `Factory reset triggered` and `Starting factory reset`. The boot log configured `GPIO[9]` as an input with pull-up, then printed `IoT Button Version: 4.1.6`. There was no `Failed to initialize reset button`. The flashed sdkconfig sets `CONFIG_BSP_BUTTON_1_GPIO=9`, `CONFIG_BSP_BUTTON_1_LEVEL=0`, and `CONFIG_BUTTON_LONG_PRESS_TIME_MS=5000`. The ESP32-H2 Supermini pinout labels GPIO9 as BOOT. The button is active-low. The five-second timer starts when the pin goes low. The reset message is logged at about 5.0 seconds while the button is still held. `esp_matter::factory_reset()` runs only after the button is released.

Serial capture recorded four completed resets. The first one logged `Fabric (0x2) deleted`, `Role leader -> detached`, `Role detached -> disabled`, `Performing factory reset`, and `System restarting`. Each following application boot logged `App version: 1.1.0`, `Updating services using commissioning mode 1`, and `CHIPoBLE advertising started`. No stored-fabric line and no `AnyPartition` attach appeared after those reboots. The old fabric and Thread dataset were cleared by the button. No USB erase or reflash was used.

The last captured reset reason is `rst:0x15 (USB_UART_HPSYS),boot:0x4 (DOWNLOAD(USB/UART0))` followed by `waiting for download`. Boot value `0x4` means GPIO9 was low when the chip restarted, so the ROM entered download mode instead of the application. Holding BOOT across the software restart causes that. The application is not running while that ROM prompt is showing. Releasing BOOT and letting the chip reset without GPIO9 held returns it to the application.

No firmware change is required.

## Apple Home attempt, 2026-10-22 21:22

The iPhone reported “Adding to Home,” then “Unable to add accessory. Operation timed out.” The serial log shows the code was accepted and the device-side commission completed before Apple removed the Home fabric.

Observed order:

- An earlier failsafe expired and logged `Reverting Thread operational dataset` and `Commissioning failed, fail safe timer expired`. Bluetooth advertising then restarted.
- The iPhone connected over Bluetooth. PASE finished: `Commissioning completed session establishment step`.
- The device answered the PAI and DAC certificate requests. `AttestationRequest successful.`
- `AddNOC` created fabric index `0x1`. It was committed with vendor id `0x1349`, fabric id `00000000F1873B36`, node id `00000000810EEA37`.
- OpenThread changed `disabled -> detached -> router` on partition `0x6a6e089d`. Operational advertisement was logged for `8227167DF9D4746E-00000000810EEA37` with no advertisement error 3.
- `CommissioningComplete` was received. The device logged `Commissioning completed successfully`.
- Apple then added fabric index `0x2`, vendor id `0x1384`, fabric id `0000000036854C93`, compressed id `0xF39A15BCB96D066C`, node id `00000000F929B716`. That fabric id and compressed id are the same Keychain fabric that was stored before the factory reset. The node id is new.
- About 15 seconds later Apple sent `RemoveFabric` for fabric index `0x1` only. That deletion succeeded. Fabric `0x2` stayed, and DNS-SD remained in commissioning mode 0.

The development passcode, discriminator, and example certificate were not rejected. Attestation and both NOC installations succeeded. Vendor `0x1349` is the public Apple Home vendor id, recorded here from the committed fabric rather than inferred from the earlier Keychain vendor id.

Warnings in the same window, not the attestation result:

- Basic Information cluster `0x0028` attribute `0x000F` failed to read, error `586`.
- ICD Management cluster `0x0046` is absent. Those reads returned error `5c3`.
- `GetClock_RealTimeMS()` is unsupported, error `6c`.
- `DuaManager: Failed to perform next registration: NotFound`.

Apple’s timeout message matches the phone removing the Home fabric after the device had already joined Thread and stored both fabrics. The Keychain fabric remains, so the commissioning window is closed again. The Thread dataset from this attempt was committed with the successful `CommissioningComplete` and was not reverted by the later fabric removal.

No firmware was changed. No second factory reset was started.

## Apple Home attempt after the GPIO9 factory reset, 2026-10-22

Confirmed from the serial log of the Apple Home attempt after the GPIO9 factory reset. The last captured state before this attempt was a ROM download boot: BOOT was held across the restart, and the ROM waited for a download. The attempt below ran after the application was running again.

An earlier attempt on the same boot hit fail-safe expiry and reverted the Thread dataset. The record below is the following attempt. It completed on the device, and the commissioner then rolled the Apple Home fabric back. Waiting to start was not the cause of the timeout the iPhone showed. Bluetooth connected and commissioning completed.

The iPhone reached the board. Bluetooth connected. PASE completed. AttestationRequest succeeded. CSR and AddNOC succeeded.

The first fabric was index `0x1`, vendor `0x1349` (Apple Home), node id `0x00000000810EEA37`. OpenThread became router on partition `0x6a6e089d`. Operational CASE completed. The device logged `Commissioning completed successfully`.

A second AddNOC created fabric index `0x2`, vendor `0x1384`, fabric id `0x0000000036854C93`. That is the same Keychain fabric that existed before the factory reset.

About 15 seconds later the commissioner sent RemoveFabric for fabric index `0x1` only. That removal succeeded. Commissioning mode returned to 0. The Keychain fabric remained, so the commissioning window is closed.

The iPhone message was "unable to add accessory, operation timed out." The passcode and the development certificate were not rejected. Attestation succeeded. The accessory is not in Apple Home.

Nearby logs in the same window were not the attestation failure:

- Cluster `0x0046` unknown (ICD Management), error `5c3`.
- Serial Number read, error `586`.
- No real-time clock (`GetClock_RealTimeMS`).
- `DuaManager` `NotFound`.

No further factory reset, firmware change, secondary IoT.Edu fabric, or OTA was performed.

## Apple Home rollback diagnosis, 2026-10-22

Source: `/tmp/iotedu-factory-reset.log`, device uptime in milliseconds. Firmware 1.1.0, ESP-IDF v5.4.1, local ESP-Matter `2cb668c9`, connectedhomeip `v1.4.2.0-1652-g8f943388af`. No reset, reflash, or firmware edit was made for this diagnosis.

### Timeline of the completed attempt

An earlier attempt on the same boot is separate. At 857739 ms its fail-safe expired, `Commissioning failed (attempt 1): 32` (`CHIP_ERROR_TIMEOUT`), and the Thread dataset was reverted. The attempt below started after Bluetooth advertising had resumed.

| Uptime ms | Observed event |
| --- | --- |
| 876809 | BLE connected. |
| 878419 | PASE completed. Commissioning mode stayed 0. |
| 879169 | Reads of ICD Management `0x0046` returned IM status `0xC3` UnsupportedCluster (`err 5c3`). |
| 879349 | `ArmFailSafe` 60 s. Regulatory country set to `AU`. |
| 879559–880009 | PAI and DAC chain returned. `AttestationRequest successful.` |
| 882099–882439 | `CSRRequest` and `AddTrustedRootCertificate` succeeded. |
| 882619 | `AddNOC` created fabric `0x1`, compressed id `0x8227167DF9D4746E`, node `0x00000000810EEA37`, admin `0x000000009D20E657`. |
| 882889 | `ArmFailSafe` extended to 94 s. |
| 882989–883959 | OpenThread `disabled -> detached -> router`, partition `0x6a6e089d`. |
| 884049 | Operational SRP advertisement started. `Operational advertising enabled`. |
| 885609–886269 | CASE completed to peer `<000000009D20E657, 1>` at `FD7D:26D:A3C5:CB20:1465:B6C1:6F6C:F550:61555`. `GetClock_RealTimeMS` returned `0x6c` (`CHIP_ERROR_UNSUPPORTED_CHIP_FEATURE`); the session still became active. |
| 886339–886449 | `CommissioningComplete`. Fabric `0x1` committed, vendor `0x1349`, fabric id `00000000F1873B36`. Fail-safe disarmed. `Commissioning completed successfully`. BLE closed. |
| 886569–889049 | Same admin wrote, subscribed, and received reports. Every status response was `0x00`. |
| 889389–892159 | Fail-safe armed for 30 s. Second `AddNOC` created fabric `0x2`, vendor `0x1384`, fabric id `0000000036854C93`, node `0x00000000F929B716`. CASE to `<0000000071C381C5, 2>` completed. Fail-safe disarmed. |
| 892279 | Keychain session read Basic Information `0x0028` attribute `0x000F` and got IM status `0x86` UnsupportedAttribute (`err 586`). That attribute is SerialNumber. |
| 892899–896879 | A different fabric-1 node, `0x0000000089B46055`, completed CASE from the same IPv6 address and port, subscribed, and received reports with status `0x00`. |
| 900669–901249 | That node read again. Responses were acknowledged. No IM error was logged on this session. |
| 901269–901579 | The same node sent `RemoveFabric` for fabric index `0x1` only. Deletion succeeded. Commissioning mode stayed 0. The Keychain operational advertisement remained. |
| 922219 | `No suitable OTA Provider candidate found`, about 20 s after the removal. |

No Thread role change, detach, or restart occurred between the router transition and `RemoveFabric`.

### What this rules out

Operational CASE succeeded three times. The controller that removed the fabric had already subscribed. IPv6 to `FD7D:26D:A3C5:CB20:1465:B6C1:6F6C:F550` stayed up, and every status response on that session was success. Both fail-safes were disarmed before the removal, so this was not fail-safe expiry.

The network name and Extended PAN ID were not printed. Partition id alone does not identify `MyHome3`. The device became a router on the same partition it had joined after Apple wrote the dataset, and the first attempt detected the Thread SRP anycast server. It did not become leader of its own partition. That is evidence of a border router on the joined network. It is not a printed match to the name `MyHome3`.

SRP registration did not print a separate success callback on this attempt. Operational CASE arrived for both fabrics, so the controller resolved the operational service.

Adding vendor `0x1384` after vendor `0x1349` matches Apple’s documented Home-plus-Keychain commissioning (Espressif esp-matter issue 431 and Apple’s Matter accessories guide). The Keychain admin was not the node that sent `RemoveFabric`. Leaving the Keychain fabric in place is the documented result of removing only the Home service.

ICD Management is absent because the root node creates it only for an ICD server. UnsupportedCluster is the spec response. Attestation and both `AddNOC` commands succeeded, so the development certificate was not rejected during commissioning.

### Data model

Endpoint 0 is Root Node `0x0016` with Descriptor, Access Control, Basic Information, General Commissioning, Thread Network Commissioning, General Diagnostics, Administrator Commissioning, Operational Credentials, and Group Key Management. Endpoint 1 is Temperature Sensor `0x0302`. Endpoint 2 is Humidity Sensor `0x0307`. Apple’s current Matter accessory list includes temperature and humidity sensors. During this window the measured values were `2400` (24.00°C) and `4800`–`4900` (48–49% RH).

The generated cluster defaults set `MinMeasuredValue` and `MaxMeasuredValue` to `0`, which is a real value, not null. The DHT11 task updates only `MeasuredValue`. The device therefore reports 24.00°C and about 49% RH while declaring that both sensors can measure only 0. The Matter cluster specification requires `MeasuredValue` to lie between the non-null minimum and maximum. SerialNumber is not created by `basic_information::create`, so the Keychain read of attribute `0x000F` correctly returned UnsupportedAttribute. `CONFIG_USE_TEST_SERIAL_NUMBER="TEST_SN"` is not attached to that attribute. `CONFIG_ESP_MATTER_ENABLE_OPTIONAL_ATTRIBUTES` is not set.

The subscription payloads were not decoded, so the log does not show Apple naming the range or the serial number as its reason. The range mismatch is the concrete specification defect present in the attributes Apple had just read. The missing serial number is optional in the specification.

### Ranked cause

Apple’s second fabric-1 controller, node `0x0000000089B46055`, removed the Home fabric after a successful subscription. The device log contains no CASE, Thread, or fail-safe failure in that interval. The iPhone text “operation timed out” does not match the device timeline.

The most likely device-side cause is the temperature and humidity range: measured values outside a minimum and maximum of 0. The missing SerialNumber attribute is the next concrete gap and is not, by itself, a specification violation. Development attestation, the Keychain fabric, Thread attachment, and SRP are weaker explanations because those steps completed.

### Recommended next action

Do not factory reset and do not reflash yet. The smallest firmware correction, if approved, is to set the DHT11 ranges before `temperature_sensor::create` and `humidity_sensor::create` (0–50°C as `0` and `5000`, 20–90% RH as `2000` and `9000`) and to publish Basic Information SerialNumber. A retry of Apple Home commissioning requires another GPIO9 factory reset because fabric `0x2` keeps the window closed. That reset is not approved. Do not hold BOOT across the restart. The QR wizard, secondary IoT.Edu fabric, and OTA stay unstarted.

## GPIO9 hold, 2026-10-22 21:38

The five-second BOOT hold completed a factory reset. Serial logged `Factory reset triggered. Release the button to start factory reset`, then `Starting factory reset` about 1.1 s later. Fabric `0x2` was deleted, Thread persistent info was erased, and OpenThread went `router -> disabled`. The restart was `rst:0xc (SW_CPU),boot:0xc (SPI_FAST_FLASH_BOOT)`, so the application booted. `App version: 1.1.0` is unchanged. Reboot count is 1. No fabric was loaded, ACL entries are 0, and commissioning mode is 1. `CHIPoBLE advertising started`. The configured discovery window is 900 seconds from that boot. DNS-SD commissionable advertisement returned error 3 before any Thread dataset exists. Bluetooth advertising is the path Apple Home uses.

The sensor minimum and maximum on the installed 1.1.0 image are still 0. The 900-second window opened by this boot has expired. Firmware 1.3.0 is compiled below and has not been written.

## Firmware 1.3.0 prepared, 2026-10-22 23:01

The installed image is still firmware 1.1.0 / SoftwareVersion 2. Package `15de6997-2cde-4bbc-b745-c9054b02f3c4` is unchanged (`sensors.bin` sha256 `d79605ff4ec584b2fc34d85e0cb9a77d173ea6c71a237e7504232585a8862ae0`, 1,591,904 bytes). Package `9fe1c617-a099-41d8-9dea-ad6b4f8c262f` is unchanged (`sensors.ota` sha256 `82a43c2364e6ac34b117dd9455b3704149b1b3b8121b35f142c9bf922749fe32`). The corrected package is `072ead98-b30c-4114-ae9f-c317bd5979f7`, firmware 1.3.0 / SoftwareVersion 4, verification `compiled`. `hardwareVerified` remains false.

### Confirmed post-reset state

Re-read from `/tmp/iotedu-factory-reset.log` at the 21:38 hold, uptime 1,880,889 ms:

- `Factory reset triggered`, then `Starting factory reset` at 1,882,029 ms.
- `Fabric (0x2) deleted`.
- `Erasing Thread persistent info...`
- Restart `rst:0xc (SW_CPU),boot:0xc (SPI_FAST_FLASH_BOOT)`.
- `App version: 1.1.0`, project `sensors`, ESP-IDF v5.4.1, compile time Oct 21 2026 23:48:54, loaded from `0x20000`.
- Commissioning mode 1, `Advertise commission parameter vendorID=65521 productID=32768 discriminator=3840/15 cm=1`.
- `CHIPoBLE advertising started`.
- `Failed to advertise commissionable node: 3` before a Thread dataset exists. Bluetooth advertising is the path Apple Home uses.

The log does not print the Thread network key. A later line in the same capture, after a USB reset, still prints `App version: 1.1.0` and `Chip rev: v0.1`.

### Firmware changes

Temperature Measurement on the temperature-sensor endpoint is initialised to MinMeasuredValue `0` (0°C), MaxMeasuredValue `5000` (50°C), and MeasuredValue null. Relative Humidity Measurement is initialised to MinMeasuredValue `2000` (20% RH), MaxMeasuredValue `9000` (90% RH), and MeasuredValue null. A DHT11 reading outside those whole-degree and whole-percent bounds is logged and is not written. The installed Matter 1.4.2 data model accepts these bounds: temperature MinMeasuredValue is constrained to −273.15°C through 327.66°C and MaxMeasuredValue must be greater than the minimum; humidity MinMeasuredValue is at most 99.99% RH and MaxMeasuredValue is between the minimum and 100.00% RH. MeasuredValue must lie between the advertised minimum and maximum. The DHT11 operating range used here is 0–50°C and 20–90% RH.

Basic Information SerialNumber, attribute `0x000F`, is optional and at most 32 characters. The new image creates it. If NVS `chip-factory` / `serial-num` is empty, the first boot stores the base MAC as 12 uppercase hexadecimal characters and reuses that value afterwards. Factory reset clears `chip-config` and `chip-counters`, so this factory value survives GPIO9. The value has not been read back from the board.

`CONFIG_ENABLE_OTA_REQUESTOR=y`, `CONFIG_MAX_FABRICS=5`, `CONFIG_OPENTHREAD_ENABLED=y`, `CONFIG_BSP_BUTTON_1_GPIO=9`, and `CONFIG_BUTTON_LONG_PRESS_TIME_MS=5000` are present in the compiled sdkconfig. The application image contains `Factory reset triggered`. GPIO9 was not exercised on this image.

### Build and tests

Compiled with ESP-IDF v5.4.1. The package validation reported no issues. `sensors.bin` is 1,592,800 bytes (`0x184de0`), sha256 `abcaf92d055ea5bae5fe579c58a4b7bbda80364c1d6d782461ff5b9d66a80ce7`. The `ota_0` slot is `0x1e0000` bytes, leaving 373,280 bytes free. The image ends at `0x1a4de0`. `sensors.ota` is 1,592,881 bytes, sha256 `6da15542a230136049aae46257f4ba4c8401a1856cddc97fed1a86b9edb78e86`, header vendor `0xFFF1`, product `0x8000`, version 4, version string `1.3.0`. Partition layout `8aec3f810b0c800a1540aedf84bf340721b8b47cc1569b8f2587add74669ef73` matches the reference table.

SoftwareVersion 4 is higher than the installed SoftwareVersion 2 and the unused 1.2.0 SoftwareVersion 3. The vendor, product, and partition layout match, so 1.3.0 is a valid later OTA candidate for either package. OTA has not been started. OTA success still requires a live SoftwareVersion read.

Automated tests after the source correction: contracts 4, catalog 3, firmware-builder 30, matter-controller 12, local-api 18, desktop-ui 1. Total 68 passed. Typecheck exited 0.

### Proposed flash plan

`POST /api/programmer/plan` for build `072ead98-b30c-4114-ae9f-c317bd5979f7` and port `/dev/cu.usbmodem143401` returned this write, and nothing was written:

| Offset | File | Bytes |
|---|---|---|
| `0x0` | `bootloader.bin` | 21,696 |
| `0xc000` | `partition-table.bin` | 3,072 |
| `0x1d000` | `ota_data_initial.bin` | 8,192 |
| `0x20000` | `sensors.bin` | 1,592,800 |

`partition-table.bin` and `ota_data_initial.bin` are byte-identical to the installed 1.1.0 package (sha256 `c6539908b518612e4e8c25566a3d6b232f195b5f604390d9050bb24cd9b3561c` and `7d2c7ac4888bfd75cd5f56e8d61f69595121183afc81556c876732fd3782c62f`). Their contents do not need to change. The bootloader is the same length and a different hash (`94c9a306d968174ce71d3ea25cefcbdec68cf7ac4f2e372738f411b24b18aab3`). The supported programmer writes all four regions and has no application-only path. It preserves `nvs` (`0x10000`), `nvs_keys` (`0x1c000`), `esp_secure_cert` (`0xd000`), `phy_init` (`0x1f000`), and `fctry` (`0x3e0000`). The plan does not request a full-chip erase.

Tonight's `chip-id` attempts opened `/dev/cu.usbmodem143401` and received no ROM sync. `system_profiler` still shows the Espressif USB JTAG device, serial `48:31:B7:CF:3D:52`, at the location for that port. The serial capture of those resets shows chip revision v0.1 and then `rst:0x15 (USB_UART_HPSYS),boot:0x4 (DOWNLOAD(USB/UART0))` with `waiting for download`. No flash data was written. Flash size was not read again; the 19:44 probe and the 4 MB write remain the last esptool confirmation. Unplug and reconnect the board before another probe so the ROM leaves download mode. Release BOOT before that reconnect.

## Flash attempt, 2026-10-22 23:07

Approval was given to write package `072ead98-b30c-4114-ae9f-c317bd5979f7` after a successful chip probe. No image was written.

Ports present: `/dev/cu.usbmodem143401` (Espressif USB JTAG/serial, serial `48:31:B7:CF:3D:52`) and `/dev/cu.usbmodem5AF61108281` (WCH CH343, serial `5AF6110828`). The programming port is the Espressif device. `chip-id` on that port, with the default reset, with `no_reset`, and with `usb_reset`, each returned `No serial data received`. A six-second read of the Espressif port after a DTR/RTS pulse returned zero bytes.

The CH343 port is the application console. A five-second read showed the firmware still running, at about 5,131,552 ms uptime, logging `DHT11 Temperature: 24°C, Humidity: 49%RH` and writing Temperature Measurement `2400` and Relative Humidity Measurement `4900`. That uptime continues the 21:38 boot, so the reconnect did not reset the chip. The version banner was not reprinted. The 21:38 boot of this same run printed `App version: 1.1.0`.

The 1.3.0 bootloader differs from the installed 1.1.0 bootloader only by its compile timestamp (`Oct 22 2026 22:50:33` versus `Oct 21 2026 23:50:53`). Both are 21,696 bytes. The partition table and otadata remain byte-identical to the installed package. The desktop programmer cannot write the application alone; its plan always includes the bootloader, partition table, and otadata. The allowlisted `write-flash` command can write `sensors.bin` only at `0x20000`. That image ends at `0x1a4de0`, inside `ota_0`, and does not reach `ota_1` at `0x200000`. That is the intended write once the chip answers. It leaves NVS, NVS keys, the secure certificate, PHY data, factory data, otadata, and `ota_1` untouched.

## Application write, 2026-10-22 23:12

After BOOT was released, `chip_id` with `no_reset` on `/dev/cu.usbmodem143401` connected. The chip is ESP32-H2 revision v0.1, USB-Serial/JTAG, crystal 32 MHz. Base MAC `48:31:b7:cf:3d:52`. `flash_id` reported manufacturer `c8`, device `4016`, detected flash size 4 MB. The chip stayed in the bootloader.

`sensors.bin` from package `072ead98-b30c-4114-ae9f-c317bd5979f7` was checked before the write: 1,592,800 bytes, sha256 `abcaf92d055ea5bae5fe579c58a4b7bbda80364c1d6d782461ff5b9d66a80ce7`. The write was application-only:

```text
Flash will be erased from 0x00020000 to 0x001a4fff
Wrote 1592800 bytes (961211 compressed) at 0x00020000 in 12.9 seconds
Hash of data verified.
```

Settings were DIO, 4 MB, 48 MHz. No `erase_flash`, `erase_region`, or full-chip erase was used. The bootloader, partition table, otadata, NVS, NVS keys, secure certificate, PHY data, factory data, and `ota_1` were not written. The erased range ends at `0x1a4fff`, inside `ota_0`.

The board does not reset the CPU from the USB-JTAG RTS line. A later USB-JTAG sequence entered download mode again (`rst:0x15`, `boot:0x4`, `waiting for download`). A ROM soft reset then printed `user code done`. The first UART listener then lost the device (`Device not configured`) during the reconnect.

When the UART port returned, the application was already running at about 16.9 s uptime. It logged `DHT11 Temperature: 24°C, Humidity: 49%RH` and wrote Temperature Measurement `2400` and Relative Humidity Measurement `4900`.

## Boot captured, 2026-10-22 23:19

The next UART capture recorded a GPIO9 factory reset at 42,234 ms (`Starting factory reset`, Thread persistent info erased, `System restarting`), then a normal application boot. The reset was the button handler, not a host command. No panic, reboot loop, or partition error was logged.

```text
rst:0xc (SW_CPU),boot:0xc (SPI_FAST_FLASH_BOOT)
I (27) boot: ESP-IDF v5.4.1 2nd stage bootloader
I (27) boot: compile time Oct 21 2026 23:50:53
I (38) boot.esp32h2: SPI Flash Size : 4MB
I (776) boot: Loaded app from partition at offset 0x20000
I (800) app_init: App version:      1.3.0
I (804) app_init: Compile time:     Oct 22 2026 22:46:48
I (814) app_init: ESP-IDF:          v5.4.1
I (825) efuse_init: Chip rev:         v0.1
I (902) gpio: GPIO[9]| InputEn: 1| OutputEn: 0| OpenDrain: 0| Pullup: 1| Pulldown: 0| Intr:0
I (912) button: IoT Button Version: 4.1.6
I (912) gpio: GPIO[4]| InputEn: 1| OutputEn: 0| OpenDrain: 0| Pullup: 0| Pulldown: 0| Intr:0
I (942) chip[DL]: NVS set: chip-counters/reboot-count = 1 (0x1)
I (1532) chip[DMG]: DefaultAclStorage: 0 entries loaded
I (1562) chip[DIS]: Updating services using commissioning mode 1
E (1572) chip[DIS]: Failed to advertise commissionable node: 3
I (1622) chip[DL]: CHIPoBLE advertising started
I (33232) iotedu_dht11: DHT11 Temperature: 24°C, Humidity: 49%RH
```

The bootloader timestamp is the installed 1.1.0 bootloader. The partition table lists `esp_secure_cert`, `nvs`, `nvs_keys`, `otadata`, `phy_init`, `ota_0`, `ota_1`, and `fctry`. GPIO9 and GPIO4 were configured. DHT11 had repeated bit timeouts, then one reading of 24°C and 49% RH, written as `2400` and `4900`. No fabric was loaded. Commissioning mode was 1 and BLE advertising started. DNS-SD returned error 3 before a Thread dataset existed. The log did not print MinMeasuredValue, MaxMeasuredValue, SerialNumber, or the Matter SoftwareVersion number. There was no `Failed to enable Basic Information SerialNumber` and no `Stored stable Basic Information serial number`, so a serial already in `chip-factory` was reused. Its text was not read back. The desktop `hardwareVerified` flag was not changed.

The UART port dropped again at about 47 s. A later sample showed the same sensor readings at about 41 s uptime, so the board rebooted once more after that capture. That later banner was not recorded.

## Commissioning readiness, 2026-10-22 23:24

No firmware was changed and no host erase was performed. At 23:24:43 the UART log recorded `Starting factory reset` at 52,152 ms, then a software restart. The following boot is firmware 1.3.0:

- `App version: 1.3.0` at 23:24:44, loaded from `0x20000`, ESP-IDF v5.4.1, flash size 4 MB, chip revision v0.1.
- `DefaultAclStorage: 0 entries loaded`. No fabric was retrieved.
- Commissioning mode 1. `CHIPoBLE advertising started` at 23:24:44. The discovery timeout is 900 seconds, so this window closes at about 23:39:44.
- Advertised identity: vendor 65521, product 32768, discriminator 3840/15. `CONFIG_ENABLE_TEST_SETUP_PARAMS=y` and `CONFIG_EXAMPLE_COMMISSIONABLE_DATA_PROVIDER=y` are set in the 1.3.0 sdkconfig. The development payload remains `MT:Y.K9042C00KA0648G00`, manual code `34970112332`.
- DNS-SD commissionable advertisement returned error 3 before a Thread dataset exists. BLE is the commissioning path.

The Mac was first on Wi-Fi `Telstra9BD005`, where no border router was visible. After it joined `Juve4ever`, `_meshcop._udp` showed two routers: instance `Bedroom`, vendor Apple, model BorderRouter, network name `MyHome3`; and instance `Google Inc. Google TV Streamer #0A62`, vendor Google, network name `NEST-PAN-985A`. The intended network is `MyHome3`. AirPlay on the same browse showed `Master Bedroom`, which is the Apple TV, not the HomePod Thread router.

A reconnecting UART log is writing `/tmp/iotedu-commission-1.3.0.log`. Commissioning has not been started from this computer.

## Apple Home commissioning, 2026-10-22 23:32

The user commissioned the running 1.3.0 accessory into Apple Home on the HomePod mini network `MyHome3`. The UART log `/tmp/iotedu-commission-1.3.0.log` is the device evidence. No host erase, reflash, or factory reset was sent after that commissioning.

- 23:32:06 PASE finished: `Commissioning completed session establishment step`.
- 23:32:10 fabric index `0x1` was created by AddNOC. CASE admin subject `0x0000000015045ACE`. Operational advertisement returned error 3 before Thread was attached.
- 23:32:12 Thread role changed from detached to child. The SRP server was `fdfe:452b:04d6:0000:0000:00ff:fe00:fc10`, which matches the previously observed `MyHome3` mesh-local prefix. The device log did not print the network name.
- 23:32:13 fabric `0x1` was committed. FabricId `00000000F1873B36`, NodeId `0000000078728FA7`, VendorId `0x1349`. Fail-safe was disarmed. The log says `Commissioning completed successfully` and `Commissioning complete`. Vendor `0x1349` is Apple Home.
- 23:32:18 a second fabric, index `0x2`, was committed. FabricId `0000000036854C93`, NodeId `00000000BE5932E6`, VendorId `0x1384`. Vendor `0x1384` is Apple Keychain, not by itself a second Home fabric. CASE admin subject `0x0000000071C381C5`.
- 23:32:20 and 23:32:23 further CASE sessions became active, including one to node `0x0000000089B46055`.
- 23:32:26 Apple Home sent UpdateFabricLabel on fabric `0x1`.
- 23:32:39 Thread role changed from child to router. Partition ID `0x6a6e089d`. No later role change was logged through 23:40.
- Through 23:40 the log contains no `RemoveFabric` line. The only restart in this capture is the 23:24 GPIO9 factory reset, before commissioning. There is no panic. A later `RemoveFabric` is recorded in the secondary-commissioning section below.
- One CASE session became defunct at 23:33:15. Subscription resumption was scheduled, retry 1. At 23:39:00 resumption failed with Matter error `32` (timeout) and retry 2 was scheduled. That is a subscription retry, not removal of fabric `0x1`.
- DHT11 reads continued. At 23:40:23 the device wrote temperature `2500` (25°C) and humidity `4900` (49% RH). Checksum and timeout failures are still present between successful reads. Out-of-range values were not written.
- The user confirmed the accessory was added to Apple Home. This computer has not displayed the Home app. A live check that Home still shows the accessory, and that its temperature and humidity still update, is still required from the user before the IoT.Edu fabric is added.

The original development code `MT:Y.K9042C00KA0648G00` is no longer the code for adding IoT.Edu. Apple Home has to create a new multi-admin pairing code.

## Secondary-fabric application workflow, 2026-10-22 23:44

The Pair New Node screen now has the path `Add an existing Apple Home device to IoT.Edu`. It tells the user the accessory is already on Apple Home, asks them to turn on pairing mode, and accepts the new manual code or QR payload. The code is redacted from the audit log. The existing Matter.js controller is reused with `create: false`. Discovery is IPv6 only. Bluetooth commissioning and a Thread dataset write are not used.

The screen shows these states from the commission request: waiting for the Apple Home pairing code, discovering the commissioned device, establishing the pairing session, adding the IoT.Edu fabric, establishing the operational CASE session, verifying the firmware version, and confirming device management readiness. Discovery, pairing, and fabric installation are one Matter.js operation, so those three stay in progress together until that operation returns. A node record is stored only after CASE reads Basic Information, including SoftwareVersion. A simulated result does not mark those steps done. A failure shows the controller error and a recovery action: open pairing mode again, confirm the Mac is on the HomePod Wi-Fi, or remove a different fabric. The Apple Home fabric is not removed by this path.

Automated checks after this change: contracts 4, catalog 3, firmware-builder 30, matter-controller 15, local-api 19, desktop-ui 7. Total 78. Typecheck passed. The Matter.js runtime test was run with UDP 5540 free and reopened the same controller credential. These tests do not add the IoT.Edu fabric on the ESP32-H2.

The development UI at `http://127.0.0.1:5173` and the API at `http://127.0.0.1:3847` are how this workflow is exercised. A packaged macOS application has not been built or tested.

## Secondary commissioning diagnosis, 2026-10-22 23:51 and 23:52

The user opened pairing mode in Apple Home and submitted the new code through Pair New Node. The screen then said: “The operational CASE session did not confirm Basic Information, so no node record was stored.” The UART log shows that both attempts finished on the accessory. The application refused to store a node after `peers.commission()` returned. A second pairing created another fabric index. No factory reset, reflash, NVS erase, Thread credential change, or controller-identity replacement was performed.

### Stage outcomes

| Stage | 23:51 attempt | 23:52 attempt | Evidence |
|---|---|---|---|
| Pairing code validation | Confirmed success | Confirmed success | PASE started. An earlier closed window at 23:50:32 logged `Commissioning window is currently not open`, then `Commissioning window is now open`. |
| IP discovery | Confirmed success | Confirmed success | The accessory answered PASE and later recorded the controller at `UDP:[FD7D:26D:A3C5:CB20:1028:738F:83D2:AC2D]:5540`. |
| PASE | Confirmed success | Confirmed success | `Commissioning completed session establishment step` at 23:51:14 and 23:52:27. |
| ArmFailSafe | Confirmed success | Confirmed success | `Received ArmFailSafe (60s)`, then `Received ArmFailSafe (320s)`, on both attempts. |
| AddTrustedRootCertificate | Confirmed success | Confirmed success | `AddTrustedRootCertificate successful` at 23:51:16 and 23:52:30. |
| AddNOC | Confirmed success | Confirmed success | Index `0x3`, NodeId `0000000000000001` at 23:51:17. Index `0x4`, NodeId `0000000000000002` at 23:52:30. Both use compressed fabric `0x745ACA8E107DE368`, FabricId `51BAE80FE908827A`, VendorId `0xFFF1`. |
| Operational DNS-SD | Confirmed success for node 2 | Confirmed success | After the second attempt the Mac browse of `_matter._tcp` found `745ACA8E107DE368-0000000000000002` and the controller `745ACA8E107DE368-D00A481CC73D7929`. Lookup: `8288CC0BB0B689BE.local.:5540`. Node 1 was not advertised after Apple Home removed index `0x3`. |
| Operational CASE | Confirmed success | Confirmed success | `CASE Session established to peer: <D00A481CC73D7929, 3>` at 23:51:18 and `<D00A481CC73D7929, 4>` at 23:52:31. |
| CommissioningComplete and fail-safe disarm | Confirmed success | Confirmed success | `Received CommissioningComplete` and `Fail-safe cleanly disarmed` on both attempts. `Commissioning completed successfully`. |
| Basic Information, endpoint 0 | Confirmed success on the device during commissioning | Confirmed success on the device during commissioning | After each CASE the accessory received `IM:ReadRequest` (61 bytes) and replied. The application did not accept that result. See the application failure below. |
| SoftwareVersion | Not accepted by the application | Not accepted by the application | The device read succeeded during commissioning. The application did not persist SoftwareVersion until the later recovery. |
| Persisting the managed node | Confirmed failure | Confirmed failure | `nodes.json` stayed empty after both attempts. |

The application failure is separate from the device CASE result. Matter.js `peers.commission()` already calls `node.start()`. With `autoSubscribe: false`, the node state after a successful read is reconnecting, and `lifecycle.isConnected` is true only for an active subscription. The application treated `isConnected === false` as an offline CASE failure and used one message for both a missing CASE session and a missing Basic Information read. Optional attributes such as SerialNumber were not the cause. The API log for those attempts recorded only attestation warnings because the DCL was unavailable. No second CASE failure was logged after either `CommissioningComplete`.

### Fabric state

| Fabric | Vendor | Index | Node ID | State after 23:52 |
|---|---|---|---|---|
| Apple Home | `0x1349` | `0x1` | `0000000078728FA7` | Still present. No `RemoveFabric` for index `0x1`. |
| Apple Keychain | `0x1384` | `0x2` | `00000000BE5932E6` | Still present. No `RemoveFabric` for index `0x2`. |
| IoT.Edu | `0xFFF1` | `0x3` | `0000000000000001` | Installed at 23:51:18, then removed at 23:51:58. The command came from Apple Home’s CASE admin `0000000089B46055` on fabric index 1: `RemoveFabric Command for FabricIndex 0x3` and `RemoveFabric successful`. IoT.Edu did not send it. |
| IoT.Edu | `0xFFF1` | `0x4` | `0000000000000002` | Installed at 23:52:31 and still present. Same compressed fabric and FabricId as index `0x3`. |

The persistent controller was not replaced. Public identity: credential `89541a1fad904d0567791e6562bd293f94082102`, controller node `2XVHB4qPGqCzStkGpcwMn3SEjAskeYsS`, label `IoT.Edu Management`, Matter.js 0.18.0, root vendor `0xFFF1`, operational id `745aca8e107de368`. Private keys are not recorded here. Controller storage kept commissioned peers for node 1 and node 2. No Basic Information attribute files were stored with those peers, so a later start of an existing peer did not re-read them.

### Thread and IPv6

The device log never printed the Thread network name or Extended PAN ID. The SRP server prefix `fdfe:452b:04d6` matches the previously observed `MyHome3` mesh-local prefix. Partition ID `0x6a6e089d` is not used as proof of the network name. The Google TV Streamer advertises `NEST-PAN-985A`, Extended PAN `7d026da3c59ccb20`. The Mac’s source address toward the accessory is `fd7d:26d:a3c5:cb20:1028:738f:83d2:ac2d`, which is that Google mesh-local prefix, on Wi-Fi `Juve4ever` via interface `en0`.

`ping6` of the raw accessory address `fdeb:b688:4982:0:451c:6a61:cb50:8e2e` failed name resolution. `ping6` of `8288CC0BB0B689BE.local` succeeded: 2 of 2 replies, about 128–141 ms, from the Google-prefix source to the `fdeb` destination, hop limit 254. The route is a host route on `en0` through `fe80::cc6:87f4:8b22:4365%en0`. Operational DNS-SD showed the node 2 service on UDP 5540. The recovery CASE used that path. No mesh-local address of the accessory was required, and no Thread credential was changed.

### Application correction

`peers.commission()` is no longer followed by a second interpretation of `isConnected`. A reachable SoftwareVersion is enough to store the node. A CASE failure and a Basic Information failure now use different errors: `connection_failed` and `identity_read_failed`. If an unsaved commissioned peer already exists, another `commission()` is refused so a pairing code cannot create a third fabric index. Pair New Node shows `Verify existing IoT.Edu fabric` for that case. Recovery opens the stored controller with `create: false`, resumes CASE with the newest unsaved peer, reads Basic Information on endpoint 0, and stores a node only when SoftwareVersion is present. Startup no longer treats a peer read as a controller identity failure when no managed node is saved. Setup codes stay out of the node record and the audit log.

### Read-only recovery, 2026-10-23 00:07

The corrected Pair New Node screen was used. No pairing code was entered. **Verify existing IoT.Edu fabric** was clicked. The screen marked pairing, discovery, PASE, fabric installation, operational CASE, firmware verification, and readiness done. It reported SoftwareVersion 4 (`1.3.0`) and three commissioned fabrics.

Device evidence for that click:

- 00:07:50 `CASE Session established to peer: <D00A481CC73D7929, 4>` after `Sigma2Resume`.
- 00:07:50 `IM:ReadRequest` (61 bytes) from fabric 4 to node `0000000000000002`, then `IM:ReportData` replies and `status is 0x00`.
- No `AddNOC`, no `ArmFailSafe`, and no `RemoveFabric` during this recovery.
- DHT11 writes continued, including temperature `2400` and humidity `5100`.

`data/phase3/nodes.json` now contains one non-simulated node, id `732707e9-dd4f-43ee-823b-49f4a7e2ab1b`, name `ESP32-H2`, Matter node `2`, SoftwareVersion 4, software version string `1.3.0`, connection `reachable`, commissioned fabric count 3, other fabric count 2. Three fabrics match Apple Home, Apple Keychain, and IoT.Edu index `0x4`. The controller still has a stale peer record for node 1. That fabric index is gone. A later Pair New Node submission is blocked while that unsaved peer record remains, which avoids another AddNOC. Removing that stale record is a separate decision and has not been done.

`hardwareVerified` remains false. OTA has not started.

The first API restart after recovery walked every commissioned peer, including the removed node 1. At 00:10:30 the accessory logged `CASE failed to match destination ID with local fabrics` and `CASE Session establishment failed: 10` twice. Matter.js reported `NoSharedTrustRoots` and scheduled a long retry, so the API did not listen. Startup now refreshes only saved node records. At 00:13:15 that restart established `CASE Session established to peer: <D00A481CC73D7929, 4>`, read node `0000000000000002`, and received status `0x00`. No AddNOC and no RemoveFabric were logged. The API reports the stored identity loaded and node `ESP32-H2` reachable with SoftwareVersion string `1.3.0`.

### Tests

Re-run after the correction, with UDP 5540 free: contracts 4, catalog 3, firmware-builder 30, matter-controller 17 (including the runtime test that reopened the same stored credential), local-api 19, desktop-ui 8. Total 81. Workspace typecheck passed. The controller tests cover a failed CASE before a node is saved, a reachable CASE with SoftwareVersion missing, an existing fabric that blocks another `commission()`, recovery of the newest unsaved peer, and restart without reconnecting when no live node is saved. They do not factory-reset the board or remove an Apple Home fabric. Expired-window and fail-safe behaviour on the device is the UART evidence above: both IoT.Edu attempts disarmed the fail-safe, and a closed window was logged before each open window.

## Next action

Do not request another Apple Home pairing code. Fabric index `0x4` is already operational and the node record is stored. Confirm in the Home app that the accessory is still present. Do not factory-reset, erase NVS, reflash, change Thread credentials, or start OTA. A new pairing code is not required unless the stored fabric index `0x4` is later removed.

## Pre-OTA application integration, 2026-10-23

The sidebar order is Overview, Hardware Verification, Smart Home Connection, Pair New Node, Component Library, Firmware Builder, AI-Assisted Development, OTA Updating, Settings. Hardware verification no longer contains the Apple Home or OTA instructions. Those are on Smart Home Connection and OTA Updating. The development screens at `http://127.0.0.1:5173` were exercised. No packaged macOS app was built.

Hardware Verification listed both USB ports, selected the programming port `/dev/cu.usbmodem143401` and the console port `/dev/cu.usbmodem5AF61108281`, and selected the compiled 1.3.0 / SoftwareVersion 4 package. Flash Firmware stayed disabled because the chip was not probed. A probe can reset the USB interface, so it was not run on the working node. Full Flash Erase stayed disabled: the programming identity was not confirmed, and the application has no backup of the factory certificate data. Factory reset is guidance for a five-second GPIO9 hold plus a console capture. A button click does not mark it complete. No erase command was sent.

Smart Home Connection opened the existing-device path. It did not show the first-time QR until that section is opened, and it did not start commissioning. Thread network name remains Not observed. Pair New Node recognised Matter node 2 and SoftwareVersion 4 and did not ask for a new pairing code.

The first Reconnect click reported success while the accessory log showed no new read. Stored attributes were being treated as a live session. The controller now requires an endpoint 0 attribute report before it marks the node reachable. API startup at 00:42:45 established `CASE Session established to peer: <D00A481CC73D7929, 4>` and received a ReadRequest reply with status `0x00`. The Pair New Node **Reconnect Node** button then sent another ReadRequest on that session at 00:43:29, also status `0x00`. No AddNOC and no RemoveFabric were logged. Apple Home still exchanged reports on fabric index 1 at 00:40:51 and opened a CASE session at 00:42:42. The device evicted an old secure-session slot while the IoT.Edu session was established. That is not fabric removal.

The stored controller identity was not replaced. The stale node 1 peer record remains. Matter.js does not expose a peer-forget operation that was used here, and the credential store was not edited. A new pairing submission stays blocked so another fabric is not created.

OTA Updating shows the future stages and leaves Deploy disabled. A package at or below SoftwareVersion 4 is not offered as an upgrade. No OTA transfer started.

Automated tests before the final live-read correction: contracts 4, catalog 3, firmware-builder 30, matter-controller 17 including the runtime credential reopen, local-api 20, desktop-ui 13. Total 87. Workspace typecheck passed. After the live-read correction, the 16 matter-controller unit tests and that package typecheck passed again. The runtime test was not repeated while the API held UDP 5540. These counts mix simulated tests with the physical session above. `hardwareVerified` remains false.

### Standalone packaging

The working interface is still two development processes: `npm run dev -w @iotedu/desktop-ui` on `127.0.0.1:5173` and `DATA_DIR=data/phase3 PORT=3847 npm run start -w @iotedu/local-api`. Node.js 22.14 or newer is required. USB probe, write, and console capture need ESP-IDF v5.4.1 through `scripts/idf_exec.sh`. There is no signed `.app`, no embedded runtime, and no installer. A user who only opens a future packaged app would still need those host tools for flashing. Matter commissioning uses the persistent controller in `data/phase3/matter-controller` and does not require a separate script. PostgreSQL and GitHub catalogue sync are not implemented.

## First-time setup readiness, stopped before the physical reset

The sidebar is text only, in the same nine-item order. Status icons inside the pages were left in place.

A saved node is no longer shown as Online from `reachable: true` or an old CASE session. Online requires a Basic Information read completed by the current API process. Until that read finishes, the status is Unknown. A failed read stores Unreachable, keeps the last firmware version and the last successful time, and records the failure time. Credentials are not removed. The Overview Refresh button calls `POST /api/nodes/refresh-live`. The API also repeats that read about every 30 seconds, with a 60-second freshness window and one retry that starts a new CASE session if the first read fails. Each attempt is bounded at 45 seconds. Checks do not overlap.

On 2026-10-23 at 01:16:35 the restarted API established `CASE Session established to peer: <D00A481CC73D7929, 4>` and received ReadRequest replies with status `0x00`. Overview then showed Matter node 2, firmware 1.3.0 / SoftwareVersion 4, and Online. The Refresh button showed Checking, stayed disabled while the read ran, and recorded last refresh `2026-10-22T14:18:19.931Z`. A further ReadRequest at 01:18:38 came from the periodic check. No AddNOC and no RemoveFabric were logged. USB ports `/dev/cu.usbmodem143401` and `/dev/cu.usbmodem5AF61108281` were listed. The chip was not probed. Flash Firmware stayed disabled. The factory-reset watch was not started.

The controller identity was not replaced. Reconciliation, which has not been executed, lists Matter node 2 as the saved managed node and node 1 as an unsaved stale peer. After a confirmed factory reset, `ClientNode.delete()` is the supported local-only way to drop those peers. `ClientNode.decommission()` would send RemoveFabric and is not used. `Peers.erase()` is not used. Credential files are not deleted. There is no blocker that prevents the later physical test, but that test has not been approved.

The reinstall package is build `072ead98-b30c-4114-ae9f-c317bd5979f7`, firmware 1.3.0 / SoftwareVersion 4. Full flash erase stays disabled. No OTA transfer was started.

Automated results after this change: contracts 4, catalog 3, firmware-builder 30, matter-controller 19 plus the runtime credential reopen, local-api 21, desktop-ui 13. Workspace typecheck passed. These counts are simulated except for the physical CASE reads above.

The physical sequence Factory Reset, firmware reinstall, Apple Home commissioning, and a new IoT.Edu fabric has not started. Approval is still required before Hardware Verification’s “Watch for the factory-reset event” is used.

## Navigation and setup workflow, stopped before physical reset

The sidebar is now eight text-only items: Overview, Setup, Smart Home Connection, Pair New Node, Firmware Builder, AI-Assisted Development, OTA Updating, Settings. `/verify` redirects to `/setup`. `/library` redirects to `/builder?section=components`. Component Library is a section inside Firmware Builder, using the same catalog. AI-Assisted Development is unchanged and does not generate code or write to GitHub.

Overview keeps a Selected Node choice in `localStorage` key `iotedu.selectedNode.v1`. New Node shows Get Started and does not create a commissioned record. An existing node shows its name, hardware, Matter identifier, registration, firmware, presence, last success, last failure, and setup status, with OTA Updating and Re-flash Firmware only. The table actions are Refresh, Details, and Remove. Unknown includes Stale and Checking; the card tooltip says a stored Matter session is not Online. Online still requires a Basic Information read in the current API process.

Remove opens a confirmation that names the device. Decommission is offered only when presence is Online, then requires the node name before `ClientNode.decommission()` can remove IoT.Edu’s own fabric. Forget removes the local record and local peer with `ClientNode.delete()` and does not send RemoveFabric. Neither path was used on the physical node. Mock decommission is refused. The controller identity is not deleted.

Setup is the old Hardware Verification page. A new draft stays closed after hardware detection until Identify Hardware accepts the chip, the DHT11 environmental profile validates, and the user continues. The only verified profile is ESP32-H2, DHT11 on GPIO4, temperature and humidity clusters, Matter over Thread, and GPIO9 factory reset. GPIO9 and other profiles are rejected. A package without the DHT11 component is not treated as compatible. Validate & Flash Firmware opens a confirmation before any write. NVS and Matter fabrics stay. Diagnostics are under View Diagnostics. Connect to Smart Home stays disabled for a new draft until a write reports that firmware booted. An already online managed node can continue without a new write. Advanced Device Recovery is unchanged: the factory-reset watch stays disabled until its checkbox, and Full Flash Erase stays disabled.

Smart Home Connection order is Selected Node, First-Time Commissioning, Start Commissioning, then Already Connected to Apple Home. The development QR is shown only when the selected node’s firmware is 1.3.0 / SoftwareVersion 4. Start Commissioning does not open Apple Home. The HomePod is described as the Thread border router, not as a target for cluster uploads. Pair New Node still refuses another commissioning session when a valid IoT.Edu fabric is stored.

On 2026-10-23 at 02:19 the API was restarted so the Matter runtime test could use UDP 5540, then started again with `DATA_DIR=data/phase3` and `PORT=3847`. Startup established `CASE Session established to peer: <D00A481CC73D7929, 4>`. No AddNOC and no RemoveFabric were logged after that restart. The node record remains ESP32-H2, Matter node 2, firmware 1.3.0, presence online. Identify Hardware, Validate & Flash Firmware, factory-reset watch, Full Flash Erase, Remove confirmation, and OTA Deploy were not executed. Deploy stayed disabled.

Automated results: contracts 4, catalog 3, firmware-builder 30, matter-controller 21 plus the runtime credential reopen, local-api 22, desktop-ui 18. Workspace typecheck passed. These counts are simulated except for the startup CASE read above. The physical first-time reset and firmware reinstall has not started.
