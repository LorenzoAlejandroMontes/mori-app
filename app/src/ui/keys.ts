// Keyboard helpers shared by the views.

/** True while the user is writing: single-letter shortcuts must stay quiet. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** "Ctrl+Shift+R" → ["Ctrl", "⇧", "R"]: one key per box. */
export function hotkeyParts(accel: string): string[] {
  return accel
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => {
      const l = k.toLowerCase();
      if (l === "shift") return "⇧";
      if (l === "commandorcontrol" || l === "cmdorctrl" || l === "control") return "Ctrl";
      if (l === "alt" || l === "option") return "Alt";
      return k.length === 1 ? k.toUpperCase() : k;
    });
}

/** Move focus among a list's items with the arrows (and J/K), Home/End. */
export function moveFocus(e: React.KeyboardEvent, container: HTMLElement | null, selector: string): boolean {
  if (!container) return false;
  const down = e.key === "ArrowDown" || (e.key === "j" && !isTyping(e.target));
  const up = e.key === "ArrowUp" || (e.key === "k" && !isTyping(e.target));
  const home = e.key === "Home";
  const end = e.key === "End";
  if (!down && !up && !home && !end) return false;
  const items = Array.from(container.querySelectorAll<HTMLElement>(selector));
  if (!items.length) return false;
  const i = items.indexOf(document.activeElement as HTMLElement);
  let next = i;
  if (home) next = 0;
  else if (end) next = items.length - 1;
  else if (down) next = i < 0 ? 0 : Math.min(items.length - 1, i + 1);
  else next = i < 0 ? 0 : Math.max(0, i - 1);
  e.preventDefault();
  items[next]?.focus();
  items[next]?.scrollIntoView({ block: "nearest" });
  return true;
}
