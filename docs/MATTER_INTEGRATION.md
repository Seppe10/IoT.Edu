# Matter integration

**Phase 5 software is in place. No physical node has been commissioned.** Findings below mix the firmware audit with the Matter.js 0.18.0 controller. Hardware verification is still pending.

## Device side (reference firmware)

- Transport: Matter over Thread on ESP32-H2, BLE used only for commissioning (`CONFIG_USE_BLE_ONLY_FOR_COMMISSIONING`).
- Pairing autostart enabled; test setup parameters enabled; VID `0xFFF1`, PID `0x8000`.
- OTA Software Update Requestor enabled; device is not an OTA Provider.
- Administrator Commissioning cluster supported.
- After the last fabric is removed, a 300 s basic commissioning window is opened with DNS-SD advertisement only.
- Management UI must not subscribe to TemperatureMeasurement or RelativeHumidityMeasurement.

## Controller

Pinned package: `@matter/main@0.18.0`, which loads `@matter/node@0.18.0`. The controller is a `ServerNode` whose root endpoint includes `ControllerBehavior`. The fabric label is **IoT.Edu Management**. `peers.commission` joins an existing device. `autoSubscribe` is false. The structure read passed to commissioning is endpoint 0 only, so Temperature Measurement and Relative Humidity Measurement are not subscribed and are not read.

APIs used:

- `ServerNode.create` / `start` / `close`
- `ServerNode.RootEndpoint.with(ControllerBehavior)`
- `peers.commission({ pairingCode, autoSubscribe: false, discoveryCapabilities: { onIpNetwork: true, ble: false } })`
- `ClientNode.start` for the CASE session, then `act` to read Basic Information, Operational Credentials, and the OTA Software Update Requestor when those clusters are present
- `openEnhancedCommissioningWindow` when a managed node is asked to share with another administrator
- `@matter/nodejs/config` so Matter.js does not install process signal handlers or set `process.exitCode`

Storage is `$DATA_DIR/matter-controller`, not `~/.matter`. The public credential id is the certificate authority root key identifier. A Matter fabric id appears after a fabric exists. The first identity is created only from Settings. A later start reopens the same files. Corrupt or partial storage is not replaced.

### Workflow 1 — smart-home first

Implemented. The user enables pairing on the existing controller, pastes the code, and IoT.Edu commissions over the existing IP network. A CASE session that reads administrative attributes is stored. A failed discovery or a full fabric table does not create a node and does not factory reset the device.

### Workflow 2 — management first

Not available on this host. Bluetooth commissioning is not in the installed Matter.js packages, and no Thread operational dataset is stored. The screen says so. The application does not simulate a join and does not create a second Thread network.

## Recovery

Stop IoT.Edu. Copy `matter-controller` from the data directory to an encrypted location outside Git. Restore that copy to the same path while IoT.Edu is stopped. If the copy cannot be loaded, do not delete the device’s fabrics from this application. An administrator that is still commissioned, such as Apple Home, can open a new Matter pairing window. IoT.Edu can then join again after a new management identity is created deliberately. A failed commissioning attempt does not factory reset the node.

## OTA Provider

Not implemented. It must use Matter OTA/BDX on the management session, and the image metadata must match the compiled VID, PID, and SoftwareVersion. It must not subscribe to sensor measurements.

## What the automated tests cover

These checks run without a board:

- The controller identity file is created once, mode `0700`/`0600`, and a second create does not generate a new identity.
- A corrupt identity file or stray credential files are left in place.
- Opening Matter.js with a missing credential store throws and does not create a replacement.
- A real Matter.js process reopens the same root credential id and the same root key bytes. This test binds UDP port 5540, so it cannot run while the desktop API is already listening.
- Invalid pairing codes, discovery failures, and a full fabric table do not save a node.
- A successful fake session stores only the administrative fields the transport returned.
- The new-device path reports missing Bluetooth and a missing Thread dataset and does not call commissioning.
- Source scans reject Temperature Measurement, Relative Humidity, On/Off, and Level Control in the controller and the node screen.
- API responses keep a sharing code in its own fields and redact the same code from errors.

## What requires a physical ESP32-H2

Nothing below has been observed:

- CASE to a device, including after an application restart.
- A SoftwareVersion, Vendor ID, Product ID, or fabric count read from a device.
- Commissioning-window commands on a device.
- Smart-home-first commissioning onto an existing Thread network.
- Management-first commissioning. Bluetooth and a Thread operational dataset are unavailable on this host, so that path cannot be completed even with a board until both exist.
- USB boot, OpenThread join, Apple Home, and a second administrator. See `docs/HARDWARE_TEST_PLAN.md`.

## Hardware verification

Pending. No node has been commissioned from this repository. The HomePod mini checklist in `docs/HARDWARE_TEST_PLAN.md` is entirely unchecked.
