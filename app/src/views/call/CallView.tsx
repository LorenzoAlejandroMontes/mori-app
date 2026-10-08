// The page of one call (docs/DESIGN.md §5, reference: Granola). The document
// is the hero: title, one line of who/when/what, then Sintesi · Trascritto ·
// Da fare. Actions live in the bar on top; the chat opens beside it on demand.
import { useEffect, useRef, useState } from "react";
import type { ActionItem, Category, CategoryCount } from "../../db";
import type { SessionJob } from "../../jobs";
import { jobLabel, isWaitingNotice, noticeText, retrySession } from "../../jobs";
import type { Entity } from "../people";
import { applySpeakerMap, assigneeLabel, otherLabelsIn, relabelText, speakerLabel } from "../../speakers-logic";
import Markdown from "../../ui/Markdown";
import Dragon from "../../ui/Mark";
import Menu from "../../ui/Menu";
import { isTyping } from "../../ui/keys";
import { useTabInk } from "../../ui/useTabInk";
import { fmtDate, kindLabel } from "../../ui/format";
import {
  IconBack,
  IconChat,
  IconClose,
  IconCopy,
  IconFile,
  IconMail,
  IconMore,
  IconPencil,
  IconPlus,
  IconTrash,
  LockIcon,
} from "../../ui/icons";
import type { OpenSource } from "../chat/AnswerBody";
import ChatThread from "../chat/ChatThread";
import type { Chat } from "../chat/useChat";
import { SegmentPlayer, SpeakerNamer, TranscriptView, speakerSuggestions } from "./Transcript";
import type { CallTab, Detail, SeekRequest } from "./types";
import { t, locale } from "../../i18n";
import { useTranscribeProgress, useUnderstanding } from "../../progress";
import { progressLine, understandFraction, understandLine } from "../../progress-logic";
import { getSttSettings } from "../../recorder";
import { ProgressLine } from "../recording/TranscribeProgress";
import "./CallView.css";

const TABS: { id: CallTab; label: string }[] = [
  { id: "sintesi", label: t("Sintesi") },
  { id: "trascritto", label: t("Trascritto") },
  { id: "dafare", label: t("Da fare") },
];

export default function CallView({
  detail,
  cats,
  allCats,
  job,
  organizing,
  organizeError,
  tab,
  setTab,
  seekReq,
  entities,
  myNames,
  chat,
  backLabel,
  onBack,
  onPrev,
  onNext,
  panelOpen,
  setPanelOpen,
  onOpenSource,
  onRename,
  onDelete,
  onTogglePrivate,
  onCopyMarkdown,
  onCopyTranscript,
  onSaveTranscript,
  onCopyTranscriptForAi,
  onFollowUp,
  onOpenPersonByName,
  onAssignCat,
  onUnlinkCat,
  onOpenSettings,
  onOrganize,
  onNameSpeaker,
  onToggleAction,
}: {
  detail: Detail;
  /** This call's categories, as the list shows them. */
  cats: Category[];
  allCats: CategoryCount[];
  job: SessionJob | undefined;
  organizing: boolean;
  organizeError: string | null;
  tab: CallTab;
  setTab: (t: CallTab) => void;
  seekReq: SeekRequest | null;
  entities: Entity[];
  myNames: string[];
  chat: Chat;
  /** Where "←" goes back to, by name. */
  backLabel: string;
  onBack: () => void;
  /** The call above / below in the list (K / J), when there is one. */
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  onOpenSource: OpenSource;
  onRename: (title: string) => Promise<void>;
  onDelete: () => void;
  onTogglePrivate: (on: boolean) => void;
  onCopyMarkdown: () => void;
  onCopyTranscript: () => void;
  onSaveTranscript: () => void;
  onCopyTranscriptForAi: () => void;
  onFollowUp: () => void;
  onOpenPersonByName: (name: string) => void;
  onAssignCat: (name: string) => void;
  onUnlinkCat: (catId: string) => void;
  onOpenSettings: () => void;
  onOrganize: () => void;
  onNameSpeaker: (label: string, name: string) => void;
  onToggleAction: (a: ActionItem) => Promise<void>;
}) {
  const id = detail.session.id;
  const priv = !!detail.session.sensitive;
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const ink = useTabInk(tabsRef, tab);

  const ready = detail.session.status !== "transcribing" && detail.session.status !== "failed";
  const progress = useTranscribeProgress();
  const live = progress && progress.sessionId === detail.session.id ? progress : null;
  const understanding = useUnderstanding();
  const understandingThis = understanding && understanding.sessionId === detail.session.id ? understanding : null;
  const duration = detail.segments.reduce((m, x) => Math.max(m, x.end), 0);
  const openActions = detail.actions.filter((a) => a.status === "open").length;

  function startRename() {
    setTitleDraft(detail.session.title);
    setEditingTitle(true);
  }

  async function saveTitle() {
    const t = titleDraft.trim();
    setEditingTitle(false);
    if (!t || t === detail.session.title) return;
    await onRename(t);
  }

  // The page's keys: J/K next and previous call, 1 2 3 the tabs, Ctrl+J the
  // chat, Esc closes the chat or goes back. Quiet while typing (except Esc in
  // the chat) and while a dialog or ⌘K is open.
  const keys = useRef({ panelOpen, setPanelOpen, onBack, onPrev, onNext, setTab, ready });
  keys.current = { panelOpen, setPanelOpen, onBack, onPrev, onNext, setTab, ready };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector(".dialog-backdrop, .cmd-backdrop")) return;
      const k = keys.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        k.setPanelOpen(!k.panelOpen);
        return;
      }
      if (e.key === "Escape" && k.panelOpen) {
        k.setPanelOpen(false);
        return;
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") k.onBack();
      else if (e.key === "j" && k.onNext) k.onNext();
      else if (e.key === "k" && k.onPrev) k.onPrev();
      else if (k.ready && (e.key === "1" || e.key === "2" || e.key === "3")) k.setTab(TABS[Number(e.key) - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A new call starts at the top of the page.
  useEffect(() => {
    docRef.current?.scrollTo({ top: 0 });
  }, [id]);

  function onTabKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    setTab(TABS[next].id);
    document.getElementById(`tab-${TABS[next].id}`)?.focus();
  }

  const menuItems = [
    ...(detail.transcript
      ? [{ label: t("Copia come Markdown"), icon: <IconCopy />, onSelect: onCopyMarkdown }]
      : []),
    { label: t("Rinomina"), icon: <IconPencil />, onSelect: startRename },
    { label: t("Elimina la call"), icon: <IconTrash />, onSelect: onDelete, danger: true },
  ];

  return (
    <div className={"call-page" + (panelOpen ? " with-panel" : "")}>
      <div className="call-doc" ref={docRef}>
        <div className="call-bar">
          <button className="btn ghost sm back-btn" onClick={onBack} title={t("Torna a {place} (Esc)", { place: backLabel })}>
            <IconBack size={15} />
            {backLabel}
          </button>
          <div className="call-bar-actions">
            <button
              className={"icon-btn lock-btn" + (priv ? " on" : "")}
              data-action="private"
              aria-pressed={priv}
              aria-label={priv ? t("Call privata: la legge solo un modello sul tuo PC") : t("Rendi privata")}
              title={
                priv
                  ? t("Privata: la legge solo un modello sul tuo PC. Clicca per toglierla.")
                  : t("Rendila privata: da qui in poi nessun pezzo di questa call andrà a un modello in cloud.")
              }
              onClick={() => onTogglePrivate(!priv)}
            >
              <LockIcon open={!priv} size={16} />
            </button>
            {detail.transcript && (
              <button className="btn ghost sm collapsible" onClick={onFollowUp} title={t("Mori scrive la mail di follow-up dai fatti già estratti")}>
                <IconMail size={15} />
                <span className="btn-label">Follow-up</span>
              </button>
            )}
            <button
              className={"btn sm collapsible" + (panelOpen ? " pressed" : "")}
              aria-pressed={panelOpen}
              onClick={() => setPanelOpen(!panelOpen)}
              title={t("Chiedi a Mori (Ctrl J)")}
            >
              <IconChat size={15} />
              <span className="btn-label">{t("Chiedi")}</span>
            </button>
            <Menu label={t("Altre azioni")} icon={<IconMore />} items={menuItems} />
          </div>
        </div>

        <article className="call-col">
          <header className="call-head">
            {editingTitle ? (
              <input
                className="title-edit"
                autoFocus
                aria-label={t("Titolo della call")}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveTitle();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setEditingTitle(false);
                  }
                }}
              />
            ) : (
              <h1 className="call-title">
                <button className="title-btn" onClick={startRename} title={t("Clicca per rinominare")}>
                  {detail.session.title}
                  <IconPencil size={14} />
                </button>
              </h1>
            )}

            <div className="call-meta">
              {priv && (
                <span className="tag tag-private" title={t("Privata: la legge solo un modello sul tuo PC")}>
                  <LockIcon size={11} />
                  {t("Privata")}
                </span>
              )}
              <span className="meta-item">
                {longDay(detail.session.started_at)}
                {duration > 0 && <span className="meta-dur mono">{fmtDuration(duration)}</span>}
              </span>
              {detail.participants.length > 0 && (
                <span className="meta-item meta-people">
                  {detail.participants.map((p, i) => (
                    <span key={i}>
                      {i > 0 && ", "}
                      <button
                        className="person-link"
                        title={t("Apri la scheda di {name}", { name: speakerLabel(p.display_name) })}
                        onClick={() => onOpenPersonByName(p.display_name)}
                      >
                        {speakerLabel(p.display_name)}
                      </button>
                      {p.organization ? ` (${p.organization})` : ""}
                    </span>
                  ))}
                </span>
              )}
              <span className="meta-item meta-cats">
                {cats.map((c) => (
                  <span key={c.id} className="tag" style={{ ["--tag" as string]: c.color ?? "var(--line-strong)" }}>
                    <span className="tag-dot" aria-hidden="true" />
                    {c.name}
                    <button className="tag-x" aria-label={t("Togli la categoria {name}", { name: c.name })} onClick={() => onUnlinkCat(c.id)}>
                      <IconClose size={11} />
                    </button>
                  </span>
                ))}
                <span className="cat-add-wrap">
                  <button
                    className="tag tag-add"
                    aria-expanded={pickerOpen}
                    aria-haspopup="dialog"
                    onClick={() => setPickerOpen(!pickerOpen)}
                  >
                    <IconPlus size={11} />
                    {cats.length ? t("Categoria") : t("Aggiungi una categoria")}
                  </button>
                  {pickerOpen && (
                    <CategoryPicker
                      all={allCats}
                      assigned={cats}
                      onAssign={onAssignCat}
                      onUnlink={onUnlinkCat}
                      onClose={() => setPickerOpen(false)}
                    />
                  )}
                </span>
              </span>
            </div>
          </header>

          {/* What the queue is doing with this call, and how to push it again. */}
          {job && job.status === "failed" && (
            <section className="notice-card ko" role="alert">
              <div className="notice-text">
                <strong>{jobLabel(job)}</strong>
                {job.lastError && <span className="notice-err">{noticeText(job.lastError)}</span>}
                {job.kind === "transcribe" && <span>{t("L'audio della call resta salvato su disco.")}</span>}
              </div>
              <button className="btn sm primary" onClick={() => void retrySession(id)}>
                {t("Riprova")}
              </button>
            </section>
          )}

          {/* Parked, not failed: waiting for a provider (or a local one, for a private call). */}
          {job && isWaitingNotice(job) && (
            <section className="notice-card wait">
              <div className="notice-text">
                <strong>{noticeText(job.lastError)}</strong>
                <span>{t("Resta in coda: riparte da sola appena c'è il modello giusto.")}</span>
              </div>
              <button className="btn sm" onClick={onOpenSettings}>
                {t("Apri le impostazioni")}
              </button>
            </section>
          )}

          {detail.session.status === "transcribing" && (
            <section className="tr-pending" role="status">
              <div className="tr-head">
                <span className="spinner" aria-hidden="true" />
                <div className="tr-head-text">
                  <strong>{live ? t("Sto trascrivendo questa call") : t("In coda per la trascrizione")}</strong>
                  <span>
                    {live
                      ? t("Comparirà qui appena pronta, sul tuo PC. Intanto puoi usare Mori.")
                      : t("Parte appena finisce quella in corso. Intanto puoi usare Mori.")}
                  </span>
                  {live && (
                    <span className="tr-progress">
                      <ProgressLine fraction={live.fraction} />
                      <span className="tr-progress-txt mono">{progressLine(live)}</span>
                    </span>
                  )}
                  {live && (live.etaSecs ?? 0) > 300 && getSttSettings().mode === "local" && (
                    <span className="tr-faster">
                      {t("Sul PC ci vuole un po'. In Impostazioni → Trascrizione puoi usare Groq: pochi secondi, gratis.")}
                    </span>
                  )}
                </div>
              </div>
              <div className="skeleton-lines" aria-hidden="true">
                {[92, 78, 85, 60, 88, 70].map((w, i) => (
                  <span key={i} className="skeleton" style={{ width: `${w}%` }} />
                ))}
              </div>
            </section>
          )}

          {detail.session.status === "failed" && !job && (
            <p className="call-empty">{t("La trascrizione non è riuscita, ma l'audio resta salvato su disco.")}</p>
          )}

          {ready && (
            <>
              {!detail.summary && detail.transcript && (
                <section className="notice-card raw">
                  <div className="notice-text">
                    <strong>{understandingThis ? t("Sto capendo questa call") : t("Questa call non è ancora organizzata.")}</strong>
                    <span>
                      {understandingThis
                        ? t("Sintesi, decisioni e cose da fare arrivano qui tra poco. Intanto il trascritto è già sotto.")
                        : t("Mori può leggerla e ricavarne sintesi, decisioni, cose da fare e memoria.")}
                    </span>
                    {understandingThis && (
                      <span className="tr-progress">
                        <ProgressLine fraction={understandFraction(understandingThis)} />
                        <span className="tr-progress-txt mono">{understandLine(understandingThis, Date.now())}</span>
                      </span>
                    )}
                  </div>
                  {/* The truth is the queue, not this click: a job already in
                      flight keeps the button honest instead of snapping back. */}
                  {!understandingThis && (
                    <button
                      className="btn sm primary"
                      onClick={onOrganize}
                      disabled={organizing || job?.kind === "organize"}
                    >
                      {organizing || job?.status === "running"
                        ? t("Sto capendo…")
                        : job?.kind === "organize"
                          ? t("In coda…")
                          : t("Fai capire a Mori")}
                    </button>
                  )}
                  {organizeError && <p className="notice-err">{organizeError}</p>}
                </section>
              )}

              <div className="call-tabs" role="tablist" aria-label={t("Contenuto della call")} onKeyDown={onTabKey} ref={tabsRef}>
                <span className="tab-ink" style={ink} aria-hidden="true" />
                {TABS.map((t, i) => (
                  <button
                    key={t.id}
                    id={`tab-${t.id}`}
                    role="tab"
                    className="call-tab"
                    aria-selected={tab === t.id}
                    aria-controls={`panel-${t.id}`}
                    tabIndex={tab === t.id ? 0 : -1}
                    onClick={() => setTab(t.id)}
                    title={`${t.label} (${i + 1})`}
                  >
                    {t.label}
                    {t.id === "dafare" && openActions > 0 && <span className="tab-count">{openActions}</span>}
                  </button>
                ))}
              </div>

              <div className="call-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
                {tab === "sintesi" && (
                  <>
                    {detail.memories.length > 0 && (
                      <section className="memories">
                        <h2 className="eyebrow">{t("Cosa Mori ricorda")}</h2>
                        <ul>
                          {detail.memories.map((m, i) => (
                            <li key={i} className="memory-row">
                              <span className={"mem-kind mk-" + m.kind}>{kindLabel(m.kind)}</span>
                              <span>{m.content}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {detail.summary ? (
                      <Markdown text={detail.summary} />
                    ) : (
                      detail.memories.length === 0 && (
                        understandingThis ? (
                          <div className="skeleton-lines" aria-hidden="true">
                            {[88, 72, 80, 54].map((w, i) => (
                              <span key={i} className="skeleton" style={{ width: `${w}%` }} />
                            ))}
                          </div>
                        ) : (
                          <p className="call-empty">{t("Ancora nessuna sintesi: “Fai capire a Mori” la scrive dai fatti della call.")}</p>
                        )
                      )
                    )}
                  </>
                )}

                {tab === "trascritto" && detail.transcript && (
                  <div className="tr-actions">
                    <button className="btn ghost sm" data-action="copy-transcript" onClick={onCopyTranscript} title={t("Copia tutto il trascritto come testo")}>
                      <IconCopy size={15} />
                      {t("Copia tutto")}
                    </button>
                    <button className="btn ghost sm" data-action="copy-transcript-ai" onClick={onCopyTranscriptForAi} title={t("Copia il trascritto in Markdown, il formato che un assistente legge meglio")}>
                      <IconChat size={15} />
                      {t("Copia per le IA")}
                    </button>
                    <button className="btn ghost sm" data-action="save-transcript" onClick={onSaveTranscript} title={t("Salva il trascritto come file Markdown (.md)")}>
                      <IconFile size={15} />
                      {t("Salva come file")}
                    </button>
                  </div>
                )}
                {tab === "trascritto" && otherLabelsIn(detail.segments, detail.transcript).length > 0 && (
                  <SpeakerNamer
                    key={id /* a draft never follows you to another call */}
                    labels={otherLabelsIn(detail.segments, detail.transcript)}
                    map={detail.speakers}
                    suggestions={speakerSuggestions(detail, entities, myNames)}
                    hasSummary={!!detail.summary}
                    onSave={onNameSpeaker}
                    onReorganize={onOrganize}
                  />
                )}
                {tab === "trascritto" &&
                  (detail.segments.length > 0 ? (
                    <SegmentPlayer
                      segments={applySpeakerMap(detail.segments, detail.speakers)}
                      audioPath={detail.audioPath}
                      seekTo={seekReq && seekReq.id === id ? seekReq : null}
                    />
                  ) : detail.transcript ? (
                    <TranscriptView text={relabelText(detail.transcript, detail.speakers)} />
                  ) : (
                    <p className="call-empty">{t("Nessun trascritto per questa call.")}</p>
                  ))}

                {tab === "dafare" &&
                  (detail.actions.length > 0 ? (
                    <ul className="action-list">
                      {detail.actions.map((a) => (
                        <li key={a.id} className={"action-row" + (a.status === "done" ? " done" : "")}>
                          <button
                            className={"check" + (a.status === "done" ? " on" : "")}
                            role="checkbox"
                            aria-checked={a.status === "done"}
                            aria-label={a.status === "done" ? t("Segna da fare: {text}", { text: a.text }) : t("Segna fatta: {text}", { text: a.text })}
                            onClick={() => void onToggleAction(a)}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                          </button>
                          <span className="action-text">{a.text}</span>
                          {a.assignee && <span className="who-chip">{assigneeLabel(a.assignee)}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="call-empty">{t("Da questa call non è uscito niente da fare.")}</p>
                  ))}
              </div>
            </>
          )}
        </article>
      </div>

      {panelOpen && (
        <>
          <div className="chat-panel-scrim" onClick={() => setPanelOpen(false)} aria-hidden="true" />
          <aside className="chat-panel" aria-label={t("Chiedi a Mori")}>
            <header className="chat-panel-head">
              <Dragon size={16} />
              <span>{t("Chiedi a Mori")}</span>
              <button className="icon-btn" onClick={() => setPanelOpen(false)} aria-label={t("Chiudi il pannello")} title={t("Chiudi (Esc)")}>
                <IconClose />
              </button>
            </header>
            <ChatThread
              chat={chat}
              onOpenSource={onOpenSource}
              compact
              autoFocus
              placeholder={t("Scrivi a Mori…")}
              empty={
                <p className="panel-hint">
                  {t("Chiedimi qualcosa su questa call, o su qualsiasi altra: rispondo da quello che hai registrato e cito da dove prendo.")}
                </p>
              }
            />
          </aside>
        </>
      )}
    </div>
  );
}

/** Search or create a category for this call. */
function CategoryPicker({
  all,
  assigned,
  onAssign,
  onUnlink,
  onClose,
}: {
  all: CategoryCount[];
  assigned: Category[];
  onAssign: (name: string) => void;
  onUnlink: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim();
  const shown = all.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
  const exists = all.some((c) => c.name.toLowerCase() === query.toLowerCase());
  function assign(name: string) {
    setQ("");
    onAssign(name);
  }
  return (
    <>
      <div className="picker-backdrop" onClick={onClose} />
      <div className="cat-picker" role="dialog" aria-label={t("Categorie della call")}>
        <input
          autoFocus
          className="cat-picker-search"
          placeholder={t("Cerca o crea una categoria…")}
          aria-label={t("Cerca o crea una categoria")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onClose();
            }
            if (e.key === "Enter" && query) assign(query);
          }}
        />
        <div className="cat-picker-list">
          {shown.map((c) => {
            const on = assigned.some((x) => x.id === c.id);
            return (
              <button
                key={c.id}
                className={"cat-picker-row" + (on ? " on" : "")}
                aria-pressed={on}
                onClick={() => (on ? onUnlink(c.id) : assign(c.name))}
              >
                <span className="cpr-check" aria-hidden="true">
                  {on && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                </span>
                <span className="cpr-name">{c.name}</span>
                <span className="cpr-count">{c.count}</span>
              </button>
            );
          })}
          {query && !exists && (
            <button className="cat-picker-row create" onClick={() => assign(query)}>
              <IconPlus size={12} />
              {t("Crea “{name}”", { name: query })}
            </button>
          )}
          {!query && all.length === 0 && <p className="cat-picker-empty">{t("Scrivi un nome per creare la prima categoria.")}</p>}
        </div>
      </div>
    </>
  );
}

/** "32 min", "1 h 12 min". */
function fmtDuration(secs: number): string {
  const m = Math.round(secs / 60);
  if (m < 1) return `${Math.round(secs)} s`;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

/** "sab 4 ott 2026". */
function longDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fmtDate(iso);
  return d.toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
