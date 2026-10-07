// "Tutte le call" — the archive (reference: Linear's lists). Rows, not cards:
// title, people, categories, date. Grouped by time, filtered by category,
// searched with "/". Arrows (or J/K) move, Enter opens.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Category, CategoryCount, Session } from "../db";
import type { SessionJob } from "../jobs";
import Menu from "../ui/Menu";
import { groupByTime } from "../ui/format";
import { isTyping, moveFocus } from "../ui/keys";
import { IconAlert, IconClose, IconMore, IconPlus, IconRefresh, IconSearch, IconTrash, LockIcon } from "../ui/icons";
import { t, tn, locale } from "../i18n";
import "./HistoryView.css";

export default function HistoryView({
  sessions,
  cats,
  jobs,
  catCounts,
  allCats,
  query,
  setQuery,
  catFilter,
  setCatFilter,
  recat,
  indexing,
  onRecategorize,
  onIndexAll,
  onOpenSession,
  onAddCall,
  onCreateCat,
  onRenameCat,
  onDeleteCat,
}: {
  sessions: Session[];
  cats: Record<string, Category[]>;
  jobs: Record<string, SessionJob>;
  catCounts: CategoryCount[];
  allCats: CategoryCount[];
  query: string;
  setQuery: (q: string) => void;
  catFilter: string | null;
  setCatFilter: (id: string | null) => void;
  recat: { done: number; total: number } | null;
  indexing: { done: number; total: number } | null;
  onRecategorize: () => void;
  onIndexAll: () => void;
  onOpenSession: (id: string) => void;
  onAddCall: () => void;
  onCreateCat: (name: string) => void;
  onRenameCat: (id: string, name: string) => void;
  onDeleteCat: (id: string) => void;
}) {
  const [manageCats, setManageCats] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (catFilter && !(cats[s.id] ?? []).some((c) => c.id === catFilter)) return false;
      if (!q) return true;
      const inTitle = s.title.toLowerCase().includes(q);
      const inCat = (cats[s.id] ?? []).some((c) => c.name.toLowerCase().includes(q));
      const inPeople = (s.participants ?? "").toLowerCase().includes(q);
      return inTitle || inCat || inPeople;
    });
  }, [query, sessions, cats, catFilter]);

  const grouped = useMemo(() => groupByTime(filtered), [filtered]);

  // "/" searches, from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isTyping(e.target) && !document.querySelector(".dialog-backdrop, .cmd-backdrop")) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="page">
      <div className="page-scroll">
        <div className="page-col list-col">
          <header className="page-head">
            <div className="page-head-text">
              <h1 className="page-title">{t("Tutte le call")}</h1>
              <p className="page-sub">
                {tn(sessions.length, "1 call", "{n} call")} · {tn(allCats.length, "{n} categoria", "{n} categorie")}
              </p>
            </div>
            <div className="page-head-actions">
              <button className="btn sm" onClick={onAddCall}>
                <IconPlus size={14} />
                {t("Incolla un trascritto")}
              </button>
              <Menu
                label={t("Altre azioni sulle call")}
                icon={<IconMore />}
                items={[
                  {
                    label: recat ? t("Riorganizzo {done}/{total}…", { done: recat.done, total: recat.total }) : t("Riorganizza le categorie"),
                    icon: <IconRefresh />,
                    onSelect: onRecategorize,
                  },
                  {
                    label: indexing ? t("Indicizzo {done}/{total}…", { done: indexing.done, total: indexing.total }) : t("Prepara il richiamo su tutte"),
                    icon: <IconSearch />,
                    onSelect: onIndexAll,
                  },
                  { label: manageCats ? t("Chiudi la gestione categorie") : t("Gestisci le categorie"), onSelect: () => setManageCats((v) => !v) },
                ]}
              />
            </div>
          </header>

          <div className="list-tools">
            <label className="field-search">
              <IconSearch size={15} />
              <span className="sr-only">{t("Cerca nelle call")}</span>
              <input
                ref={searchRef}
                placeholder={t("Cerca per titolo, persona o categoria")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.stopPropagation();
                    setQuery("");
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    listRef.current?.querySelector<HTMLElement>(".call-row")?.focus();
                  }
                }}
              />
              <kbd aria-hidden="true">/</kbd>
            </label>
            {catCounts.length > 0 && (
              <div className="filter-chips" role="group" aria-label={t("Filtra per categoria")}>
                <button className="filter-chip" aria-pressed={catFilter === null} onClick={() => setCatFilter(null)}>
                  {t("Tutte")} <span className="fc-n">{sessions.length}</span>
                </button>
                {catCounts.map((c) => (
                  <button
                    key={c.id}
                    className="filter-chip"
                    aria-pressed={catFilter === c.id}
                    onClick={() => setCatFilter(catFilter === c.id ? null : c.id)}
                  >
                    <span className="tag-dot" style={{ ["--tag" as string]: c.color ?? "var(--line-strong)" }} aria-hidden="true" />
                    {c.name} <span className="fc-n">{c.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {manageCats && (
            <CategoryManager
              allCats={allCats}
              onCreate={onCreateCat}
              onRename={onRenameCat}
              onDelete={onDeleteCat}
              onClose={() => setManageCats(false)}
            />
          )}

          <div className="call-list" ref={listRef} onKeyDown={(e) => moveFocus(e, listRef.current, ".call-row")}>
            {grouped.map((g) => (
              <section key={g.label} className="list-group" aria-label={g.label}>
                <h2 className="list-group-label">{g.label}</h2>
                <ul>
                  {g.items.map((s) => {
                    const failed = s.status === "failed" || jobs[s.id]?.status === "failed";
                    const sc = cats[s.id] ?? [];
                    return (
                      <li key={s.id}>
                        <button className="call-row" onClick={() => onOpenSession(s.id)}>
                          <span className="cr-main">
                            <span className="cr-title">
                              {s.sensitive === 1 && (
                                <span className="cr-priv" title={t("Privata: la legge solo un modello sul tuo PC")}>
                                  <LockIcon size={12} />
                                  <span className="sr-only">{t("privata,")}</span>
                                </span>
                              )}
                              {s.title}
                            </span>
                            {s.participants && <span className="cr-people">{s.participants}</span>}
                          </span>
                          <span className="cr-side">
                            {s.status === "transcribing" && (
                              <span className="cr-state">
                                <span className="spinner sm" aria-hidden="true" /> {t("trascrivo")}
                              </span>
                            )}
                            {failed && (
                              <span className="cr-state ko">
                                <IconAlert size={13} /> {t("da riprovare")}
                              </span>
                            )}
                            {sc.slice(0, 2).map((c) => (
                              <span key={c.id} className="tag cr-tag" style={{ ["--tag" as string]: c.color ?? "var(--line-strong)" }}>
                                <span className="tag-dot" aria-hidden="true" />
                                {c.name}
                              </span>
                            ))}
                            {sc.length > 2 && <span className="cr-more">+{sc.length - 2}</span>}
                            <span className="cr-date mono">{shortDate(s.started_at)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {filtered.length === 0 && (
              <div className="empty-state">
                {sessions.length === 0 ? (
                  <>
                    <p className="empty-title">{t("Ancora nessuna call")}</p>
                    <p>{t("Premi Registra in alto a sinistra quando inizia la prossima, oppure incolla il trascritto di una che hai già.")}</p>
                    <button className="btn sm primary" onClick={onAddCall}>
                      {t("Incolla un trascritto")}
                    </button>
                  </>
                ) : query ? (
                  <>
                    <p className="empty-title">{t("Nessuna call per “{query}”", { query })}</p>
                    <p>{t("Cerco nei titoli, nei nomi e nelle categorie. Per le frasi dette nelle call usa Ctrl K.")}</p>
                    <button className="btn sm" onClick={() => setQuery("")}>
                      {t("Togli la ricerca")}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="empty-title">{t("Nessuna call in questa categoria")}</p>
                    <button className="btn sm" onClick={() => setCatFilter(null)}>
                      {t("Mostra tutte")}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryManager({
  allCats,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: {
  allCats: CategoryCount[];
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");

  function rename(id: string) {
    const name = editName.trim();
    setEditId(null);
    if (name) onRename(id, name);
  }
  function create() {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    onCreate(name);
  }

  return (
    <section className="cat-manage" aria-label={t("Gestisci le categorie")}>
      <div className="cat-manage-head">
        <h2 className="eyebrow">{t("Categorie")}</h2>
        <button className="icon-btn" onClick={onClose} aria-label={t("Chiudi la gestione categorie")}>
          <IconClose size={15} />
        </button>
      </div>
      <form
        className="cat-manage-new"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input
          placeholder={t("Nuova categoria")}
          aria-label={t("Nome della nuova categoria")}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="btn sm primary" type="submit" disabled={!newName.trim()}>
          {t("Crea")}
        </button>
      </form>
      {allCats.length === 0 && <p className="cat-manage-empty">{t("Ancora nessuna categoria: nascono quando Mori capisce una call, o le crei qui.")}</p>}
      <ul>
        {allCats.map((c) => (
          <li key={c.id} className="cat-manage-row">
            <span className="tag-dot" style={{ ["--tag" as string]: c.color ?? "var(--line-strong)" }} aria-hidden="true" />
            {editId === c.id ? (
              <input
                autoFocus
                className="cat-edit"
                aria-label={t("Nuovo nome per {name}", { name: c.name })}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") rename(c.id);
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setEditId(null);
                  }
                }}
                onBlur={() => rename(c.id)}
              />
            ) : (
              <button className="cat-name" onClick={() => { setEditId(c.id); setEditName(c.name); }} title={t("Clicca per rinominare")}>
                {c.name}
              </button>
            )}
            <span className="cat-count mono">{tn(c.count, "1 call", "{n} call")}</span>
            <button className="icon-btn danger-hover" aria-label={t("Elimina la categoria {name}", { name: c.name })} title={t("Elimina la categoria (le call restano)")} onClick={() => onDelete(c.id)}>
              <IconTrash size={15} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "oggi 11:02", "ieri", "3 ott". */
function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = 86_400_000;
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / day);
  if (diff === 0) return d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  if (diff === 1) return t("ieri");
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale(), sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}
