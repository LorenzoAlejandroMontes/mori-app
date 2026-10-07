// The live state of the first-launch setup, for every view at once (the strip
// under the recorder, the recorder itself). The backend does the work and
// sends `setup://progress`; here it is started once, and retried on request.
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseStage, type SetupState } from "./setup-logic";

let state: SetupState = { phase: "idle" };
const listeners = new Set<() => void>();
let listening = false;

function set(next: SetupState) {
  state = next;
  for (const cb of [...listeners]) cb();
}

export function setupNow(): SetupState {
  return state;
}

export function useSetup(): SetupState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setupNow,
  );
}

async function prepare(): Promise<void> {
  if (state.phase === "preparing") return;
  set({ phase: "preparing", stage: "python" });
  if (!listening) {
    listening = true;
    void listen<{ stage?: string }>("setup://progress", (e) => {
      const stage = parseStage(e.payload?.stage);
      if (stage && state.phase === "preparing") set({ phase: "preparing", stage });
    });
  }
  try {
    await invoke("prepare_python_env");
    set({ phase: "ready" });
  } catch (e) {
    set({ phase: "failed", error: String(e).replace(/^Error:\s*/, "") });
  }
}

/**
 * Called once when Mori opens. A Python that already works (a developer's
 * venv, an earlier setup) changes nothing. A packaged Mori without one
 * prepares it now. A Mori that cannot prepare it stays as it was.
 */
export async function ensureSetup(): Promise<void> {
  try {
    const s = await invoke<{ ready: boolean; can_prepare: boolean }>("python_env_status");
    if (s.ready) set({ phase: "ready" });
    else if (s.can_prepare) await prepare();
  } catch {
    /* an older backend without the command: nothing to prepare */
  }
}

export function retrySetup(): void {
  void prepare();
}
