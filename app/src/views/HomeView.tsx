// "Oggi" — what Mori opens on. A companion greets you with what matters today:
// what is yours and due, what others owe you, which calls it still has to read,
// and questions worth one click — all computed on this PC, no model involved.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../db";
import type { SessionJob } from "../jobs";
import Dragon from "../ui/Mark";
import { loadHome, type HomeData } from "./home";
import { hotkeyLabel, isTyping } from "../ui/keys";
import { dueLabel } from "../ui/format";
import { countLate, greeting, longDate, myFocus, statsLine, suggestQuestions, waitingOn } from "./home-logic";
import { bucketOf } from "./todo-logic";
import { isAutoTitle } from "../recording-logic";
import { setTodoStatus, type Todo } from "./todos";
import { DEFAULT_MY_NAMES } from "./todo-logic";
import { t, tn } from "../i18n";
import { assigneeLabel } from "../speakers-logic";
import QuickKey from "./QuickKey";
import type { ProviderConfig } from "../llm";

const DAY = 86_400_000;

export default function HomeView({
  sessions,
  myNames,
  jobs,
  providerOk,
  hotkey,
  refreshKey,
  recording,
  onAsk,
  onOpenCall,
  onOpenPerson,
  onOpenTodos,
  onRecord,
  onAddCall,
  onOpenSettings,
  onSaveProvider,
  onChanged,
  onError,
  onRemoveDemo,
  demoHidden,
}: {
  sessions: Session[];
  myNames: string[];
  jobs: Record<string, SessionJob>;
  providerOk: boolean;
  hotkey: string;
  refreshKey: number;
  recording: boolean;
  onAsk: (q: string) => void;
  onOpenCall: (id: string, start?: number | null) => void;
  onOpenPerson: (id: string) => void;
  onOpenTodos: () => void;
  onRecord: () => void;
  onAddCall: () => void;
  onOpenSettings: (section?: "modello" | "nomi") => void;
  /** The key pasted in the first step, checked: save it as the model. */
  onSaveProvider: (cfg: ProviderConfig) => void;
  onChanged: () => void;
  onError: (m: string) => void;
  /** Take the demo calls away (with Annulla). */
  onRemoveDemo: () => void;
  /** They are being taken away: don't offer it again. */
  demoHidden: boolean;
}) {
  const [data, setData] = useState<HomeData | null>(null);
  const [draft, setDraft] = useState("");
  const askRef = useRef<HTMLInputElement>(null);
  const now = new Date();

  // "/" writes to Mori, from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isTyping(e.target) && !document.querySelector(".dialog-backdrop, .cmd-backdrop")) {
        e.preventDefault();
        askRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function reload() {
    try {
      setData(await loadHome(myNames));
    } catch (e) {
      onError(t("Non riesco a preparare la pagina di oggi: {error}", { error: String(e) }));
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, myNames.join(","), sessions.length]);

  const todos = data?.todos ?? [];
  const homeTodos = useMemo(
    () => todos.map((t) => ({ ...t, sessionAt: t.source.startedAt })),
    [todos],
  );
  const focus = useMemo(() => myFocus(homeTodos, new Date(), 6), [homeTodos]);
  const waiting = useMemo(() => waitingOn(homeTodos, 5), [homeTodos]);
  const late = countLate(homeTodos);
  const openMine = homeTodos.filter((t) => t.status === "open" && t.mine).length;
  const thisWeek = sessions.filter((s) => s.started_at && Date.now() - Date.parse(s.started_at) < 7 * DAY).length;
  const failed = sessions.filter((s) => jobs[s.id]?.status === "failed" || s.status === "failed");

  const suggestions = suggestQuestions({
    openMine,
    late,
    people: (data?.people ?? []).map((p) => p.name),
    projects: (data?.projects ?? []).map((p) => p.name),
    // The latest call worth summarising: understood, with a real title.
    lastCallTitle:
      sessions.find((s) => s.status === "done" && !isAutoTitle(s.title))?.title ?? null,
  });

  const firstRun = !!data && (data.realCalls === 0 || !providerOk);
  const stats = data ? statsLine({ calls: data.realCalls, callsThisWeek: thisWeek, minutes: data.minutes, openMine }) : "";
  const namesSet = myNames.join(",") !== DEFAULT_MY_NAMES.join(",");
  const firstName = callName(myNames);
  // One sentence around the hotkey, so the translation keeps its word order.
  const [firstCallBefore, firstCallAfter = ""] = t(
    "Registra tu e chi ti parla, anche dal menu nella barra o con {key}. Oppure incolla un trascritto che hai già.",
  ).split("{key}");

  async function check(todo: Todo) {
    try {
      await setTodoStatus(todo, "done");
      await reload();
      onChanged();
    } catch (e) {
      onError(t("Non sono riuscito a segnarla: {error}", { error: String(e) }));
    }
  }

  function submit() {
    const q = draft.trim();
    if (!q) return;
    setDraft("");
    onAsk(q);
  }

  // "Still up?" keeps its question mark, after the name when there is one: no "Still up?."
  const asks = greeting(now).endsWith("?");
  const hello = asks ? greeting(now).slice(0, -1) : greeting(now);

  return (
    <div className="home">
      <div className="home-scroll">
        <div className="home-col">
          <header className="home-head">
            <h1>
              {hello}
              {firstName && (
                <>
                  , <em>{firstName}</em>
                </>
              )}
              {asks ? "?" : "."}
            </h1>
            <p className="home-sub">
              {longDate(now)}
              {stats && (
                <>
                  {" · "}
                  {stats}
                </>
              )}
            </p>
          </header>

          <form
            className="home-ask"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Dragon size={20} />
            <input
              ref={askRef}
              value={draft}
              placeholder={t("Chiedi a Mori qualcosa sulle tue conversazioni…")}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={t("Chiedi a Mori")}
            />
            {!draft.trim() && <kbd aria-hidden="true">/</kbd>}
            <button type="submit" className="btn primary" disabled={!draft.trim()}>
              {t("Chiedi")}
            </button>
          </form>
          <div className="home-sugg">
            {suggestions.slice(0, 3).map((s) => (
              <button key={s} onClick={() => onAsk(s)}>
                {s}
              </button>
            ))}
          </div>

          {firstRun && (
            <section className="home-card home-welcome">
              <h2>{t("Tre passi e Mori è tuo")}</h2>
              <ol className="welcome-steps">
                <li className={providerOk ? "done" : ""}>
                  <span className="ws-n">{providerOk ? "✓" : "1"}</span>
                  <div>
                    <strong>{t("Dagli un cervello")}</strong>
                    <span>
                      {providerOk
                        ? t("Una chiave Groq gratuita, oppure un modello sul tuo PC (Ollama, LM Studio): niente esce.")
                        : t("Una chiave Groq gratuita basta per tutto: capire le call e trascriverle in pochi secondi.")}
                    </span>
                    {!providerOk && <QuickKey onSaved={onSaveProvider} onMore={() => onOpenSettings("modello")} />}
                  </div>
                </li>
                <li className={data && data.realCalls > 0 ? "done" : ""}>
                  <span className="ws-n">{data && data.realCalls > 0 ? "✓" : "2"}</span>
                  <div>
                    <strong>{t("La prima call")}</strong>
                    <span>
                      {firstCallBefore}
                      <kbd>{hotkeyLabel(hotkey)}</kbd>
                      {firstCallAfter}
                    </span>
                  </div>
                  {!(data && data.realCalls > 0) && (
                    <span className="ws-actions">
                      <button className="btn sm primary" onClick={onRecord} disabled={recording}>
                        {recording ? t("Registro…") : t("Registra")}
                      </button>
                      <button className="btn sm" onClick={onAddCall}>
                        {t("Incolla")}
                      </button>
                    </span>
                  )}
                </li>
                <li className={namesSet ? "done" : ""}>
                  <span className="ws-n">{namesSet ? "✓" : "3"}</span>
                  <div>
                    <strong>{t("Dimmi come ti chiamano")}</strong>
                    <span>{t("Così divido le cose da fare tue da quelle degli altri.")}</span>
                  </div>
                  {!namesSet && (
                    <button className="btn sm" onClick={() => onOpenSettings("nomi")}>
                      {t("Impostazioni")}
                    </button>
                  )}
                </li>
              </ol>
              {data && data.seedCalls > 0 && !demoHidden && (
                <div className="welcome-demo">
                  <span>{tn(
                      data.seedCalls,
                      "Nello storico ci sono 1 call di esempio, per vedere come funziona.",
                      "Nello storico ci sono {n} call di esempio, per vedere come funziona.",
                    )}</span>
                  <button className="btn sm ghost" onClick={onRemoveDemo}>
                    {t("Toglile")}
                  </button>
                </div>
              )}
            </section>
          )}

          {!data && (
            <div className="home-grid" aria-busy="true" aria-label={t("Preparo la pagina di oggi")}>
              <div className="home-main">
                {[0, 1].map((k) => (
                  <section key={k} className="home-card">
                    <span className="skeleton sk-eyebrow" />
                    <div className="skeleton-lines">
                      {[84, 70, 78].map((w, i) => (
                        <span key={i} className="skeleton" style={{ width: `${w}%` }} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}

          {data && <div className="home-grid">
            <div className="home-main">
            <section className="home-card">
              <h2>
                {t("Tocca a te")}
                {late > 0 ? <span className="hc-late">{t("{n} in ritardo", { n: late })}</span> : openMine > 0 ? <span className="hc-n">{openMine}</span> : null}
              </h2>
              {focus.length === 0 ? (
                <p className="home-empty">{openMine === 0 ? t("Niente di aperto. Respira.") : t("Niente in scadenza questa settimana.")}</p>
              ) : (
                <ul className="home-list">
                  {focus.map((td) => {
                    const b = bucketOf(td.due);
                    return (
                      <li key={td.id} className="hl-row">
                        <button
                          className="check"
                          role="checkbox"
                          aria-checked={false}
                          aria-label={t("Segna fatta: {text}", { text: td.text })}
                          onClick={() => void check(td)}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                        </button>
                        <div className="hl-main">
                          <span className="hl-text">{td.text}</span>
                          {td.source.sessionId && (
                            <button className="hl-src" onClick={() => onOpenCall(td.source.sessionId!, td.source.startSec)}>
                              {td.source.title}
                            </button>
                          )}
                        </div>
                        {td.due.label && <span className={"hl-due" + (b === "ritardo" ? " late" : "")}>{dueLabel(td.due)}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {openMine > focus.length && (
                <button className="home-more" onClick={onOpenTodos}>
                  {t("Tutte le {n} cose tue →", { n: openMine })}
                </button>
              )}
            </section>

            <section className="home-card">
              <h2>
                {t("Aspetti da altri")}
                {waiting.length > 0 && <span className="hc-n">{waiting.length}</span>}
              </h2>
              {waiting.length === 0 ? (
                <p className="home-empty">{t("Nessuno ti deve niente, per ora.")}</p>
              ) : (
                <ul className="home-list">
                  {waiting.map((td) => {
                    const b = bucketOf(td.due);
                    return (
                      <li key={td.id} className="hl-row">
                        <span className="hl-who">{assigneeLabel((td.assignee ?? "").split(/[,/&]/)[0].trim())}</span>
                        <div className="hl-main">
                          <span className="hl-text">{td.text}</span>
                          {td.source.sessionId && (
                            <button className="hl-src" onClick={() => onOpenCall(td.source.sessionId!, td.source.startSec)}>
                              {td.source.title}
                            </button>
                          )}
                        </div>
                        {td.due.label && <span className={"hl-due" + (b === "ritardo" ? " late" : "")}>{dueLabel(td.due)}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {(data?.raw.length ?? 0) + failed.length > 0 && (
              <section className="home-card">
                <h2>{t("Da sistemare")}</h2>
                <ul className="home-list">
                  {failed.slice(0, 3).map((s) => (
                    <li key={s.id} className="hl-row">
                      <span className="hl-dot ko" />
                      <div className="hl-main">
                        <span className="hl-text">{s.title}</span>
                        <span className="hl-meta">{t("non è riuscita: apri e premi Riprova")}</span>
                      </div>
                      <button className="btn sm" onClick={() => onOpenCall(s.id)}>
                        {t("Apri")}
                      </button>
                    </li>
                  ))}
                  {(data?.raw ?? []).slice(0, 3).map((r) => (
                    <li key={r.id} className="hl-row">
                      <span className="hl-dot" />
                      <div className="hl-main">
                        <span className="hl-text">{r.title}</span>
                        <span className="hl-meta">
                          {jobs[r.id]?.kind === "organize" ? t("in coda per essere capita") : t("trascritta, non ancora capita")}
                        </span>
                      </div>
                      <button className="btn sm" onClick={() => onOpenCall(r.id)}>
                        {t("Apri")}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            </div>
            <div className="home-side">
            {(data?.people.length ?? 0) > 0 && (
              <section className="home-card">
                <h2>{t("Prima della prossima call")}</h2>
                <p className="home-lead">{t("Apri una scheda: cosa vi siete detti, chi deve cosa a chi.")}</p>
                <div className="home-people">
                  {(data?.people ?? []).slice(0, 8).map((p) => (
                    <button key={p.id} className="hp-chip" onClick={() => onOpenPerson(p.id)}>
                      <span className="hp-ini">{(p.name.trim()[0] ?? "?").toUpperCase()}</span>
                      {p.name}
                    </button>
                  ))}
                </div>
              </section>
            )}
            </div>
          </div>}
        </div>
      </div>
    </div>
  );
}

/** The name to greet with: the first real one among "how they call you",
 *  skipping the pronouns Mori starts with. Null when none was given. */
function callName(myNames: string[]): string | null {
  const defaults = new Set(DEFAULT_MY_NAMES.map((n) => n.toLowerCase()));
  const n = myNames.find((x) => !defaults.has(x.trim().toLowerCase()) && /^[A-ZÀ-Ý][\wÀ-ÿ'’-]{1,}$/.test(x.trim()));
  return n ? n.trim() : null;
}
