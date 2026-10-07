// A dialog done right once: a veil behind, focus moved inside and kept there
// (Tab cycles), Esc or a click on the veil closes, and focus goes back to
// whatever opened it.
import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Dialog({
  title,
  onClose,
  children,
  wide,
  className = "",
  labelledBy,
}: {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
  /** Id of a heading inside the children, when the title is not a plain string. */
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useRef(`dlg-${Math.random().toString(36).slice(2, 8)}`).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const box = ref.current;
    // Focus the first field if there is one (that is what you came to type in),
    // else the dialog itself.
    const first = box?.querySelector<HTMLElement>("input, textarea, select") ?? box;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !box) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const firstEl = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={"dialog" + (wide ? " wide" : "") + (className ? " " + className : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? (title ? titleId : undefined)}
        tabIndex={-1}
      >
        {title && (
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
