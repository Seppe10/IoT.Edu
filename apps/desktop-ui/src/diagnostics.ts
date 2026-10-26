import { assessFactoryResetCapture } from "@iotedu/contracts";

export interface ConsoleFindings {
  serial: "pass" | "fail" | "unknown";
  boot: "pass" | "fail" | "unknown";
  firmwareIdentity: "pass" | "fail" | "unknown";
  matter: "pass" | "fail" | "unknown";
  dht11: "pass" | "fail" | "unknown";
  panic: "pass" | "fail" | "unknown";
  factoryReset: "pass" | "incomplete" | "unknown";
  versionText: string | null;
  detail: string;
}

export function interpretConsole(text: string, expectedVersion: string | null): ConsoleFindings {
  const panic = /Guru Meditation|panic'ed|abort\(\)/i.test(text);
  const boot = /ESP-ROM:esp32h2|boot: ESP-IDF|App version:|App "sensors"/i.test(text);
  const version = text.match(/App version:\s*(\S+)/)?.[1] ?? text.match(/App "sensors" version (\S+)/)?.[1] ?? null;
  const matterFail = /Failed to start Matter|Failed to create Matter node/.test(text);
  const matter = /chip\[DL\]|CHIP task running|Server Listening/.test(text);
  const dhtInitFail = /Failed to initialize DHT11/.test(text);
  const dhtRead = /DHT11 Temperature/.test(text);
  const dhtFail = /DHT11 read failed/.test(text);
  const reset = assessFactoryResetCapture(text);
  const factoryReset = reset.stage === "verified_fabric_free" ? "pass" : reset.stage === "not_observed" || reset.stage === "reboot_without_reset" ? "unknown" : "incomplete";
  const serial = text.trim().length > 0 && !/could not open port/i.test(text);
  return {
    serial: serial ? "pass" : text.trim() ? "fail" : "unknown",
    boot: panic ? "fail" : boot ? "pass" : "unknown",
    firmwareIdentity: version && expectedVersion ? (version === expectedVersion ? "pass" : "fail") : version ? "unknown" : "unknown",
    matter: matterFail ? "fail" : matter ? "pass" : "unknown",
    dht11: dhtInitFail ? "fail" : dhtRead ? "pass" : dhtFail ? "fail" : "unknown",
    panic: panic ? "fail" : text.trim() ? "pass" : "unknown",
    factoryReset,
    versionText: version,
    detail: factoryReset === "unknown"
      ? "A click is not a factory reset. This result comes only from the captured console text."
      : reset.detail,
  };
}

export function diagnosticReport(lines: string[]): string {
  return ["IoT.Edu hardware diagnostic report", ...lines].join("\n");
}
