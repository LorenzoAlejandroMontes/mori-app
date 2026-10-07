// "Da fare" — every action of every call in one place (docs/DESIGN.md §5,
// reference: Things). Sections by time, late ones first; the tick is
// optimistic and the row stays put for a moment before going down to "Fatte";
// deleting offers Annulla. The whole list works from the keyboard.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  listTodos,
  setTodoStatus,
  updateTodo,
  deleteTodo,
  createTodo,
  type Todo,
} from "./todos";
import { BUCKET_ORDER, bucketOf, compareTodos, type Bucket } from "./todo-logic";
import type { OfferUndo } from "../ui/useUndo";
import { isTyping, moveFocus } from "../ui/keys";
import { dueLabel } from "../ui/format";
import { t } from "../i18n";
import { useTabInk } from "../ui/useTabInk";
import { IconCalendar, IconChevron, IconFile, IconPencil, IconPlus, IconSearch, IconTrash } from "../ui/icons";
import "./TodosView.css";

type Tab = "mie" | "altri" | "tutte";
const TABS: [Tab, string][] = [
  ["mie", t("Mie")],
  ["altri", t("Degli altri")],
  ["tutte", t("Tutte")],
];
/** How long a ticked row stays where it was, before going to "Fatte". */
const SETTLE_MS = 900;

export default function TodosView({
  myNames,
  onOpenCall,
  onChanged,
  onError,
  offerUndo,
}: {
  myNames: string[];
  onOpenCall: (sessionId: string, startSec?: number | null) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
  offerUndo?: OfferUndo;
}) {
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [tab, setTab] = useState<Tab>("mie");
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [newText, setNewText] = useState("");
  const [newWhen, setNewWhen] = useState("");
  const [editing, setEditing] = useState<{ id: string; field: "text" | "who" | "due" } | null>(null);
  // Ticked a moment ago: shown done, still in its section.
  const [settling, setSettling] = useState<Set<string>>(new Set());
  // Deleted a moment ago, waiting for "Annulla" to run out.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const ink = useTabInk(tabsRef, tab);

  async function reload() {
    try {
      setTodos(await listTodos(myNames));
    } catch (e) {
      onError(t("Non riesco a leggere le cose da fare: {error}", { error: String(e) }));
      setTodos([]);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myNames.join(",")]);

  // "/" searches, "N" writes a new one — from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector(".dialog-backdrop, .cmd-backdrop")) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        addRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const all = (todos ?? []).filter((t) => !hidden.has(t.id));
  const open = all.filter((t) => t.status === "open");
  const counts = {
    mie: open.filter((t) => t.mine).length,
    altri: open.filter((t) => !t.mine).length,
    tutte: open.length,
  };
  const lateMine = open.filter((t) => t.mine && bucketOf(t.due) === "ritardo").length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((t) => {
      if (tab === "mie" && !t.mine) return false;
      if (tab === "altri" && t.mine) return false;
      if (!q) return true;
      return (
        t.text.toLowerCase().includes(q) ||
        (t.assignee ?? "").toLowerCase().includes(q) ||
        t.source.title.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos, hidden, tab, query]);

  const buckets = useMemo(() => {
    const map: Record<Bucket, Todo[]> = { ritardo: [], settimana: [], avanti: [], senzadata: [] };
    for (const t of visible) {
      if (t.status === "done" && !settling.has(t.id)) continue;
      map[bucketOf(t.due)].push(t);
    }
    for (const b of BUCKET_ORDER) {
      map[b].sort((a, c) =>
        compareTodos({ due: a.due, sessionAt: a.source.startedAt }, { due: c.due, sessionAt: c.source.startedAt }),
      );
    }
    return map;
  }, [visible, settling]);

  const done = visible.filter((t) => t.status === "done" && !settling.has(t.id));

  // Optimistic tick: the row changes at once, the write follows. A row just
  // ticked stays where it is for a moment (you see it done) before moving.
  async function toggle(td: Todo) {
    const next = td.status === "done" ? "open" : "done";
    setTodos((prev) => (prev ?? []).map((x) => (x.id === td.id ? { ...x, status: next } : x)));
    if (next === "done") {
      setSettling((s) => new Set(s).add(td.id));
      setTimeout(() => setSettling((s) => {
        const n = new Set(s);
        n.delete(td.id);
        return n;
      }), SETTLE_MS);
    }
    try {
      await setTodoStatus(td, next);
      onChanged();
    } catch (e) {
      setTodos((prev) => (prev ?? []).map((x) => (x.id === td.id ? { ...x, status: td.status } : x)));
      onError(t("Non sono riuscito a segnarla: {error}", { error: String(e) }));
    }
  }

  async function patch(td: Todo, p: { text?: string; assignee?: string | null; dueRaw?: string | null }) {
    setEditing(null);
    try {
      await updateTodo(td, p);
      await reload();
      onChanged();
    } catch (e) {
      onError(t("Modifica non riuscita: {error}", { error: String(e) }));
    }
  }

  // Gone at once; written for good when "Annulla" runs out.
  function remove(td: Todo, focusNext?: HTMLElement | null) {
    setHidden((h) => new Set(h).add(td.id));
    focusNext?.focus();
    const unhide = () =>
      setHidden((h) => {
        const n = new Set(h);
        n.delete(td.id);
        return n;
      });
    const commit = async () => {
      await deleteTodo(td);
      setTodos((prev) => (prev ?? []).filter((x) => x.id !== td.id));
      unhide();
      onChanged();
    };
    const short = td.text.length > 40 ? td.text.slice(0, 39) + "…" : td.text;
    if (offerUndo) offerUndo(t("Eliminata: “{text}”", { text: short }), commit, unhide);
    else void commit().catch((e) => {
      unhide();
      onError(t("Eliminazione non riuscita: {error}", { error: String(e) }));
    });
  }

  async function add() {
    const text = newText.trim();
    if (!text) return;
    setNewText("");
    setNewWhen("");
    try {
      await createTodo({ text, dueRaw: newWhen || null, assignee: myNames[0] ?? "Tu" });
      await reload();
      onChanged();
    } catch (e) {
      onError(t("Non sono riuscito ad aggiungerla: {error}", { error: String(e) }));
    }
  }

  function onRowKey(e: React.KeyboardEvent<HTMLLIElement>, td: Todo) {
    if ((e.target as HTMLElement) !== e.currentTarget) return; // a field or button inside handles its own keys
    if (moveFocus(e, listRef.current, ".todo-row")) return;
    if (e.key === " " || e.key === "x") {
      e.preventDefault();
      void toggle(td);
    } else if (e.key === "Enter" || e.key === "e") {
      e.preventDefault();
      setEditing({ id: td.id, field: "text" });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>(".todo-row") ?? []);
      const i = rows.indexOf(e.currentTarget);
      remove(td, rows[i + 1] ?? rows[i - 1]);
    }
  }

  const row = (td: Todo) => {
    const isDone = td.status === "done";
    return (
      <li
        key={td.id}
        className={"todo-row" + (isDone ? " isdone" : "") + (settling.has(td.id) ? " settling" : "")}
        tabIndex={0}
        aria-label={`${td.text}${td.due.label ? `, ${dueLabel(td.due)}` : ""}${isDone ? t(", fatta") : ""}`}
        onKeyDown={(e) => onRowKey(e, td)}
      >
        <button
          className={"check" + (isDone ? " on" : "")}
          role="checkbox"
          aria-checked={isDone}
          aria-label={isDone ? t("Segna da fare") : t("Segna fatta")}
          tabIndex={-1}
          onClick={() => toggle(td)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
        </button>

        <div className="todo-body">
          {editing?.id === td.id && editing.field === "text" ? (
            <input
              className="todo-edit"
              autoFocus
              aria-label={t("Testo")}
              defaultValue={td.text}
              onBlur={(e) => patch(td, { text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") patch(td, { text: (e.target as HTMLInputElement).value });
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setEditing(null);
                }
              }}
            />
          ) : (
            <button className="todo-txt" tabIndex={-1} title={t("Clicca per modificare")} onClick={() => setEditing({ id: td.id, field: "text" })}>
              {td.text}
            </button>
          )}

          <div className="todo-meta">
            {editing?.id === td.id && editing.field === "due" ? (
              <input
                className="todo-inline"
                autoFocus
                aria-label={t("Scadenza")}
                placeholder={t("es. domani, giovedì, 2026-10-02")}
                defaultValue={td.dueRaw ?? ""}
                onBlur={(e) => patch(td, { dueRaw: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") patch(td, { dueRaw: (e.target as HTMLInputElement).value });
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setEditing(null);
                  }
                }}
              />
            ) : (
              // No due date, no chip: half the rows have none, and as many
              // "+ quando" pills would bury the call they came from. The
              // calendar icon on the row adds one.
              td.due.kind !== "none" && (
                <button
                  className={dueClass(td)}
                  tabIndex={-1}
                  title={td.dueRaw ? t("Detto nella call: “{raw}”", { raw: td.dueRaw }) : t("Cambia la scadenza")}
                  onClick={() => setEditing({ id: td.id, field: "due" })}
                >
                  {bucketOf(td.due) === "ritardo" && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                  )}
                  {dueLabel(td.due)}
                </button>
              )
            )}

            <button
              className="todo-src"
              tabIndex={-1}
              title={td.source.sessionId ? t("Apri la call") : t("Aggiunta a mano")}
              disabled={!td.source.sessionId}
              onClick={() => td.source.sessionId && onOpenCall(td.source.sessionId)}
            >
              <IconFile size={12} />
              {td.source.title}
            </button>

            {td.source.sessionId && td.source.startSec != null && (
              <button
                className="todo-seek mono"
                tabIndex={-1}
                title={t("Ascolta il momento in cui è stato detto")}
                onClick={() => onOpenCall(td.source.sessionId as string, td.source.startSec)}
              >
                ▶ {clock(td.source.startSec)}
              </button>
            )}

            {editing?.id === td.id && editing.field === "who" ? (
              <input
                className="todo-inline"
                autoFocus
                aria-label={t("Di chi è")}
                placeholder={t("di chi è")}
                defaultValue={td.assignee ?? ""}
                onBlur={(e) => patch(td, { assignee: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") patch(td, { assignee: (e.target as HTMLInputElement).value });
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setEditing(null);
                  }
                }}
              />
            ) : (
              <button
                className={"todo-who" + (td.mine ? " me" : "") + (td.assignee ? "" : " add")}
                tabIndex={-1}
                title={t("Clicca per cambiare a chi tocca")}
                onClick={() => setEditing({ id: td.id, field: "who" })}
              >
                {td.assignee ?? t("di chi?")}
              </button>
            )}
          </div>
        </div>

        <div className="todo-acts">
          {td.due.kind === "none" && (
            <button className="icon-btn" tabIndex={-1} aria-label={t("Dagli una scadenza")} title={t("Dagli una scadenza")} onClick={() => setEditing({ id: td.id, field: "due" })}>
              <IconCalendar size={15} />
            </button>
          )}
          <button className="icon-btn" tabIndex={-1} aria-label={t("Modifica il testo")} title={t("Modifica il testo (E)")} onClick={() => setEditing({ id: td.id, field: "text" })}>
            <IconPencil size={15} />
          </button>
          <button className="icon-btn danger-hover" tabIndex={-1} aria-label={t("Elimina")} title={t("Elimina (Canc)")} onClick={() => remove(td)}>
            <IconTrash size={15} />
          </button>
        </div>
      </li>
    );
  };

  const nothing = BUCKET_ORDER.every((b) => buckets[b].length === 0);

  return (
    <div className="page todos" data-tab={tab}>
      <div className="page-scroll">
        <div className="page-col list-col">
          <header className="page-head">
            <div className="page-head-text">
              <h1 className="page-title">{t("Da fare")}</h1>
              <p className="page-sub">
                {todos === null
                  ? " "
                  : lateMine
                    ? t("{mine} tue, {late} in ritardo · {open} aperte in tutto", { mine: counts.mie, late: lateMine, open: counts.tutte })
                    : t("{mine} tue · {open} aperte in tutto", { mine: counts.mie, open: counts.tutte })}
              </p>
            </div>
            <label className="field-search todos-search">
              <IconSearch size={15} />
              <span className="sr-only">{t("Cerca tra le cose da fare")}</span>
              <input
                ref={searchRef}
                placeholder={t("Cerca cose, persone, call")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.stopPropagation();
                    setQuery("");
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    listRef.current?.querySelector<HTMLElement>(".todo-row")?.focus();
                  }
                }}
              />
              <kbd aria-hidden="true">/</kbd>
            </label>
          </header>

          <div className="todos-tabs" role="tablist" aria-label={t("Di chi")} ref={tabsRef}>
            <span className="tab-ink" style={ink} aria-hidden="true" />
            {TABS.map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                className="todos-tab"
                onClick={() => setTab(k)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const i = TABS.findIndex(([x]) => x === tab);
                    const n = TABS[(i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length][0];
                    setTab(n);
                    (e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[TABS.findIndex(([x]) => x === n)])?.focus();
                  }
                }}
                tabIndex={tab === k ? 0 : -1}
              >
                {label}
                <span className="count">{counts[k]}</span>
              </button>
            ))}
          </div>

          <form
            className="todos-add"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <IconPlus size={16} />
            <input
              ref={addRef}
              aria-label={t("Aggiungi una cosa da fare")}
              placeholder={t("Aggiungi una cosa da fare")}
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setNewText("");
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            {newText.trim() && (
              <>
                <input
                  className="when"
                  aria-label={t("Quando (facoltativo)")}
                  placeholder={t("quando (facoltativo)")}
                  value={newWhen}
                  onChange={(e) => setNewWhen(e.target.value)}
                />
                <button className="btn sm primary" type="submit">
                  {t("Aggiungi")}
                </button>
              </>
            )}
            {!newText.trim() && <kbd aria-hidden="true">N</kbd>}
          </form>

          <div className="todos-list" ref={listRef}>
            {todos === null && (
              <div className="todos-skeleton" aria-busy="true" aria-label={t("Carico le cose da fare")}>
                {[86, 64, 78, 70, 58].map((w, i) => (
                  <div key={i} className="sk-row">
                    <span className="skeleton sk-check" />
                    <span className="sk-lines">
                      <span className="skeleton" style={{ width: `${w}%` }} />
                      <span className="skeleton sk-sub" />
                    </span>
                  </div>
                ))}
              </div>
            )}

            {todos !== null &&
              BUCKET_ORDER.map((b) =>
                buckets[b].length === 0 ? null : (
                  <section key={b} className={"todos-bucket" + (b === "ritardo" ? " late" : "")} aria-labelledby={`bucket-${b}`}>
                    <h2 className="todos-bucket-label" id={`bucket-${b}`}>
                      {bucketLabel(b)}
                      <span className="n">{buckets[b].length}</span>
                    </h2>
                    <ul>{buckets[b].map(row)}</ul>
                  </section>
                ),
              )}

            {todos !== null && nothing && (
              <div className="empty-state">
                {query.trim() ? (
                  <>
                    <p className="empty-title">{t("Niente per “{query}”", { query: query.trim() })}</p>
                    <button className="btn sm" onClick={() => setQuery("")}>
                      {t("Togli la ricerca")}
                    </button>
                  </>
                ) : tab === "mie" ? (
                  <>
                    <p className="empty-title">{t("Non hai niente in sospeso")}</p>
                    <p>{t("Quando in una call qualcuno dice “ci penso io”, Mori lo scrive qui con la scadenza. Puoi anche aggiungerne una a mano (N).")}</p>
                  </>
                ) : (
                  <p className="empty-title">{t("Niente in sospeso qui")}</p>
                )}
              </div>
            )}

            {done.length > 0 && (
              <div className="todos-done">
                <button className={"todos-done-head" + (showDone ? " open" : "")} aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
                  <IconChevron size={14} />
                  {t("Fatte · {n}", { n: done.length })}
                </button>
                {showDone && <ul className="todos-done-body">{done.map(row)}</ul>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function dueClass(t: Todo): string {
  if (t.due.kind === "none") return "todo-due";
  if (t.due.kind === "unknown") return "todo-due raw";
  const b = bucketOf(t.due);
  if (b === "ritardo") return "todo-due late";
  if (b === "settimana") return "todo-due soon";
  return "todo-due";
}

/** The section titles: todo-logic's labels are the Italian (and the tests'). */
function bucketLabel(b: Bucket): string {
  switch (b) {
    case "ritardo": return t("In ritardo");
    case "settimana": return t("Questa settimana");
    case "avanti": return t("Più avanti");
    default: return t("Senza data");
  }
}

function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}
