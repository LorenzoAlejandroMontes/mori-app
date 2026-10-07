// Reversible actions instead of "Are you sure?" (docs/DESIGN.md, principle 5):
// the change shows at once, a toast offers "Annulla" for a few seconds, and only
// then is it written for good. If Mori closes before, nothing is written: the
// safe side. A second offer commits the first one at once.
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";

export type Undoable = { id: number; message: string };
export type OfferUndo = (message: string, commit: () => void | Promise<void>, revert: () => void) => void;

const WINDOW_MS = 6000;

export function useUndo(onError: (msg: string) => void) {
  const [current, setCurrent] = useState<Undoable | null>(null);
  const pending = useRef<{ id: number; commit: () => void | Promise<void>; revert: () => void; timer: ReturnType<typeof setTimeout> } | null>(null);

  async function commitNow() {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    clearTimeout(p.timer);
    setCurrent((c) => (c?.id === p.id ? null : c));
    try {
      await p.commit();
    } catch (e) {
      p.revert();
      onError(t("Non sono riuscito a completarlo: {error}", { error: String(e) }));
    }
  }

  const offer: OfferUndo = (message, commit, revert) => {
    void commitNow();
    const id = Date.now() + Math.random();
    const timer = setTimeout(() => void commitNow(), WINDOW_MS);
    pending.current = { id, commit, revert, timer };
    setCurrent({ id, message });
  };

  function undo() {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    clearTimeout(p.timer);
    setCurrent(null);
    p.revert();
  }

  // Ctrl+Z while the toast is there undoes, like everywhere else.
  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && pending.current) {
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return; // the field's own undo
        e.preventDefault();
        undoRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { current, offer, undo, durationMs: WINDOW_MS };
}
