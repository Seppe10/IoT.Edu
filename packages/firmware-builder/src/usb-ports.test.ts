import { describe, expect, it } from "vitest";
import { classifySerialPorts, collectUsbRecords, locationCalloutSuffix, parseLsofRecords } from "./usb-ports.js";

describe("USB serial roles", () => {
  it("separates the Espressif programming interface from the UART console without using historical port names", () => {
    const records = collectUsbRecords({
      SPUSBDataType: [
        {
          _items: [
            {
              _name: "USB Single Serial",
              vendor_id: "0x1a86",
              serial_num: "5AF6110828",
              location_id: "0x14320000 / 54",
            },
            {
              _name: "Espressif USB JTAG/serial debug unit",
              vendor_id: "0x303a",
              serial_num: "48:31:B7:CF:3D:52",
              location_id: "0x14340000 / 55",
            },
          ],
        },
      ],
    });
    expect(locationCalloutSuffix("0x14340000 / 55")).toBe("143401");
    const classified = classifySerialPorts([
      "/dev/cu.usbmodem5AF61108281",
      "/dev/cu.usbmodem143401",
    ], records);
    expect(classified).toEqual([
      { path: "/dev/cu.usbmodem5AF61108281", role: "console", label: "UART console" },
      { path: "/dev/cu.usbmodem143401", role: "programming", label: "ESP32-H2 programming interface" },
    ]);
    expect(parseLsofRecords("p5327\ncPython\np80\n")).toEqual([
      { pid: 5327, command: "Python" },
      { pid: 80, command: "unknown" },
    ]);
  });
});
