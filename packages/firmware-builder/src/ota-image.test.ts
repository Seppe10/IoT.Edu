import { describe, expect, it } from "vitest";
import { encodeMatterOtaImage, ESP32H2_CHIP_ID, inspectMatterOtaImage } from "./ota-image.js";

describe("Matter OTA image inspection", () => {
  const image = encodeMatterOtaImage({
    vendorId: 0xfff1,
    productId: 0x8000,
    softwareVersion: 3,
    softwareVersionString: "1.2.0",
  });

  it("accepts a header whose digest and ESP32-H2 chip id match the payload", () => {
    const inspected = inspectMatterOtaImage(image);
    expect(inspected.ok).toBe(true);
    expect(inspected.vendorId).toBe(0xfff1);
    expect(inspected.productId).toBe(0x8000);
    expect(inspected.softwareVersion).toBe(3);
    expect(inspected.softwareVersionString).toBe("1.2.0");
    expect(inspected.digestValid).toBe(true);
    expect(inspected.chipId).toBe(ESP32H2_CHIP_ID);
    expect(inspected.targetsEsp32h2).toBe(true);
  });

  it("rejects a simulated file, a bad digest, and a different chip", () => {
    expect(inspectMatterOtaImage(Buffer.from("SIMULATED\n")).ok).toBe(false);
    expect(inspectMatterOtaImage(encodeMatterOtaImage({
      vendorId: 0xfff1,
      productId: 0x8000,
      softwareVersion: 3,
      softwareVersionString: "1.2.0",
      corruptDigest: true,
    })).digestValid).toBe(false);
    const otherChip = inspectMatterOtaImage(encodeMatterOtaImage({
      vendorId: 0xfff1,
      productId: 0x8000,
      softwareVersion: 3,
      softwareVersionString: "1.2.0",
      chipId: 0,
    }));
    expect(otherChip.digestValid).toBe(true);
    expect(otherChip.targetsEsp32h2).toBe(false);
    expect(otherChip.ok).toBe(false);
  });
});
