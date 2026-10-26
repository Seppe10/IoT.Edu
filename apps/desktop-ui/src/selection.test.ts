import { describe, expect, it } from "vitest";
import { NEW_NODE, loadSelectedNodeId, nodeOptionLabel, saveSelectedNodeId } from "./selection";

describe("selected node", () => {
  it("persists a node id and falls back to New Node", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    expect(loadSelectedNodeId(storage)).toBe(NEW_NODE);
    saveSelectedNodeId(storage, "node-2");
    expect(loadSelectedNodeId(storage)).toBe("node-2");
    saveSelectedNodeId(storage, NEW_NODE);
    expect(loadSelectedNodeId(storage)).toBe(NEW_NODE);
  });

  it("labels a managed node with its Matter id", () => {
    expect(nodeOptionLabel({ name: "Bench", matterNodeId: "2", hardware: "ESP32-H2" })).toBe("Bench · Matter 2");
    expect(nodeOptionLabel({ name: "Bench", matterNodeId: null, hardware: "ESP32-H2" })).toBe("Bench · ESP32-H2");
  });
});
