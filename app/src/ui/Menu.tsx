// A small menu behind a button (the "⋯" of a page). Keyboard: Enter/Space or
// ↓ opens it on the first item, ↑↓ move, Home/End jump, Esc closes and gives
// focus back to the button; a click outside closes it.
import { useEffect, useRef, useState, type ReactNode } from "react";

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  hint?: string;
};

export default function Menu({
  label,
  icon,
  items,
  className = "",
}: {
  /** The button's accessible name (and tooltip). */
  label: string;
  icon: ReactNode;
  items: MenuItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useRef(`menu-${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  function onKey(e: React.KeyboardEvent) {
    const els = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className={"menu-wrap " + className}>
      <button
        ref={btn}
        className="icon-btn"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
      </button>
      {open && (
        <div ref={list} id={menuId} className="menu" role="menu" aria-label={label} onKeyDown={onKey}>
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              tabIndex={-1}
              className={"menu-item" + (it.danger ? " danger" : "")}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.icon}
              <span className="menu-label">{it.label}</span>
              {it.hint && <span className="menu-hint">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
