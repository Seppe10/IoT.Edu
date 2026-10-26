export const RESERVED_GPIOS = [9];

export interface NodeConfigDraft {
  name: string;
  hardware: "esp32h2";
  nodeType: string;
  componentIds: string[];
  gpio: number;
  protocol: "matter-over-thread";
}

export interface ConfigIssue {
  code: string;
  message: string;
}

const CONFIG_KEY = "iotedu.nodeConfig.v1";

export function loadNodeConfig(storage: Pick<Storage, "getItem"> | null): NodeConfigDraft {
  const raw = storage?.getItem(CONFIG_KEY);
  if (!raw) return ENVIRONMENTAL_SENSOR;
  try {
    const parsed = JSON.parse(raw) as Partial<NodeConfigDraft>;
    const draft = { ...ENVIRONMENTAL_SENSOR, name: typeof parsed.name === "string" ? parsed.name : ENVIRONMENTAL_SENSOR.name };
    return validateNodeConfig(draft).ok ? draft : ENVIRONMENTAL_SENSOR;
  } catch {
    return ENVIRONMENTAL_SENSOR;
  }
}

export function saveNodeConfig(storage: Pick<Storage, "setItem"> | null, draft: NodeConfigDraft): void {
  if (!validateNodeConfig(draft).ok) return;
  storage?.setItem(CONFIG_KEY, JSON.stringify(draft));
}

export const ENVIRONMENTAL_SENSOR: NodeConfigDraft = {
  name: "ESP32-H2",
  hardware: "esp32h2",
  nodeType: "environmental-sensor",
  componentIds: ["iotedu-dht11"],
  gpio: 4,
  protocol: "matter-over-thread",
};

const SUPPORTED_TYPES = new Set(["environmental-sensor"]);

export function validateNodeConfig(input: NodeConfigDraft): { ok: boolean; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = [];
  if (!input.name.trim()) issues.push({ code: "name", message: "A node name is required." });
  if (input.hardware !== "esp32h2") issues.push({ code: "hardware", message: "Only the ESP32-H2 target is supported." });
  if (!SUPPORTED_TYPES.has(input.nodeType)) {
    issues.push({ code: "profile", message: "Only the ESP32-H2 DHT11 environmental sensor profile is supported. Other sensors and actuators are not enabled." });
  }
  if (input.protocol !== "matter-over-thread") issues.push({ code: "protocol", message: "The supported profile uses Matter over Thread." });
  if (!input.componentIds.includes("iotedu-dht11") || input.componentIds.some((id) => id !== "iotedu-dht11")) {
    issues.push({ code: "components", message: "The supported profile uses the DHT11 driver only. Other components are not enabled for setup." });
  }
  if (RESERVED_GPIOS.includes(input.gpio)) {
    issues.push({ code: "gpio-reserved", message: `GPIO${input.gpio} is reserved for the factory-reset button.` });
  }
  if (input.gpio !== 4) {
    issues.push({ code: "gpio", message: "The verified DHT11 profile uses GPIO4. A different pin is not supported by the current driver profile." });
  }
  return { ok: issues.length === 0, issues };
}

function packageHasComponent(requestIds: string[], required: string): boolean {
  if (required === "iotedu-dht11") return requestIds.includes("iotedu-dht11") || requestIds.includes("custom-dht11");
  return requestIds.includes(required);
}

export function packageMatchesConfig(
  request: { hardware: string; componentIds: string[] },
  config: NodeConfigDraft,
): string | null {
  const configResult = validateNodeConfig(config);
  if (!configResult.ok) return configResult.issues[0]?.message ?? "The node configuration is not valid.";
  if (request.hardware !== config.hardware) return "This package targets different hardware.";
  if (!config.componentIds.every((id) => packageHasComponent(request.componentIds, id))) {
    return "This package does not include the DHT11 temperature and humidity clusters required by the selected profile.";
  }
  return null;
}
