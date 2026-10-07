// The messages at the top of the window, stacked: what must be answered first
// (the auto-stop countdown when the sidebar is collapsed), then "Annulla" for
// what was just done, then an error (stays until closed) or a calm
// confirmation (goes away by itself). `children` joins the stack (the
// "Sembra una call" suggestion).
import { useEffect, type ReactNode } from "react";
import type { Undoable } from "./useUndo";
import { IconClose } from "./icons";
import { t } from "../i18n";

export default function Toasts({
  toast,
  notice,
  undo,
  undoMs,
  onUndo,
  onCloseToast,
  onCloseNotice,
  extra,
  children,
}: {
  toast: string | null;
  notice: string | null;
  undo: Undoable | null;
  undoMs: number;
  onUndo: () => void;
  onCloseToast: () => void;
  onCloseNotice: () => void;
  extra?: ReactNode;
  children?: ReactNode;
}) {
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(onCloseNotice, 4200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice]);

  return (
    <div className="toasts">
      {extra && <div className="toast toast-extra">{extra}</div>}
      {undo && (
        <div key={undo.id} className="toast undo" role="status">
          <span className="toast-msg">{undo.message}</span>
          <button className="btn sm" onClick={onUndo} title={t("Annulla (Ctrl Z)")}>
            {t("Annulla")}
          </button>
          <span className="undo-timer" style={{ animationDuration: `${undoMs}ms` }} aria-hidden="true" />
        </div>
      )}
      {toast && (
        <div className="toast error" role="alert">
          <span className="toast-msg">{toast}</span>
          <button className="toast-x" aria-label={t("Chiudi")} onClick={onCloseToast}>
            <IconClose size={14} />
          </button>
        </div>
      )}
      {notice && !toast && (
        <div className="toast notice" role="status">
          <span className="notice-dot" aria-hidden="true" />
          <span className="toast-msg">{notice}</span>
          <button className="toast-x" aria-label={t("Chiudi")} onClick={onCloseNotice}>
            <IconClose size={14} />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
