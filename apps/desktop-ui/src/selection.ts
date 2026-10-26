export const NEW_NODE = "new";
const KEY = "iotedu.selectedNode.v1";

export function loadSelectedNodeId(storage: Pick<Storage, "getItem"> | null): string {
  const value = storage?.getItem(KEY);
  return value && value !== "" ? value : NEW_NODE;
}

export function saveSelectedNodeId(storage: Pick<Storage, "setItem"> | null, id: string): void {
  storage?.setItem(KEY, id || NEW_NODE);
}

export function nodeOptionLabel(node: { name: string; matterNodeId?: string | null; hardware?: string }): string {
  if (node.matterNodeId) return `${node.name} · Matter ${node.matterNodeId}`;
  return `${node.name} · ${node.hardware || "hardware not read"}`;
}
