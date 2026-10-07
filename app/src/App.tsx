// The window: which view is open, the data they share, and what happens when
// you act on a call. Every screen lives in src/views; recording in
// views/recording/useRecorder.ts, the chat in views/chat/useChat.ts.
import { useEffect, useRef, useState } from "react";
import {
  listSessions,
  categoriesFor,
  participantsFor,
  summaryFor,
  transcriptFor,
  segmentsFor,
  audioPathFor,
  actionItemsFor,
  setActionStatus,
  memoriesFor,
  renameSession,
  deleteSession,
  setSessionSensitive,
  speakerMapFor,
  setSpeakerName,
  listCategoriesWithCounts,
  listAllCategories,
  allSessionCategories,
  assignCategory,
  unlinkCategory,
  renameCategory,
  deleteCategory,
  createCategory,
  db,
  type Session,
  type Category,
  type CategoryCount,
} from "./db";
import {
  getConfig,
  saveConfig,
  loadConfig,
  loadLocalConfig,
  getLocalConfig,
  providerReady,
  isLocalProvider,
  type ProviderConfig,
} from "./llm";
import Dragon from "./ui/Mark";
import Toasts from "./ui/Toasts";
import { copyText } from "./ui/format";
import { recategorizeAllSessions } from "./organize";
import { indexAllMissing, indexSession } from "./index";
import { addCall } from "./ingest";
import { callMarkdown } from "./followup";
import { maybeBackup } from "./backup";
import {
  enqueueJob,
  pumpJobs,
  resumeJobs,
  subscribeJobs,
  subscribeReady,
  subscribeCloudFallback,
  jobsBySession,
  type SessionJob,
} from "./jobs";
import {
  loadWhisperModel,
  loadCallDetect,
  loadWhisperContext,
  loadSttSettings,
  loadAudioKeep,
  cloudFallbackMessage,
} from "./recorder";
// ── Sessione 3 · Compagno ───────────────────────────────────────────────────
import TodosView from "./views/TodosView";
import HomeView from "./views/HomeView";
import PersonView from "./views/PersonView";
import { openMineCount } from "./views/todos";
import { demoCallIds, removeDemoCalls } from "./views/home";
import { listEntities, entityByName, type Entity } from "./views/people";
import {
  loadCompanionSettings,
  saveCompanionSettings,
  getCompanionSettings,
  trayReady,
  flashPill,
  type CompanionSettings,
} from "./companion";
// ────────────────────────────────────────────────────────────────────────────
import { Sidebar, MiniRail, useSidebarPrefs, SECTIONS, type View } from "./views/Sidebar";
import { recState, SilencePrompt } from "./views/recording/RecordControl";
import ShortcutsDialog from "./views/ShortcutsDialog";
import { isTyping } from "./ui/keys";
import { useUndo } from "./ui/useUndo";
import ChatView from "./views/chat/ChatView";
import { useChat } from "./views/chat/useChat";
import CallView from "./views/call/CallView";
import CallSkeleton from "./views/call/CallSkeleton";
import FollowUpModal from "./views/call/FollowUpModal";
import type { CallTab, Detail, SeekRequest } from "./views/call/types";
import HistoryView from "./views/HistoryView";
import SettingsView, { type SettingsSection } from "./views/settings/SettingsView";
import AddCallModal from "./views/AddCallModal";
import CommandPalette from "./views/CommandPalette";
import CallDetectBanner from "./views/CallDetectBanner";
import ReadyToast, { type Ready } from "./views/ReadyToast";
import { useRecorder } from "./views/recording/useRecorder";
import { t, tn } from "./i18n";
import { ensureSetup } from "./setup";
import { speakerLabel } from "./speakers-logic";


export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [cats, setCats] = useState<Record<string, Category[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [catCounts, setCatCounts] = useState<CategoryCount[]>([]);
  const [allCats, setAllCats] = useState<CategoryCount[]>([]);
  const [recat, setRecat] = useState<{ done: number; total: number } | null>(null);
  const [indexing, setIndexing] = useState<{ done: number; total: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // A calm, self-dismissing confirmation (the red toast is for errors).
  const [notice, setNotice] = useState<string | null>(null);
  const [followUpFor, setFollowUpFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mori opens on "Oggi": what matters today, before any question.
  const [view, setView] = useState<View>("home");
  const sidebar = useSidebarPrefs();
  const sidebarRef = useRef(sidebar);
  sidebarRef.current = sidebar;

  // Which section the settings page opens on, and a key to reopen it there.
  const [settingsAt, setSettingsAt] = useState<{ section: SettingsSection | null; n: number }>({ section: null, n: 0 });
  const [cfg, setCfg] = useState<ProviderConfig>(getConfig());

  const [organizing, setOrganizing] = useState(false);
  const [organizeError, setOrganizeError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  // What the durable queue is doing, per call — drives the notice + "Riprova".
  const [jobs, setJobs] = useState<Record<string, SessionJob>>({});

  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState<CallTab>("sintesi");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [seekReq, setSeekReq] = useState<SeekRequest | null>(null);
  // Where "←" on a call goes: the section it was opened from.
  const [backTo, setBackTo] = useState<Exclude<View, "session">>("history");
  // The chat beside a call: closed until asked for, then remembered.
  const [panelOpen, setPanelOpenState] = useState(() => {
    try { return localStorage.getItem("mori.chatPanel") === "open"; } catch { return false; }
  });
  function setPanelOpen(open: boolean) {
    setPanelOpenState(open);
    try { localStorage.setItem("mori.chatPanel", open ? "open" : "closed"); } catch { /* ignore */ }
  }
  // Calls deleted a moment ago: hidden everywhere until "Annulla" runs out.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [demoPending, setDemoPending] = useState(false);
  const hide = (ids: string[], on: boolean) =>
    setHidden((h) => {
      const n = new Set(h);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });

  // ── Sessione 3 · Compagno ─────────────────────────────────────────────────
  const [personId, setPersonId] = useState<string | null>(null);
  const [mineCount, setMineCount] = useState(0);
  const [todosBump, setTodosBump] = useState(0);
  const [companion, setCompanion] = useState<CompanionSettings>(getCompanionSettings());
  const [trayOk, setTrayOk] = useState(false);
  const [entities, setEntities] = useState<Entity[]>([]);
  // ──────────────────────────────────────────────────────────────────────────

  const undo = useUndo(setToast);
  const chat = useChat(cfg, () => openSettings("modello"));
  const rec = useRecorder({
    hotkey: companion.hotkey,
    silenceMin: companion.silenceMin,
    jobs,
    onSaved: async (id) => {
      await loadSessions();
      setSelected(id);
      setView("session");
    },
  });

  // "È pronta": a call has just been understood. Nothing to say when you are
  // already looking at it; a toast with "Apri" anywhere else in Mori; the pill
  // when Mori is behind other windows.
  const [ready, setReady] = useState<Ready | null>(null);
  const whereRef = useRef({ view, selected, focused: true });
  whereRef.current = { view, selected, focused: rec.mainFocused };
  useEffect(
    () =>
      subscribeReady((id) => {
        void (async () => {
          const d = await db();
          const [row] = await d.select<{ title: string; todos: number }[]>(
            `SELECT s.title, (SELECT COUNT(*) FROM session_action_item a WHERE a.session_id = s.id) todos
               FROM session s WHERE s.id = $1`,
            [id],
          );
          if (!row) return;
          const w = whereRef.current;
          if (!w.focused) {
            void flashPill(
              {
                kind: "info",
                title: t("Call pronta"),
                subtitle: row.todos > 0 ? `${row.title} · ${tn(row.todos, "1 cosa da fare", "{n} cose da fare")}` : row.title,
              },
              5000,
            );
          } else if (!(w.view === "session" && w.selected === id)) {
            setReady({ id, title: row.title, todos: row.todos });
          }
        })().catch(() => {});
      }),
    [],
  );

  // Groq did not transcribe (bad key, free hour used up, offline): say why,
  // once — the same reason for the next calls in the queue is not news.
  const lastFallback = useRef({ msg: "", at: 0 });
  useEffect(
    () =>
      subscribeCloudFallback((why) => {
        const msg = cloudFallbackMessage(why);
        const prev = lastFallback.current;
        if (prev.msg === msg && Date.now() - prev.at < 30 * 60_000) return;
        lastFallback.current = { msg, at: Date.now() };
        setToast(msg);
      }),
    [],
  );

  async function loadSessions(): Promise<Session[]> {
    const s = await listSessions();
    setSessions(s);
    const rows = await allSessionCategories();
    const map: Record<string, Category[]> = {};
    for (const x of s) map[x.id] = [];
    for (const r of rows) {
      (map[r.session_id] ??= []).push({ id: r.id, name: r.name, color: r.color, kind: r.kind, source: r.source });
    }
    setCats(map);
    setCatCounts(await listCategoriesWithCounts());
    setAllCats(await listAllCategories());
    return s;
  }

  async function runRecategorize() {
    if (recat) return;
    setRecat({ done: 0, total: 0 });
    try {
      await recategorizeAllSessions((done, total) => setRecat({ done, total }));
      setCatFilter(null);
      await loadSessions();
    } catch (e) {
      setToast(t("Riorganizzazione non riuscita: {error}", { error: String(e) }));
    } finally {
      setRecat(null);
    }
  }

  // Index every session that has a transcript but no recall chunks yet (one-shot).
  async function runIndexAll() {
    if (indexing) return;
    setIndexing({ done: 0, total: 0 });
    try {
      const total = await indexAllMissing((done, tot) => setIndexing({ done, total: tot }));
      setToast(total === 0 ? t("Tutto già indicizzato.") : tn(total, "Indicizzate 1 call per il richiamo.", "Indicizzate {n} call per il richiamo."));
    } catch (e) {
      setToast(t("Indicizzazione non riuscita: {error}", { error: String(e) }));
    } finally {
      setIndexing(null);
    }
  }

  // --- Category management (manual assign / remove / rename / delete / create) --
  async function doAssignCat(sessionId: string, name: string) {
    try { await assignCategory(sessionId, name); await loadSessions(); }
    catch (e) { setToast(t("Impossibile assegnare la categoria: {error}", { error: String(e) })); }
  }
  async function doUnlinkCat(sessionId: string, catId: string) {
    try { await unlinkCategory(sessionId, catId); await loadSessions(); }
    catch (e) { setToast(t("Impossibile rimuovere la categoria: {error}", { error: String(e) })); }
  }
  async function doRenameCat(id: string, name: string) {
    try { await renameCategory(id, name); await loadSessions(); }
    catch (e) { setToast(t("Rinomina non riuscita: {error}", { error: String(e) })); }
  }
  async function doDeleteCat(id: string) {
    try {
      await deleteCategory(id);
      if (catFilter === id) setCatFilter(null);
      await loadSessions();
    } catch (e) { setToast(t("Eliminazione non riuscita: {error}", { error: String(e) })); }
  }
  async function doCreateCat(name: string) {
    try { await createCategory(name); await loadSessions(); }
    catch (e) { setToast(t("Creazione non riuscita: {error}", { error: String(e) })); }
  }

  useEffect(() => {
    loadSessions().catch((e) => setError(String(e)));
    loadWhisperModel().catch(() => {});
    loadCallDetect().catch(() => {});
    // The provider config (and the local one for private calls, and Whisper's
    // context sentence) must be in memory BEFORE the queue starts, or every
    // organize job would park itself waiting for a key that is already there.
    // Same for where the words are recognized and what happens to the audio.
    Promise.all([
      loadConfig(),
      loadLocalConfig().catch(() => null),
      loadWhisperContext().catch(() => ""),
      loadSttSettings().catch(() => null),
      loadAudioKeep().catch(() => null),
    ])
      .then(([c]) => {
        setCfg(c);
        return resumeJobs();
      })
      .catch(() => {});
    // One snapshot a day, in the background, silently (DECISIONS.md, 23/8).
    void maybeBackup();
    // A packaged Mori with no Python yet prepares its own, once.
    void ensureSetup();
  }, []);

  // Keep the UI in step with the queue: a job that finishes in the background
  // refreshes the list, the open call and the per-call notice.
  useEffect(() => {
    let alive = true;
    const sync = () => {
      void (async () => {
        try {
          const j = await jobsBySession();
          if (!alive) return;
          setJobs(j);
          await loadSessions();
          if (!alive) return;
          setRefresh((r) => r + 1);
        } catch {
          /* a refresh that fails must not break the app */
        }
      })();
    };
    sync();
    const off = subscribeJobs(sync);
    return () => {
      alive = false;
      off();
    };
  }, []);

  // ── Sessione 3 · Compagno ─────────────────────────────────────────────────

  // Impostazioni del compagno + stato della barra, all'avvio.
  useEffect(() => {
    loadCompanionSettings().then(setCompanion).catch(() => {});
    trayReady().then(setTrayOk).catch(() => {});
    listEntities().then(setEntities).catch(() => {});
  }, []);

  // Il numero accanto a "Da fare": quante cose aperte sono tue.
  useEffect(() => {
    openMineCount(companion.myNames)
      .then(setMineCount)
      .catch(() => {});
  }, [companion.myNames, sessions, refresh, todosBump]);

  function openPerson(id: string | null) {
    setPersonId(id);
    setView("person");
  }

  /** Un nome scritto in chiaro (partecipante, assegnatario) → la sua scheda. */
  async function openPersonByName(name: string) {
    const e = await entityByName(name);
    if (e) openPerson(e.id);
    else setToast(t("Non ho ancora una scheda per “{name}”.", { name }));
  }
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selected) return;
    (async () => {
      const session = sessions.find((s) => s.id === selected);
      // The call can vanish under us: an empty recording is removed by the queue
      // right after we selected it. Close the detail instead of leaving a ghost.
      if (!session) {
        setDetail(null);
        setSelected(null);
        return;
      }
      const [categories, participants, summary, transcript, segments, audioPath, actions, memories, speakers] =
        await Promise.all([
          categoriesFor(selected),
          participantsFor(selected),
          summaryFor(selected),
          transcriptFor(selected),
          segmentsFor(selected),
          audioPathFor(selected),
          actionItemsFor(selected),
          memoriesFor(selected),
          speakerMapFor(selected),
        ]);
      setDetail({ session, categories, participants, summary, transcript, segments, audioPath, actions, memories, speakers });
    })();
  }, [selected, sessions, refresh]);

  // A new call opens on its summary — unless it was opened to play a moment
  // ("▶ mm:ss" under an answer, a hit in ⌘K): then on the transcript. This
  // effect runs AFTER openSource, so without the ref it reset the tab to
  // "sintesi" and the seek was lost on every call not already open.
  const openOnTab = useRef<"sintesi" | "trascritto" | null>(null);
  useEffect(() => {
    setTab(openOnTab.current ?? "sintesi");
    openOnTab.current = null;
  }, [selected]);

  // Shortcuts that work everywhere (docs/DESIGN.md §5, "Scorciatoie"). The
  // ones of one letter stay quiet while the user is writing in a field.
  const goSectionRef = useRef(goSection);
  goSectionRef.current = goSection;
  const openSettingsRef = useRef(() => openSettings());
  openSettingsRef.current = () => openSettings();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      } else if (mod && !e.shiftKey && !e.altKey && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        setCmdOpen(false);
        goSectionRef.current(SECTIONS[Number(e.key) - 1].id);
      } else if (mod && e.key === ",") {
        e.preventDefault();
        openSettingsRef.current();
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        sidebarRef.current.setOpen(!sidebarRef.current.open);
      } else if (e.key === "?" && !mod && !isTyping(e.target)) {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.key === "Escape") {
        setCmdOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function openSource(id: string, start?: number | null) {
    if (view !== "session") setBackTo(view);
    // Only when the selection changes does the [selected] effect run and read
    // the ref; on the call already open it would linger and hijack the next one.
    if (start != null && id !== selected) openOnTab.current = "trascritto";
    setSelected(id);
    setView("session");
    if (start != null) {
      setTab("trascritto");
      setSeekReq({ id, start, n: Date.now() }); // n makes repeat clicks re-trigger
    }
  }

  function openSettings(section: SettingsSection | null = null) {
    setCmdOpen(false);
    setSettingsAt((x) => ({ section, n: x.n + 1 }));
    setView("settings");
  }

  function goSection(sec: (typeof SECTIONS)[number]["id"]) {
    if (sec === "person") openPerson(null);
    else setView(sec);
  }

  function openSession(id: string) {
    if (view !== "session") setBackTo(view);
    setSelected(id);
    setView("session");
  }

  function askInChat(q: string) {
    setView("chat");
    void chat.ask(q);
  }

  async function handleAddCall(input: { title: string; transcript: string; sensitive: boolean }) {
    const id = await addCall({ ...input, folder: "/" });
    await loadSessions();
    setSelected(id);
    setView("session");
    setAddOpen(false);
    organize(id); // fire-and-forget: Mori understands the new call right away
  }

  async function renameCall(id: string, title: string) {
    await renameSession(id, title);
    await loadSessions();
  }

  /** Gone at once, really deleted (audio too) only when "Annulla" runs out. */
  function deleteCall(id: string, title: string) {
    hide([id], true);
    setSelected(null);
    setDetail(null);
    setView(backTo);
    undo.offer(
      t("Call eliminata: “{title}”", { title: title.length > 40 ? title.slice(0, 39) + "…" : title }),
      async () => {
        await deleteSession(id);
        await loadSessions();
        hide([id], false);
      },
      () => {
        hide([id], false);
        openSession(id);
      },
    );
  }

  /** The demo calls of a new install, taken away with Annulla. */
  async function removeDemo() {
    const ids = await demoCallIds();
    if (!ids.length) return;
    hide(ids, true);
    setDemoPending(true);
    undo.offer(
      tn(ids.length, "Tolta la call di esempio.", "Tolte le {n} call di esempio."),
      async () => {
        await removeDemoCalls();
        await loadSessions();
        hide(ids, false);
        setDemoPending(false);
        setTodosBump((n) => n + 1);
      },
      () => {
        hide(ids, false);
        setDemoPending(false);
      },
    );
  }

  // ── Private calls, follow-up, export ──────────────────────────────────────
  /** The name to sign a follow-up with: the first of "my names" that is a name. */
  const myName = companion.myNames.find((n) => !/^(tu|te|io|me)$/i.test(n.trim())) ?? null;

  async function togglePrivate(id: string, on: boolean) {
    try {
      await setSessionSensitive(id, on);
      await loadSessions();
      setRefresh((r) => r + 1);
      if (on) {
        const local = isLocalProvider(getConfig()) || providerReady(getLocalConfig());
        setNotice(
          local
            ? t("Call privata: da ora la legge solo il modello sul tuo PC.")
            : t("Call privata: da ora non va più al cloud. Per farla capire a Mori imposta un modello locale in Impostazioni → Modello."),
        );
      } else {
        setNotice(t("La call non è più privata."));
        void pumpJobs(); // a job parked for lack of a local model can now go
      }
    } catch (e) {
      setToast(t("Non sono riuscito a cambiare la privacy della call: {error}", { error: String(e) }));
    }
  }

  /** "Interlocutore" was Giulia: everywhere the transcript is read, from now on. */
  async function nameSpeaker(id: string, label: string, name: string) {
    try {
      await setSpeakerName(id, label, name);
      setRefresh((r) => r + 1);
      await loadSessions();
      // The recall chunks carry speaker names: rebuild this call's, quietly.
      void indexSession(id).catch(() => {});
      setNotice(
        name.trim()
          ? t("Da ora “{label}” è {name}: trascritto, ricerca e richiamo lo usano.", { label: speakerLabel(label), name: name.trim() })
          : t("“{label}” torna senza nome.", { label: speakerLabel(label) }),
      );
    } catch (e) {
      setToast(t("Non sono riuscito a salvare il nome: {error}", { error: String(e) }));
    }
  }

  async function copyCallMarkdown(id: string) {
    try {
      await copyText(await callMarkdown(id));
      setNotice(t("Copiata negli appunti come Markdown."));
    } catch (e) {
      setToast(t("Copia non riuscita: {error}", { error: String(e) }));
    }
  }

  // Understanding a call goes through the queue like everything else: the error
  // is saved on the job (not lost in React state) and "Riprova" can pick it up.
  async function organize(id: string) {
    setOrganizing(true);
    setOrganizeError(null);
    try {
      await enqueueJob("organize", id, {});
      await pumpJobs();
      const st = (await jobsBySession())[id];
      if (st?.status === "failed") setOrganizeError(st.lastError ?? t("Non è riuscita."));
      const c = await categoriesFor(id);
      setCats((prev) => ({ ...prev, [id]: c }));
      setRefresh((r) => r + 1);
    } catch (e) {
      setOrganizeError(String(e));
    } finally {
      setOrganizing(false);
    }
  }

  // Everything the views list, minus a call waiting to be deleted for good.
  const visible = hidden.size ? sessions.filter((x) => !hidden.has(x.id)) : sessions;
  const pos = selected ? visible.findIndex((x) => x.id === selected) : -1;
  const backLabel = SECTIONS.find((x) => x.id === backTo)?.label ?? t("Tutte le call");

  if (error) {
    return (
      <div className="boot-error">
        <h1><Dragon size={24} /> {t("Mori non riesce ad aprire la memoria")}</h1>
        <pre>{error}</pre>
      </div>
    );
  }

  const nav = {
    view,
    mineCount,
    rec: recState(rec),
    recSecs: rec.recSecs,
    hotkey: companion.hotkey,
    onToggleRecord: () => void rec.toggleRecord(),
    onSection: goSection,
    onOpenSettings: () => openSettings(),
    onOpenPalette: () => setCmdOpen(true),
    onOpenShortcuts: () => setShortcutsOpen(true),
  };

  return (
    <div className={"app" + (sidebar.open ? "" : " collapsed")}>
      <a className="skip-link" href="#main">{t("Vai al contenuto")}</a>
      <Toasts
        toast={toast}
        notice={notice}
        undo={undo.current}
        undoMs={undo.durationMs}
        onUndo={undo.undo}
        onCloseToast={() => setToast(null)}
        onCloseNotice={() => setNotice(null)}
        extra={
          !sidebar.open && rec.recording && rec.silenceLeft !== null ? (
            <SilencePrompt left={rec.silenceLeft} onKeep={rec.keepRecording} onStopNow={rec.stopNow} />
          ) : null
        }
      >
        <ReadyToast ready={ready} onOpen={(id) => void openSession(id)} onClose={() => setReady(null)} />
        <CallDetectBanner
          busy={!!rec.recording || rec.saving}
          recording={!!rec.recording}
          entities={entities}
          onRecord={() => void rec.toggleRecord()}
          onOpenPerson={(id) => openPerson(id)}
        />
      </Toasts>
      {sidebar.open && (
        <Sidebar
          {...nav}
          width={sidebar.width}
          setWidth={sidebar.setWidth}
          onCollapse={() => sidebar.setOpen(false)}
          selected={selected}
          sessions={visible}
          jobs={jobs}
          recError={rec.recError}
          silenceLeft={rec.silenceLeft}
          onKeepRecording={rec.keepRecording}
          onStopNow={rec.stopNow}
          onOpenSession={openSession}
          levels={rec.levels}
          issue={rec.issue}
        />
      )}
      {!sidebar.open && <MiniRail {...nav} onExpand={() => sidebar.setOpen(true)} />}

      <main className="detail" id="main" tabIndex={-1}>
        {view === "home" ? (
          <HomeView
            sessions={visible}
            myNames={companion.myNames}
            jobs={jobs}
            providerOk={providerReady(cfg)}
            onSaveProvider={(next) => {
              // Same as Settings → Salva: the queue waiting for a key moves now.
              void saveConfig(next).then(() => pumpJobs());
              setCfg(next);
              setNotice(t("Mori è collegato a Groq: capisce le call e le trascrive in pochi secondi."));
            }}
            hotkey={companion.hotkey}
            refreshKey={refresh + todosBump}
            recording={!!rec.recording}
            onAsk={askInChat}
            onOpenCall={openSource}
            onOpenPerson={(id) => openPerson(id)}
            onOpenTodos={() => setView("todos")}
            onRecord={() => void rec.toggleRecord()}
            onAddCall={() => setAddOpen(true)}
            onOpenSettings={(section) => openSettings(section ?? null)}
            onChanged={() => {
              setTodosBump((n) => n + 1);
              void loadSessions();
            }}
            onError={setToast}
            onRemoveDemo={() => void removeDemo()}
            demoHidden={demoPending}
          />
        ) : view === "chat" ? (
          <ChatView chat={chat} onOpenSource={openSource} offerUndo={undo.offer} />
        ) : view === "todos" ? (
          <TodosView
            myNames={companion.myNames}
            offerUndo={undo.offer}
            onOpenCall={openSource}
            onChanged={() => setTodosBump((n) => n + 1)}
            onError={setToast}
          />
        ) : view === "person" ? (
          <PersonView
            entityId={personId}
            myNames={companion.myNames}
            onOpenEntity={openPerson}
            onOpenCall={openSource}
            onAsk={askInChat}
            onError={setToast}
          />
        ) : view === "settings" ? (
          <SettingsView
            key={settingsAt.n}
            cfg={cfg}
            companion={companion}
            trayOk={trayOk}
            section={settingsAt.section}
            onSaveCompanion={(c) => {
              setCompanion(c);
              void saveCompanionSettings(c)
                .then((warn) => warn && setToast(warn))
                .catch((e) => setToast(t("Impostazioni della registrazione non salvate: {error}", { error: String(e) })));
            }}
            onSave={(next) => {
              // A key that arrives now unblocks every job parked waiting for one.
              void saveConfig(next).then(() => pumpJobs());
              setCfg(next);
            }}
            onSaved={() => setNotice(t("Impostazioni salvate."))}
          />
        ) : view === "history" ? (
          <HistoryView
            sessions={visible}
            cats={cats}
            jobs={jobs}
            onAddCall={() => setAddOpen(true)}
            catCounts={catCounts}
            allCats={allCats}
            query={query}
            setQuery={setQuery}
            catFilter={catFilter}
            setCatFilter={setCatFilter}
            recat={recat}
            indexing={indexing}
            onRecategorize={runRecategorize}
            onIndexAll={runIndexAll}
            onOpenSession={openSession}
            onCreateCat={(name) => void doCreateCat(name)}
            onRenameCat={(id, name) => void doRenameCat(id, name)}
            onDeleteCat={(id) => void doDeleteCat(id)}
          />
        ) : detail && detail.session.id === selected ? (
          <CallView
            key={detail.session.id}
            detail={detail}
            cats={cats[detail.session.id] ?? []}
            allCats={allCats}
            job={jobs[detail.session.id]}
            organizing={organizing}
            organizeError={organizeError}
            tab={tab}
            setTab={setTab}
            seekReq={seekReq}
            entities={entities}
            myNames={companion.myNames}
            chat={chat}
            backLabel={backLabel}
            onBack={() => setView(backTo)}
            onPrev={pos > 0 ? () => openSession(visible[pos - 1].id) : null}
            onNext={pos >= 0 && pos < visible.length - 1 ? () => openSession(visible[pos + 1].id) : null}
            panelOpen={panelOpen}
            setPanelOpen={setPanelOpen}
            onOpenSource={openSource}
            onRename={(title) => renameCall(detail.session.id, title)}
            onDelete={() => deleteCall(detail.session.id, detail.session.title)}
            onTogglePrivate={(on) => void togglePrivate(detail.session.id, on)}
            onCopyMarkdown={() => void copyCallMarkdown(detail.session.id)}
            onFollowUp={() => setFollowUpFor(detail.session.id)}
            onOpenPersonByName={(n) => void openPersonByName(n)}
            onAssignCat={(name) => void doAssignCat(detail.session.id, name)}
            onUnlinkCat={(catId) => void doUnlinkCat(detail.session.id, catId)}
            onOpenSettings={() => openSettings("modello")}
            onOrganize={() => void organize(detail.session.id)}
            onNameSpeaker={(label, name) => void nameSpeaker(detail.session.id, label, name)}
            onToggleAction={async (a) => {
              await setActionStatus(a.id, a.status === "done" ? "open" : "done");
              setRefresh((r) => r + 1);
            }}
          />
        ) : selected ? (
          <CallSkeleton />
        ) : (
          <div className="empty big">{t("Seleziona una call da Tutte le call.")}</div>
        )}
      </main>

      {addOpen && <AddCallModal onClose={() => setAddOpen(false)} onAdd={handleAddCall} />}

      {followUpFor && (
        <FollowUpModal
          sessionId={followUpFor}
          myName={myName}
          onClose={() => setFollowUpFor(null)}
          onCopied={() => setNotice(t("Mail copiata negli appunti."))}
          onOpenSettings={() => {
            setFollowUpFor(null);
            openSettings("modello");
          }}
        />
      )}

      {shortcutsOpen && <ShortcutsDialog hotkey={companion.hotkey} onClose={() => setShortcutsOpen(false)} />}

      {cmdOpen && (
        <CommandPalette
          sessions={visible}
          entities={entities}
          mineCount={mineCount}
          hotkey={companion.hotkey}
          onClose={() => setCmdOpen(false)}
          onAsk={askInChat}
          onOpenSource={openSource}
          onOpenPerson={openPerson}
          onSection={goSection}
          onRecord={() => void rec.toggleRecord()}
          onAddCall={() => setAddOpen(true)}
          onOpenSettings={(section) => openSettings(section ?? null)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
        />
      )}
    </div>
  );
}
