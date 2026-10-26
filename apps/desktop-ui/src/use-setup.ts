import { useState } from "react";
import { loadSetup, reconcileSetup, saveSetup, type LiveNodeSummary, type SetupRecord } from "./setup";

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function useSetup(nodes: LiveNodeSummary[]) {
  const [setup, setSetup] = useState<SetupRecord>(() => loadSetup(browserStorage()));
  function update(patch: Partial<SetupRecord>) {
    setSetup((current) => {
      const next = { ...current, ...patch };
      saveSetup(browserStorage(), next);
      return next;
    });
  }
  return { setup, view: reconcileSetup(setup, nodes), update };
}
