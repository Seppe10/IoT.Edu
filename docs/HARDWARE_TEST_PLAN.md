# Hardware test plan

No hardware evidence has been collected in this repository. Every item is **pending**. Compiling the reference image and the modular DHT11 image, and implementing the USB write workflow, does not complete any item below.

The Firmware Builder shows the same checklist for a compiled package. With no board programmed, every row stays unknown or is absent. Do not mark a row passed from a unit test or a simulated session.

## Board

ESP32-H2 (DevKitM-1 / common Super Mini, GPIO9 BOOT). DHT11 data on GPIO4. The modular firmware reads that pin from `CONFIG_IOTEDU_DHT11_PIN`, whose default is 4.

Download mode, if automatic reset does not occur: hold BOOT (GPIO9), press and release RESET, release BOOT.

## USB checklist

1. Connect the ESP32-H2 with a data USB cable.
2. Confirm serial communication.
3. Write a compiled package. NVS is not erased.
4. Confirm the boot banner.
5. Confirm Matter startup from the serial log.
6. Confirm OpenThread startup from the serial log.
7. Confirm the DHT11 task logged. A reading is not a commissioning result.
8. Record the firmware version from the serial banner and compare it with the package.
9. Verify GPIO9 factory reset only when removing fabrics is acceptable.

## HomePod mini and Apple Home

Use an ESP32-H2 that can reach a HomePod mini Thread border router. Every step is **pending**. Do not mark one from a unit test, a simulated node, or a successful Matter.js startup on the Mac.

1. The device boots after a USB write from this application.
2. Matter and OpenThread initialise. Confirm that from the serial log.
3. The device joins the existing Thread network. Do not create another Thread network.
4. Apple Home commissions the device and continues to show it.
5. IoT.Edu joins as a second Matter administrator, using a pairing code from Apple Home.
6. IoT.Edu establishes a CASE session on its own fabric.
7. IoT.Edu reads the device’s SoftwareVersion and identity, and those values match the device.
8. Restart IoT.Edu. The same controller credential id is loaded and the node reconnects.
9. Apple Home still displays and controls the device on its own fabric.
10. IoT.Edu does not show operational sensor or actuator values.

## OTA from 1.1.0 to 1.2.0

Use the compiled packages already produced by this repository: initial firmware `1.1.0` / SoftwareVersion `2`, update firmware `1.2.0` / SoftwareVersion `3`. The Thread border router is a HomePod mini. Apple Home is the existing controller. IoT.Edu is the second administrator. Every step is **pending**. A unit test, a stored image, or a BDX registration on the Mac does not complete any step.

1. The ESP32-H2 boots with firmware 1.1.0.
2. Apple Home commissions it.
3. IoT.Edu joins as an additional Matter administrator.
4. Both fabrics stay operational.
5. IoT.Edu reads SoftwareVersion 2.
6. The OTA Provider is accessible to the device.
7. The ESP32-H2 requests the image and the BDX transfer finishes.
8. The device applies firmware 1.2.0 and restarts.
9. IoT.Edu reconnects and reads SoftwareVersion 3.
10. Apple Home still works after the update.

## Later checklist

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
