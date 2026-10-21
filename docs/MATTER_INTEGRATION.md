# Matter integration

**Not implemented in Phase 0.** Findings below are from firmware source and the host Matter SDK, not from a running controller.

## Device side (reference firmware)

- Transport: Matter over Thread on ESP32-H2, BLE used only for commissioning (`CONFIG_USE_BLE_ONLY_FOR_COMMISSIONING`).
- Pairing autostart enabled; test setup parameters enabled; VID `0xFFF1`, PID `0x8000`.
- OTA Software Update Requestor enabled; device is not an OTA Provider.
- Administrator Commissioning cluster supported.
- After the last fabric is removed, a 300 s basic commissioning window is opened with DNS-SD advertisement only.
- Management UI must not subscribe to TemperatureMeasurement or RelativeHumidityMeasurement.

## Intended controller (later phases)

Persistent local matter.js controller. Fabric label: **IoT.Edu Management**. That fabric is not a second physical Thread network.

- Path A (management-first) needs BLE commissioning support on the host **and** a Thread operational dataset. If either is missing, the UI must say so and offer Path B.
- Path B (smart-home-first) commissions IoT.Edu as an additional administrator through an existing commissioning window.

Controller identity must survive restarts. If stored credentials cannot be loaded, **do not** silently create a new identity.

OTA Provider must use Matter OTA/BDX, not HTTP/MQTT/file copy. Image metadata must match compiled VID/PID/SoftwareVersion.

## Hardware verification

Pending. No node has been commissioned from this repository.
