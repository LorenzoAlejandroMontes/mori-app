// Scheda persona / progetto, con il brief da leggere prima di rientrare in call.
// Struttura presa da HubSpot e Clay (nome grande, riassunto generato con data e
// "Rigenera", poi timeline) e da Juicebox (gli impegni divisi in due colonne).
// Il brief è corto come quelli di Tana: righe, non un documento.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  dossierFor,
  listEntities,
  mergeEntities,
  type Entity,
  type PersonDossier,
  type Debt,
} from "./people";
import { getBrief, splitCitations, type Brief } from "../brief";
import { bucketOf } from "./todo-logic";
import { isTyping } from "../ui/keys";
import { dueLabel, fmtDate, kindLabel } from "../ui/format";
import { t, tn, locale } from "../i18n";
import { IconBack, IconChat, IconFile, IconMerge, IconRefresh, IconSearch } from "../ui/icons";
import "./PersonView.css";

export default function PersonView({
  entityId,
  myNames,
  onOpenEntity,
  onOpenCall,
  onAsk,
  onError,
}: {
  entityId: string | null;
  myNames: string[];
  onOpenEntity: (id: string | null) => void;
  onOpenCall: (sessionId: string, startSec?: number | null) => void;
  onAsk: (question: string) => void;
  onError: (msg: string) => void;
}) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [dossier, setDossier] = useState<PersonDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefState, setBriefState] = useState<"idle" | "busy" | "thin" | "nokey" | "error">("idle");
  const [briefErr, setBriefErr] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergePick, setMergePick] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  // "/" filters the list.
  useEffect(() => {
    if (entityId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isTyping(e.target) && !document.querySelector(".dialog-backdrop, .cmd-backdrop")) {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entityId]);

  async function loadList() {
    try {
      setEntities(await listEntities());
    } catch (e) {
      onError(t("Non riesco a leggere le persone: {error}", { error: String(e) }));
    }
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    setBrief(null);
    setBriefState("idle");
    setMergeOpen(false);
    if (!entityId) {
      setDossier(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const d = await dossierFor(entityId, myNames);
        if (!alive) return;
        setDossier(d);
        if (d) void runBrief(d, false);
      } catch (e) {
        if (alive) onError(t("Non riesco ad aprire la scheda: {error}", { error: String(e) }));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, myNames.join(",")]);

  async function runBrief(d: PersonDossier, force: boolean) {
    setBriefState("busy");
    const res = await getBrief(d, force);
    if (res.state === "ok") {
      setBrief(res.brief);
      setBriefState("idle");
    } else if (res.state === "error") {
      setBriefErr(res.message);
      setBriefState("error");
    } else {
      setBriefState(res.state);
    }
  }

  async function doMerge() {
    if (!mergePick || !dossier) return;
    const from = mergePick;
    const into = dossier.entity.id;
    setMergeOpen(false);
    setMergePick(null);
    try {
      await mergeEntities(from, into);
      await loadList();
      const d = await dossierFor(into, myNames);
      setDossier(d);
      setBrief(null);
      if (d) void runBrief(d, true);
    } catch (e) {
      onError(t("Unione non riuscita: {error}", { error: String(e) }));
    }
  }

  const mergeCandidates = useMemo(() => {
    const q = mergeQuery.trim().toLowerCase();
    return entities
      .filter((e) => e.id !== entityId)
      .filter((e) => !q || e.name.toLowerCase().includes(q));
  }, [entities, entityId, mergeQuery]);

  // Nessuna scheda scelta: l'elenco di persone e progetti che Mori conosce.
  if (!entityId) {
    const fq = filter.trim().toLowerCase();
    const shown = entities.filter(
      (e) => !fq || e.name.toLowerCase().includes(fq) || e.aliases.some((a) => a.toLowerCase().includes(fq)),
    );
    // Arrows move through the cards: left/right one by one, up/down a row.
    const onGridKey = (ev: React.KeyboardEvent) => {
      const cards = Array.from(gridRef.current?.querySelectorAll<HTMLElement>(".people-card") ?? []);
      const i = cards.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      const cols = Math.max(1, Math.round((gridRef.current?.clientWidth ?? 1) / (cards[0]?.offsetWidth || 1)));
      const step = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowDown" ? cols : ev.key === "ArrowUp" ? -cols : 0;
      if (!step) return;
      ev.preventDefault();
      cards[Math.min(cards.length - 1, Math.max(0, i + step))]?.focus();
    };
    return (
      <div className="page person-view">
        <div className="page-scroll">
          <div className="page-col list-col">
            <header className="page-head">
              <div className="page-head-text">
                <h1 className="page-title">{t("Persone e progetti")}</h1>
                <p className="page-sub">
                  {tn(entities.length, "1 schede nate da quello che hai registrato", "{n} schede nate da quello che hai registrato")}
                </p>
              </div>
              {entities.length > 6 && (
                <label className="field-search people-filter">
                  <IconSearch size={15} />
                  <span className="sr-only">{t("Filtra le schede")}</span>
                  <input
                    ref={filterRef}
                    placeholder={t("Filtra per nome")}
                    value={filter}
                    onChange={(ev) => setFilter(ev.target.value)}
                    onKeyDown={(ev) => {
                      if (ev.key === "ArrowDown") {
                        ev.preventDefault();
                        gridRef.current?.querySelector<HTMLElement>(".people-card")?.focus();
                      }
                    }}
                  />
                  <kbd aria-hidden="true">/</kbd>
                </label>
              )}
            </header>
            {entities.length === 0 ? (
              <div className="empty-state">
                <p className="empty-title">{t("Ancora nessuna scheda")}</p>
                <p>
                  {t(
                    "Nascono da sole quando Mori capisce una call: le persone con cui parli e i progetti di cui parlate, con il brief da leggere prima della prossima volta.",
                  )}
                </p>
              </div>
            ) : (
              <div className="people-grid" ref={gridRef} onKeyDown={onGridKey}>
                {shown.map((e) => (
                  <button key={e.id} className="people-card" onClick={() => onOpenEntity(e.id)}>
                    <span className={"person-disc sm" + (e.kind === "project" ? " proj" : "")} aria-hidden="true">
                      {initial(e.name)}
                    </span>
                    <span className="people-card-text">
                      <span className="nm">{e.name}</span>
                      <span className="sb">
                        {e.kind === "project" ? t("Progetto") : t("Persona")} · {tn(e.calls, "1 call", "{n} call")}
                        {e.aliases.length ? ` · ${t("anche {names}", { names: e.aliases.join(", ") })}` : ""}
                      </span>
                    </span>
                  </button>
                ))}
                {shown.length === 0 && <p className="people-none">{t("Nessuna scheda per “{query}”.", { query: filter.trim() })}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page person-view" aria-busy="true" aria-label={t("Apro la scheda")}>
        <div className="page-scroll">
          <div className="page-col list-col">
            <div className="person-head">
              <span className="skeleton sk-disc" />
              <span className="sk-lines">
                <span className="skeleton sk-name" />
                <span className="skeleton sk-sub" />
              </span>
            </div>
            <div className="brief">
              <div className="skeleton-lines">
                {[90, 76, 84].map((w, i) => (
                  <span key={i} className="skeleton" style={{ width: `${w}%` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!dossier) {
    return (
      <div className="page person-view">
        <div className="page-scroll">
          <div className="page-col list-col">
            <div className="empty-state">
              <p className="empty-title">{t("Questa scheda non esiste più")}</p>
              <p>{t("Forse è stata unita a un'altra.")}</p>
              <button className="btn sm" onClick={() => onOpenEntity(null)}>
                {t("Torna all'elenco")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const e = dossier.entity;
  const isProj = e.kind === "project";

  return (
    <div className="page person-view">
      <div className="page-scroll">
      <div className="page-col list-col">
        <button className="btn ghost sm back-btn person-back" onClick={() => onOpenEntity(null)}>
          <IconBack size={15} />
          {t("Persone e progetti")}
        </button>
        <header className="person-head">
          <div className={"person-disc" + (isProj ? " proj" : "")} aria-hidden="true">{initial(e.name)}</div>
          <div>
            <h1 className="person-name">
              {e.name}
              <span className={"person-kind" + (isProj ? " proj" : "")}>{isProj ? t("Progetto") : t("Persona")}</span>
            </h1>
            <p className="person-sub">
              {tn(dossier.calls.length, "1 call insieme", "{n} call insieme")}
              {dossier.calls[0]?.startedAt ? ` · ${t("ultima {date}", { date: fmtDate(dossier.calls[0].startedAt) })}` : ""}
              {e.aliases.length ? ` · ${t("anche {names}", { names: e.aliases.join(", ") })}` : ""}
            </p>
          </div>
          <div className="person-acts">
            <button className={"btn sm" + (mergeOpen ? " pressed" : "")} aria-expanded={mergeOpen} onClick={() => setMergeOpen((v) => !v)}>
              <IconMerge size={14} />
              {t("Unisci")}
            </button>
            <button className="btn sm" onClick={() => onAsk(t("Cosa devo sapere su {name}?", { name: e.name }))}>
              <IconChat size={14} />
              {t("Chiedi a Mori")}
            </button>

            {mergeOpen && (
              <>
                <div className="merge-backdrop" onClick={() => setMergeOpen(false)} />
                <div className="merge-pop">
                  <input
                    className="merge-search"
                    autoFocus
                    aria-label={t("Cerca la scheda da unire")}
                    placeholder={t("Cerca una persona o un progetto…")}
                    value={mergeQuery}
                    onChange={(ev) => setMergeQuery(ev.target.value)}
                  />
                  <div className="merge-list">
                    {mergeCandidates.length === 0 && <div className="person-empty" style={{ padding: "10px 12px" }}>{t("Nessun'altra scheda.")}</div>}
                    {mergeCandidates.map((c) => (
                      <button
                        key={c.id}
                        className={"merge-row" + (mergePick === c.id ? " on" : "")}
                        onClick={() => setMergePick(c.id)}
                      >
                        <span className={"merge-mini" + (c.kind === "project" ? " proj" : "")}>{initial(c.name)}</span>
                        {c.name}
                        <span className="merge-cnt">{tn(c.calls, "1 call", "{n} call")}</span>
                      </button>
                    ))}
                  </div>
                  <div className="merge-foot">
                    <span className="merge-note">
                      {mergePick
                        ? t("Le call di {name} passano qui, e quel nome resta come alias.", {
                            name: entities.find((x) => x.id === mergePick)?.name ?? "",
                          })
                        : t("Scegli la scheda da far confluire in questa.")}
                    </span>
                    <button className="btn sm primary" disabled={!mergePick} onClick={() => void doMerge()}>
                      {t("Unisci")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        <section className="brief">
          <div className="brief-head">
            <span className="brief-title">
              {isProj ? t("L'ultima volta su {name}", { name: e.name }) : t("L'ultima volta con {name}", { name: e.name })}
            </span>
            {brief && (
              <span className="brief-when">
                {fmtShort(brief.createdAt)}
                {dossier.calls[0] ? ` · ${t("dalla call del {date}", { date: fmtShort(dossier.calls[0].startedAt) })}` : ""}
              </span>
            )}
            {brief && (
              <button
                className="btn sm ghost brief-refresh"
                disabled={briefState === "busy"}
                onClick={() => void runBrief(dossier, true)}
              >
                <IconRefresh size={13} />
                {briefState === "busy" ? t("Scrivo…") : t("Rigenera")}
              </button>
            )}
          </div>

          {briefState === "busy" && !brief && (
            <div className="skeleton-lines" role="status" aria-label={t("Scrivo il brief")}>
              {[88, 72, 80].map((w, i) => (
                <span key={i} className="skeleton" style={{ width: `${w}%` }} />
              ))}
            </div>
          )}

          {brief &&
            brief.lines.map((line, i) => {
              const { text, cited } = splitCitations(line, brief.sources);
              return (
                <p key={i} className="brief-line">
                  {text}
                  {cited.map((c) => (
                    <button key={c.id} className="brief-cite" onClick={() => onOpenCall(c.id)}>
                      {c.title} · {c.date}
                    </button>
                  ))}
                </p>
              );
            })}

          {!brief && briefState === "thin" && (
            <p className="brief-msg">
              {dossier.calls.length === 0
                ? t("Per ora c'è troppo poco: nessuna call collegata. Torna qui dopo la prossima.")
                : t("Per ora c'è troppo poco: una sola call e nessun impegno aperto. Torna qui dopo la prossima.")}
            </p>
          )}
          {!brief && briefState === "nokey" && (
            <p className="brief-msg">
              {t(
                "Il brief lo scrive il modello: imposta il provider nelle impostazioni (una chiave Groq gratuita, o un modello sul tuo PC) e torna qui.",
              )}
            </p>
          )}
          {!brief && briefState === "error" && (
            <>
              <p className="brief-msg">{t("Non sono riuscito a scriverlo: {error}", { error: briefErr })}</p>
              <button className="btn sm primary" onClick={() => void runBrief(dossier, true)}>{t("Riprova")}</button>
            </>
          )}
          {!brief && briefState === "idle" && (
            <button className="btn sm primary" onClick={() => void runBrief(dossier, true)}>{t("Prepara il brief")}</button>
          )}
        </section>

        <div className="person-grid2">
          <DebtCard
            tone="them"
            title={isProj ? t("In sospeso dagli altri") : t("Ti deve")}
            debts={dossier.theyOwe}
            empty={t("Niente in sospeso da parte sua.")}
            onOpenCall={onOpenCall}
          />
          <DebtCard
            tone="me"
            title={isProj ? t("In sospeso da te") : t("Gli devi")}
            debts={dossier.iOwe}
            empty={t("Niente in sospeso da parte tua.")}
            onOpenCall={onOpenCall}
          />
        </div>

        {dossier.decisions.length > 0 && (
          <section className="person-sec">
            <h2 className="person-sec-title">{t("Decisioni prese insieme")}</h2>
            {dossier.decisions.slice(0, 12).map((d) => (
              <div key={d.id} className="person-dec">
                <span className="b" />
                <span>
                  {d.what}
                  {d.figures ? ` (${d.figures})` : ""}
                  <button className="brief-cite" onClick={() => onOpenCall(d.sessionId, d.startSec)}>
                    {d.sessionTitle}
                  </button>
                </span>
              </div>
            ))}
          </section>
        )}

        {dossier.memories.length > 0 && (
          <section className="person-sec">
            <h2 className="person-sec-title">{t("Cosa Mori ricorda")}</h2>
            {dossier.memories.slice(0, 14).map((m, i) => (
              <div key={i} className="person-mem">
                <span className={"person-mem-kind k-" + m.kind}>{kindLabel(m.kind)}</span>
                <span>{m.content}</span>
              </div>
            ))}
          </section>
        )}

        <section className="person-sec">
          <h2 className="person-sec-title">{t("Call insieme")}</h2>
          {dossier.calls.length === 0 ? (
            <div className="person-empty">{t("Nessuna call collegata a questa scheda.")}</div>
          ) : (
            dossier.calls.map((c) => (
              <button key={c.id} className="person-tl" onClick={() => onOpenCall(c.id)}>
                <span className="person-tl-date">{fmtDate(c.startedAt)}</span>
                <span className="person-tl-title">{c.title}</span>
                <span className="person-tl-sub">
                  {tn(c.decisions, "1 decisioni", "{n} decisioni")} · {tn(c.actions, "1 azioni", "{n} azioni")}
                </span>
              </button>
            ))
          )}
        </section>
      </div>
      </div>
    </div>
  );
}

function DebtCard({
  tone,
  title,
  debts,
  empty,
  onOpenCall,
}: {
  tone: "them" | "me";
  title: string;
  debts: Debt[];
  empty: string;
  onOpenCall: (sessionId: string, startSec?: number | null) => void;
}) {
  return (
    <section className="person-card">
      <div className="person-card-head">
        <span className={"person-dot " + tone} />
        <h2>{title}</h2>
        <span className="n">{debts.length}</span>
      </div>
      {debts.length === 0 && <div className="person-empty">{empty}</div>}
      {debts.slice(0, 8).map((d) => (
        <div key={d.id} className="person-debt">
          <div className="person-debt-txt">{d.what}</div>
          <div className="person-debt-meta">
            {d.due.kind !== "none" && (
              <span
                className={
                  "todo-due" +
                  (d.due.kind === "unknown" ? " raw" : bucketOf(d.due) === "ritardo" ? " late" : bucketOf(d.due) === "settimana" ? " soon" : "")
                }
                title={d.dueRaw ? t("Detto nella call: “{raw}”", { raw: d.dueRaw }) : undefined}
              >
                {dueLabel(d.due)}
              </span>
            )}
            <button className="todo-src" onClick={() => onOpenCall(d.sessionId)}>
              <IconFile size={12} />
              {d.sessionTitle}
            </button>
            {d.startSec != null && (
              <button className="todo-seek mono" title={t("Ascolta il momento")} onClick={() => onOpenCall(d.sessionId, d.startSec)}>
                ▶ {clock(d.startSec)}
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function fmtShort(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(locale(), { day: "2-digit", month: "short" });
}

function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}
