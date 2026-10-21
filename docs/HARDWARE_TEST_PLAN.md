# Hardware test plan

No hardware evidence has been collected in this repository. Every item is **pending**.

## Board

ESP32-H2 (DevKitM-1 assumed from GPIO9 BOOT button overlay). DHT11 data on GPIO4.

## Checklist

1. First-time USB flash of a locally built image; confirm boot and expected `sensors` firmware.
2. Commission onto the IoT.Edu management fabric.
3. Commission onto an additional smart-home fabric (Apple Home / Google Home / Alexa).
4. Restart the desktop application; reconnect with persisted controller credentials.
5. Build a strictly higher `SoftwareVersion`.
6. Inspect Matter OTA header (`ota_image_tool.py show`): VID, PID, version match the build.
7. Run Matter OTA from IoT.Edu to **one** selected node.
8. Confirm install, reboot, CASE re-establishment.
9. Re-read Basic Information `SoftwareVersion` and confirm it matches the package.
10. Confirm the other smart-home fabric still operates.
11. Interrupt an OTA and confirm the job is stored as interrupted/unknown, not success.
12. Confirm no other registered node changed.

## Cluster reads allowed for management

Basic Information, Descriptor, Operational Credentials, Administrator Commissioning, OTA Software Update Requestor.

Do not use TemperatureMeasurement or RelativeHumidityMeasurement as pass/fail for IoT.Edu itself. Those remain for the smart-home controller.
