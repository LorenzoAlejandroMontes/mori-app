// Settings as a page (docs/DESIGN.md §5, reference: Linear / Raycast): the
// sections on the left, the one you are reading lit up. Grouped by what you
// control, not by how Mori is built. The theme applies at once; everything
// else waits for one "Salva", offered only when something changed.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  getLocalConfig,
  saveLocalConfig,
  isLocalProvider,
  testProvider,
  type ProviderConfig,
} from "../../llm";
import { getTheme, setTheme, type Theme } from "../../theme";
import { embed } from "../../embeddings";
import { exportAllMarkdown, revealInFolder } from "../../followup";
import {
  listTerms,
  addTerm,
  deleteTerm,
  previewApplyToExisting,
  applyToExisting,
  type VocabTerm,
  type VocabImpact,
} from "../../vocab";
import {
  audioStats,
  compressAllAudio,
  runBackup,
  getSecondFolder,
  setSecondFolder,
  getLastBackupAt,
  humanBytes,
  type AudioStats,
} from "../../backup";
import {
  getWhisperModel,
  saveWhisperModel,
  getCallDetect,
  saveCallDetect,
  getWhisperContext,
  saveWhisperContext,
  getSttSettings,
  saveSttSettings,
  sttKeyFor,
  getAudioKeep,
  saveAudioKeep,
  type WhisperModel,
  type SttMode,
  type AudioKeep,
} from "../../recorder";
import { dropAllKeptAudio } from "../../jobs";
import { getLangPref, setLangPref, locale, t, tn, tx, type LangPref } from "../../i18n";
import { DEFAULT_HOTKEY, type CompanionSettings } from "../../companion";
import { IconArrowRight, IconClose, LockIcon } from "../../ui/icons";
import "./SettingsView.css";

export type SettingsSection = "modello" | "registrazione" | "trascrizione" | "nomi" | "aspetto" | "spazio";

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "modello", label: t("Modello") },
  { id: "registrazione", label: t("Registrazione") },
  { id: "trascrizione", label: t("Trascrizione") },
  { id: "nomi", label: t("Tu e i nomi") },
  { id: "aspetto", label: t("Aspetto") },
  { id: "spazio", label: t("Spazio e copie") },
];

type Draft = {
  local: ProviderConfig;
  privCfg: ProviderConfig;
  whisperCtx: string;
  whisper: WhisperModel;
  callDetect: boolean;
  cmp: CompanionSettings;
  namesDraft: string;
  dir2: string;
  sttMode: SttMode;
  sttKey: string;
  audioKeep: AudioKeep;
  audioDir: string;
};

// Changes left unsaved when the page was closed: they come back next time,
// instead of being thrown away without a word.
let leftover: Draft | null = null;

export default function SettingsView({
  cfg,
  companion,
  trayOk,
  section,
  onSaveCompanion,
  onSave,
  onSaved,
}: {
  cfg: ProviderConfig;
  companion: CompanionSettings;
  trayOk: boolean;
  /** Open on this section. */
  section: SettingsSection | null;
  onSaveCompanion: (c: CompanionSettings) => void;
  onSave: (c: ProviderConfig) => void;
  onSaved: () => void;
}) {
  const initial = useMemo<Draft>(
    () => ({
      local: cfg,
      privCfg: getLocalConfig(),
      whisperCtx: getWhisperContext(),
      whisper: getWhisperModel(),
      callDetect: getCallDetect(),
      cmp: companion,
      namesDraft: companion.myNames.join(", "),
      dir2: "",
      sttMode: getSttSettings().mode,
      sttKey: getSttSettings().key,
      audioKeep: getAudioKeep().keep,
      audioDir: getAudioKeep().dir,
    }),
    // The baseline is what was saved when the page opened (or last saved).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [base, setBase] = useState<Draft>(initial);
  const [d, setD] = useState<Draft>(() => leftover ?? initial);
  const [restored] = useState(() => !!leftover);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [test, setTest] = useState<{ which: "main" | "priv"; ok: boolean | null; message: string } | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [embedStatus, setEmbedStatus] = useState<"idle" | "checking" | "ready" | "error">("idle");
  const [embedErr, setEmbedErr] = useState<string | null>(null);
  const [active, setActive] = useState<SettingsSection>(section ?? "modello");

  // Name dictionary (applies at once, as before)
  const [terms, setTerms] = useState<VocabTerm[]>([]);
  const [newWrong, setNewWrong] = useState("");
  const [newRight, setNewRight] = useState("");
  const [pendingApply, setPendingApply] = useState<VocabImpact | null>(null);
  const [vocabMsg, setVocabMsg] = useState<string | null>(null);

  // Disk and backup (actions run at once)
  const [stats, setStats] = useState<AudioStats | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [freeAsk, setFreeAsk] = useState(false);
  const [langPref] = useState<LangPref>(getLangPref());
  const [maintMsg, setMaintMsg] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(d) !== JSON.stringify(base);

  useEffect(() => {
    listTerms().then(setTerms).catch(() => {});
    audioStats().then(setStats).catch(() => {});
    getSecondFolder()
      .then((v) => {
        const dir = v ?? "";
        setBase((b) => ({ ...b, dir2: dir }));
        setD((x) => (leftover ? x : { ...x, dir2: dir }));
      })
      .catch(() => {});
    getLastBackupAt().then(setLastBackup).catch(() => {});
  }, []);

  // Keep what was not saved for the next visit.
  const draftRef = useRef({ d, dirty });
  draftRef.current = { d, dirty };
  useEffect(() => () => {
    leftover = draftRef.current.dirty ? draftRef.current.d : null;
  }, []);

  // Open on the section asked for; then light up the one being read.
  useEffect(() => {
    if (section) document.getElementById(`set-${section}`)?.scrollIntoView({ block: "start" });
    const root = scrollRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id.replace("set-", "") as SettingsSection);
      },
      { root, rootMargin: "0px 0px -65% 0px" },
    );
    root.querySelectorAll("section.set-section").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function save() {
    void saveWhisperModel(d.whisper);
    void saveCallDetect(d.callDetect);
    void saveWhisperContext(d.whisperCtx);
    void setSecondFolder(d.dir2);
    void saveSttSettings(d.sttMode, d.sttKey);
    void saveAudioKeep(d.audioKeep, d.audioDir);
    // Before onSave: it pumps the queue, and a private call parked for lack
    // of a local model must see the new one at once.
    void saveLocalConfig(d.privCfg);
    const myNames = d.namesDraft
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    onSaveCompanion({ ...d.cmp, myNames });
    onSave(d.local);
    setBase(d);
    leftover = null;
    onSaved();
  }

  // Ctrl+S saves, like in any editor.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (draftRef.current.dirty) saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function saveTerm() {
    const right = newRight.trim();
    if (!right) return;
    await addTerm({ wrong: newWrong, correct: right, kind: "person" });
    setNewWrong("");
    setNewRight("");
    setPendingApply(null);
    setTerms(await listTerms());
  }

  async function removeTerm(id: string) {
    await deleteTerm(id);
    setPendingApply(null);
    setTerms(await listTerms());
  }

  async function askApply() {
    setVocabMsg(null);
    setPendingApply(await previewApplyToExisting());
  }

  async function doApply() {
    setPendingApply(null);
    const r = await applyToExisting();
    setVocabMsg(
      tn(
        r.total,
        "Corretti 1 nomi ({entities} nelle persone e progetti, {participants} tra i partecipanti, {assignees} tra i responsabili).",
        "Corretti {n} nomi ({entities} nelle persone e progetti, {participants} tra i partecipanti, {assignees} tra i responsabili).",
        { entities: r.entities, participants: r.participants, assignees: r.assignees },
      ),
    );
  }

  async function doCompress() {
    setBusy("audio");
    setMaintMsg(null);
    try {
      const r = await compressAllAudio((done, total) => setMaintMsg(t("Comprimo… {done}/{total}", { done, total })));
      setStats(await audioStats().catch(() => null));
      setMaintMsg(
        r.done === 0 && r.failed === 0
          ? t("Nessun audio da comprimere.")
          : r.failed
            ? tn(
                r.done,
                "Compressi 1 audio, {failed} non riusciti. Spazio liberato: {size}.",
                "Compressi {n} audio, {failed} non riusciti. Spazio liberato: {size}.",
                { failed: r.failed, size: humanBytes(r.saved) },
              )
            : tn(r.done, "Compressi 1 audio. Spazio liberato: {size}.", "Compressi {n} audio. Spazio liberato: {size}.", {
                size: humanBytes(r.saved),
              }),
      );
    } catch (e) {
      setMaintMsg(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function doFreeAudio() {
    setFreeAsk(false);
    setBusy("free");
    setMaintMsg(null);
    try {
      const before = await audioStats().catch(() => null);
      const n = await dropAllKeptAudio();
      const after = await audioStats().catch(() => null);
      setStats(after);
      const freed = before && after ? Math.max(0, before.wav_bytes + before.flac_bytes - (after.wav_bytes + after.flac_bytes)) : 0;
      setMaintMsg(
        n === 0
          ? t("Nessun audio da eliminare: quelli rimasti servono a call non ancora trascritte.")
          : tn(n, "Eliminato l'audio di 1 call. Spazio liberato: {size}.", "Eliminato l'audio di {n} call. Spazio liberato: {size}.", { size: humanBytes(freed) }),
      );
    } catch (e) {
      setMaintMsg(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function doBackup() {
    setBusy("backup");
    setMaintMsg(null);
    try {
      await setSecondFolder(d.dir2);
      const r = await runBackup();
      setLastBackup(await getLastBackupAt());
      setMaintMsg(
        r.copiedTo
          ? tn(r.sessions, "Copia salvata (1 call) e copiata nella cartella scelta.", "Copia salvata ({n} call) e copiata nella cartella scelta.")
          : tn(r.sessions, "Copia salvata (1 call).", "Copia salvata ({n} call)."),
      );
    } catch (e) {
      setMaintMsg(tx("Copia non riuscita: ", "Backup failed: ") + String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runTest(which: "main" | "priv") {
    setTest({ which, ok: null, message: t("Provo…") });
    const r = await testProvider(which === "main" ? d.local : d.privCfg);
    setTest({ which, ok: r.ok, message: r.message });
  }

  async function doExport() {
    setBusy("export");
    setMaintMsg(null);
    setExported(null);
    try {
      const r = await exportAllMarkdown((done, total) => setMaintMsg(t("Esporto… {done}/{total}", { done, total })));
      setExported(r.dir);
      setMaintMsg(tn(r.count, "Esportate 1 call in Markdown.", "Esportate {n} call in Markdown."));
    } catch (e) {
      setMaintMsg(t("Export non riuscito: {error}", { error: String(e) }));
    } finally {
      setBusy(null);
    }
  }

  async function checkEmbedModel() {
    setEmbedStatus("checking");
    setEmbedErr(null);
    try {
      const [v] = await embed(["test"], "query");
      setEmbedStatus(v && v.length ? "ready" : "error");
    } catch (e) {
      setEmbedErr(String(e));
      setEmbedStatus("error");
    }
  }

  function go(id: SettingsSection) {
    const el = document.getElementById(`set-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    el?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    setActive(id);
  }

  const localMain = isLocalProvider(d.local);

  return (
    <div className="page settings-page">
      <div className="page-scroll" ref={scrollRef}>
        <div className="page-col settings-col">
          <header className="page-head">
            <div className="page-head-text">
              <h1 className="page-title">{t("Impostazioni")}</h1>
              <p className="page-sub">{t("Tutto resta su questo PC. Il tema si applica subito, il resto quando premi Salva.")}</p>
            </div>
          </header>

          {restored && dirty && (
            <p className="settings-restored" role="status">
              {t("Avevi lasciato delle modifiche senza salvarle: sono qui sotto. Salva per tenerle, Annulla per tornare a com'era.")}
            </p>
          )}

          <div className="settings-layout">
            <nav className="settings-nav" aria-label={t("Sezioni delle impostazioni")}>
              {SECTIONS.map((s) => (
                <button key={s.id} className="settings-nav-item" aria-current={active === s.id ? "true" : undefined} onClick={() => go(s.id)}>
                  {s.label}
                </button>
              ))}
            </nav>

            <div className="settings-content">
              <Section
                id="modello"
                title={t("Modello")}
                intro={t("Il cervello di Mori: qualsiasi modello compatibile OpenAI. In cloud escono solo i pezzi utili alla risposta, mai l'audio né l'archivio; in locale non esce niente.")}
              >
                <div className="preset-row" role="group" aria-label={t("Scelte pronte")}>
                  {PROVIDER_PRESETS.map((p) => (
                    <button
                      key={p.name}
                      className="preset"
                      aria-pressed={d.local.baseUrl.trim() === p.baseUrl}
                      onClick={() => {
                        setTest(null);
                        set("local", { baseUrl: p.baseUrl, model: p.model, apiKey: p.local ? "" : d.local.apiKey });
                      }}
                      title={p.hint}
                    >
                      {p.name}
                      <span className={"preset-tag" + (p.local ? " loc" : "")}>{p.local ? t("locale") : p.tag}</span>
                    </button>
                  ))}
                </div>
                <ProviderBadge cfg={d.local} />
                <Field id="s-base" label={t("Indirizzo (base URL)")}>
                  <input id="s-base" className="input" value={d.local.baseUrl} onChange={(e) => set("local", { ...d.local, baseUrl: e.target.value })} />
                </Field>
                <Field id="s-model" label={t("Modello")}>
                  <input id="s-model" className="input" value={d.local.model} onChange={(e) => set("local", { ...d.local, model: e.target.value })} />
                </Field>
                <Field id="s-key" label={t("Chiave API")} hint={localMain ? t("Non serve per un modello sul tuo PC.") : t("Resta solo su questo PC.")}>
                  <input
                    id="s-key"
                    className="input"
                    type="password"
                    autoComplete="off"
                    placeholder={localMain ? t("non serve") : t("incolla la tua chiave")}
                    value={d.local.apiKey}
                    onChange={(e) => set("local", { ...d.local, apiKey: e.target.value })}
                  />
                </Field>
                <TestRow which="main" test={test} onTest={() => void runTest("main")} />

                <h3 className="set-sub">{t("Call private")}</h3>
                {localMain ? (
                  <p className="set-hint">{t("Il cervello di Mori è già sul tuo PC: anche le call private usano quello, e nulla esce.")}</p>
                ) : (
                  <>
                    <p className="set-hint">
                      {t(
                        "Una call segnata “privata” non va mai al cloud. Per farla capire comunque a Mori indica un modello locale (Ollama o LM Studio, gratuiti). Senza, resta trascritta ma non organizzata, e il richiamo non la usa.",
                      )}
                    </p>
                    <Field
                      id="s-priv-url"
                      label={t("Indirizzo del modello locale")}
                      error={d.privCfg.baseUrl.trim() && !isLocalProvider(d.privCfg) ? t("Questo indirizzo non è sul tuo PC: per le call private serve localhost.") : undefined}
                    >
                      <input
                        id="s-priv-url"
                        className="input"
                        value={d.privCfg.baseUrl}
                        placeholder="http://localhost:11434/v1"
                        onChange={(e) => set("privCfg", { ...d.privCfg, baseUrl: e.target.value })}
                      />
                    </Field>
                    <Field id="s-priv-model" label={t("Modello locale")}>
                      <input
                        id="s-priv-model"
                        className="input"
                        value={d.privCfg.model}
                        placeholder={t("es. qwen2.5:7b")}
                        onChange={(e) => set("privCfg", { ...d.privCfg, model: e.target.value })}
                      />
                    </Field>
                    <TestRow which="priv" test={test} disabled={!isLocalProvider(d.privCfg)} onTest={() => void runTest("priv")} />
                  </>
                )}
              </Section>

              <Section
                id="registrazione"
                title={t("Registrazione")}
                intro={t("Tu dal microfono, l'altro dall'audio del PC. Si registra dal controllo in alto a sinistra o con la scorciatoia, anche con Mori dietro altre finestre.")}
              >
                <Field id="s-hotkey" label={t("Scorciatoia per registrare e fermare")}>
                  <input
                    id="s-hotkey"
                    className="input mono narrow"
                    value={d.cmp.hotkey}
                    placeholder={DEFAULT_HOTKEY}
                    onChange={(e) => set("cmp", { ...d.cmp, hotkey: e.target.value })}
                  />
                </Field>
                <Field id="s-silence" label={t("Proponi lo stop dopo un silenzio di")} hint={t("Minuti senza una parola da nessuno dei due lati. 0 = mai.")}>
                  <span className="input-unit">
                    <input
                      id="s-silence"
                      className="input narrow"
                      type="number"
                      min={0}
                      max={120}
                      value={d.cmp.silenceMin}
                      onChange={(e) => set("cmp", { ...d.cmp, silenceMin: Math.max(0, Number(e.target.value) || 0) })}
                    />
                    {t("minuti")}
                  </span>
                </Field>
                <Switch
                  id="s-detect"
                  label={t("Suggerisci di registrare quando rilevo una call")}
                  hint={t("Meet, Zoom, Teams o Webex davanti: Mori lo propone, non registra mai da solo.")}
                  checked={d.callDetect}
                  onChange={(v) => set("callDetect", v)}
                />
                <Switch
                  id="s-tray"
                  label={t("Chiudendo la finestra, Mori resta nella barra")}
                  hint={t("Registrazione e trascrizioni vanno avanti; lo riapri dall'icona.")}
                  checked={d.cmp.closeToTray}
                  onChange={(v) => set("cmp", { ...d.cmp, closeToTray: v })}
                />
                {!trayOk && (
                  <p className="set-warn">
                    {t("L'icona nella barra non è partita: la scorciatoia e la chiusura in background non sono attive in questa sessione.")}
                  </p>
                )}
              </Section>

              <Section
                id="trascrizione"
                title={t("Trascrizione")}
                intro={t("Whisper trasforma la voce in testo: sul tuo PC, in background, o in cloud quando conta la velocità.")}
              >
                <div className="field">
                  <span className="field-label" id="s-stt-l">{t("Dove trascrivere")}</span>
                  <Choices
                    name="stt"
                    labelledBy="s-stt-l"
                    value={d.sttMode}
                    onChange={(v) => set("sttMode", v)}
                    options={[
                      {
                        value: "cloud",
                        title: t("Veloce, con Groq"),
                        tag: t("gratis"),
                        desc: t("Un'ora di call in meno di un minuto. Esce solo il parlato (i silenzi restano qui) e Groq non lo usa per addestrare. Mai per le call private; se qualcosa non va, trascrivo sul PC."),
                      },
                      {
                        value: "local",
                        title: t("Sul tuo PC"),
                        desc: t("Privato e gratis, ma lento: su un portatile un'ora di call richiede 10–30 minuti."),
                      },
                    ]}
                  />
                </div>
                {d.sttMode === "cloud" && (
                  <Field
                    id="s-stt-key"
                    label={t("Chiave Groq")}
                    hint={
                      sttKeyFor("", d.local)
                        ? t("Uso quella del modello, che è già Groq. Scrivine una qui solo per usarne un'altra.")
                        : t("Gratis su console.groq.com → API Keys. Resta sul tuo PC.")
                    }
                    error={!sttKeyFor(d.sttKey, d.local) ? t("Senza una chiave trascrivo sul PC.") : undefined}
                  >
                    <input
                      id="s-stt-key"
                      className="input mono"
                      type="password"
                      autoComplete="off"
                      value={d.sttKey}
                      placeholder="gsk_…"
                      onChange={(e) => set("sttKey", e.target.value)}
                    />
                  </Field>
                )}
                <Field id="s-whisper" label={t("Qualità")} hint={t("Più grande = più fedele ma più lento.")}>
                  <select id="s-whisper" className="input" value={d.whisper} onChange={(e) => set("whisper", e.target.value as WhisperModel)}>
                    <option value="large-v3-turbo">{t("Massima (turbo), consigliata")}</option>
                    <option value="medium">{t("Media, più leggera")}</option>
                  </select>
                </Field>
                <Field
                  id="s-ctx"
                  label={t("Di cosa parli di solito")}
                  hint={t("Una frase che Whisper legge prima di ogni call: il gergo del tuo lavoro esce scritto giusto. Resta sul tuo PC.")}
                >
                  <textarea
                    id="s-ctx"
                    className="input"
                    rows={2}
                    value={d.whisperCtx}
                    placeholder={t("es. Lavoro in una startup di prodotto: roadmap, onboarding, SEO, Notion, Figma.")}
                    onChange={(e) => set("whisperCtx", e.target.value)}
                  />
                </Field>
                <div className="field">
                  <span className="field-label">{t("Richiamo per significato (modello locale)")}</span>
                  <div className="embed-status">
                    <span className={"embed-dot " + embedStatus} aria-hidden="true" />
                    <span className="embed-label" role="status">
                      {embedStatus === "ready"
                        ? t("Pronto")
                        : embedStatus === "checking"
                          ? t("Verifica in corso…")
                          : embedStatus === "error"
                            ? t("Non disponibile")
                            : t("Da verificare")}
                    </span>
                    <button className="btn sm" disabled={embedStatus === "checking"} onClick={checkEmbedModel}>
                      {embedStatus === "ready" ? t("Verifica di nuovo") : t("Scarica e verifica")}
                    </button>
                  </div>
                  <p className="field-hint">
                    {t("Serve a capire domande diverse dalle parole esatte. Gira offline; al primo uso scarica circa 120 MB in ~/.mori/models.")}
                  </p>
                  {embedErr && <p className="field-error">{embedErr}</p>}
                </div>
              </Section>

              <Section id="nomi" title={t("Tu e i nomi")}>
                <Field
                  id="s-names"
                  label={t("Come ti chiamano nelle call")}
                  hint={t("Serve a dividere le cose da fare tue da quelle degli altri. Se una call ti ha capito male (es. “Alenso”), aggiungilo qui, separato da virgole.")}
                >
                  <input id="s-names" className="input" value={d.namesDraft} placeholder={t("Tu, te, e il tuo nome")} onChange={(e) => set("namesDraft", e.target.value)} />
                </Field>

                <h3 className="set-sub">{t("Dizionario dei nomi")}</h3>
                <p className="set-hint">{t("Come si scrivono le persone e i progetti di cui parli: Mori li suggerisce a Whisper mentre trascrive e li corregge dopo. Si salvano subito.")}</p>
                <ul className="vocab-list">
                  {terms.length === 0 && <li className="vocab-empty">{t("Ancora nessun nome.")}</li>}
                  {terms.map((term) => (
                    <li key={term.id} className="vocab-row">
                      <span className="vocab-wrong">{term.wrong || "—"}</span>
                      <IconArrowRight size={13} />
                      <span className="vocab-right">{term.correct}</span>
                      <button className="icon-btn danger-hover" aria-label={t("Togli {name}", { name: term.correct })} onClick={() => void removeTerm(term.id)}>
                        <IconClose size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
                <form
                  className="vocab-add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveTerm();
                  }}
                >
                  <input className="input" aria-label={t("Come lo scrive male (facoltativo)")} placeholder={t("come lo scrive male (facoltativo)")} value={newWrong} onChange={(e) => setNewWrong(e.target.value)} />
                  <input className="input" aria-label={t("Come si scrive")} placeholder={t("come si scrive")} value={newRight} onChange={(e) => setNewRight(e.target.value)} />
                  <button className="btn sm" type="submit" disabled={!newRight.trim()}>
                    {t("Aggiungi")}
                  </button>
                </form>
                <div className="vocab-actions">
                  {pendingApply ? (
                    <>
                      <span className="set-hint">
                        {pendingApply.total === 0
                          ? t("Nelle call esistenti non c'è niente da correggere.")
                          : tn(
                              pendingApply.total,
                              "Cambierà 1 nomi nelle call esistenti. I trascritti restano com'erano.",
                              "Cambierà {n} nomi nelle call esistenti. I trascritti restano com'erano.",
                            )}
                      </span>
                      <button className="btn sm ghost" onClick={() => setPendingApply(null)}>
                        {tx("Annulla", "Cancel")}
                      </button>
                      {pendingApply.total > 0 && (
                        <button className="btn sm primary" onClick={() => void doApply()}>
                          {t("Correggi")}
                        </button>
                      )}
                    </>
                  ) : (
                    <button className="btn sm" onClick={() => void askApply()} disabled={terms.length === 0}>
                      {t("Applica alle call esistenti")}
                    </button>
                  )}
                </div>
                {vocabMsg && <p className="set-hint" role="status">{vocabMsg}</p>}
              </Section>

              <Section id="aspetto" title={t("Aspetto")}>
                <div className="field">
                  <span className="field-label" id="s-theme-l">{t("Tema")}</span>
                  <div className="segmented" role="radiogroup" aria-labelledby="s-theme-l">
                    {(
                      [
                        ["auto", t("Come Windows")],
                        ["light", t("Chiaro")],
                        ["dark", t("Scuro")],
                      ] as [Theme, string][]
                    ).map(([t, label]) => (
                      <button
                        key={t}
                        role="radio"
                        aria-checked={theme === t}
                        className="seg"
                        onClick={() => {
                          setThemeState(t);
                          setTheme(t); // a display choice: applies at once, no need to press Salva
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="field-hint">{t("Si applica subito, anche alla finestrella sempre in primo piano.")}</p>
                </div>
                <div className="field">
                  <span className="field-label" id="s-lang-l">{t("Lingua")}</span>
                  <div className="segmented" role="radiogroup" aria-labelledby="s-lang-l">
                    {(
                      [
                        ["auto", t("Come il sistema")],
                        ["it", "Italiano"],
                        ["en", "English"],
                      ] as [LangPref, string][]
                    ).map(([l, label]) => (
                      <button
                        key={l}
                        role="radio"
                        aria-checked={langPref === l}
                        className="seg"
                        onClick={() => {
                          if (l === langPref) return;
                          setLangPref(l);
                          // Labels computed once at startup follow only after a
                          // reload; unsaved changes come back (see `leftover`).
                          leftover = draftRef.current.dirty ? draftRef.current.d : null;
                          window.location.reload();
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="field-hint">{t("Interfaccia, sintesi e cose da fare delle prossime call. Mori si ricarica un attimo.")}</p>
                </div>
              </Section>

              <Section id="spazio" title={t("Spazio e copie")}>
                <div className="field">
                  <span className="field-label" id="s-keep-l">{t("L'audio delle call, dopo la trascrizione")}</span>
                  <Choices
                    name="keep"
                    labelledBy="s-keep-l"
                    value={d.audioKeep}
                    onChange={(v) => set("audioKeep", v)}
                    options={[
                      {
                        value: "none",
                        title: t("Non tenerlo"),
                        tag: t("consigliato"),
                        desc: t("Resta il trascritto, con chi ha detto cosa e quando. Niente spazio occupato; le righe non si riascoltano."),
                      },
                      {
                        value: "folder",
                        title: t("In una cartella che scegli"),
                        desc: t("Per esempio una cartella di OneDrive o Google Drive con «file su richiesta»: non pesa sul PC e lo riascolti quando serve."),
                      },
                      {
                        value: "local",
                        title: t("Sul tuo PC"),
                        desc: t("Compresso senza perdita, circa 30–60 MB per ora di call."),
                      },
                    ]}
                  />
                </div>
                {d.audioKeep === "folder" && (
                  <Field
                    id="s-audio-dir"
                    label={t("Cartella per l'audio")}
                    error={!d.audioDir.trim() ? t("Senza cartella l'audio resta sul PC.") : undefined}
                  >
                    <input
                      id="s-audio-dir"
                      className="input"
                      placeholder={t("es. C:\\Users\\…\\OneDrive\\Mori\\Audio")}
                      value={d.audioDir}
                      onChange={(e) => set("audioDir", e.target.value)}
                    />
                  </Field>
                )}
                <div className="maint-row">
                  <div className="maint-text">
                    <strong>{t("Audio sul PC")}</strong>
                    <span>
                      {stats
                        ? stats.wav_count + stats.flac_count === 0
                          ? t("Nessun audio: non occupa spazio.")
                          : tn(stats.wav_count + stats.flac_count, "{size} in 1 file", "{size} in {n} file", { size: humanBytes(stats.wav_bytes + stats.flac_bytes) })
                        : "—"}
                    </span>
                  </div>
                  {freeAsk ? (
                    <span className="maint-confirm" role="group" aria-label={t("Conferma")}>
                      <span className="maint-confirm-q">{t("Elimino l'audio delle call già trascritte? Non si può annullare.")}</span>
                      <button className="btn sm danger" onClick={() => void doFreeAudio()} disabled={busy !== null}>
                        {t("Elimina l'audio")}
                      </button>
                      <button className="btn sm" onClick={() => setFreeAsk(false)}>
                        {tx("Annulla", "Cancel")}
                      </button>
                    </span>
                  ) : (
                    <span className="maint-acts">
                      {!!stats?.wav_count && (
                        <button className="btn sm" onClick={() => void doCompress()} disabled={busy !== null}>
                          {busy === "audio" ? t("Comprimo…") : t("Comprimi gli audio")}
                        </button>
                      )}
                      <button
                        className="btn sm"
                        onClick={() => setFreeAsk(true)}
                        disabled={busy !== null || !stats || stats.wav_count + stats.flac_count === 0}
                      >
                        {busy === "free" ? t("Libero spazio…") : t("Libera spazio")}
                      </button>
                    </span>
                  )}
                </div>
                <div className="maint-row">
                  <div className="maint-text">
                    <strong>{t("Copie")}</strong>
                    <span>
                      {lastBackup ? t("Ultima: {date}", { date: new Date(lastBackup).toLocaleString(locale()) }) : t("Ancora nessuna copia.")}{" "}
                      {t("Mori ne fa una al giorno e tiene le ultime 7.")}
                    </span>
                  </div>
                  <button className="btn sm" onClick={() => void doBackup()} disabled={busy !== null}>
                    {busy === "backup" ? t("Copio…") : t("Fai una copia adesso")}
                  </button>
                </div>
                <Field
                  id="s-dir2"
                  label={t("Seconda cartella per le copie")}
                  hint={t("Se la indichi, Mori ci mette anche l'ultima copia (es. una cartella di OneDrive).")}
                >
                  <input id="s-dir2" className="input" placeholder={t("es. C:\\Users\\...\\OneDrive\\Mori")} value={d.dir2} onChange={(e) => set("dir2", e.target.value)} />
                </Field>
                <div className="maint-row">
                  <div className="maint-text">
                    <strong>{t("Esporta in Markdown")}</strong>
                    <span>{t("Tutte le call come file leggibili ovunque (Obsidian, Notion, un editor): i tuoi dati non restano chiusi dentro Mori.")}</span>
                  </div>
                  <button className="btn sm" onClick={() => void doExport()} disabled={busy !== null}>
                    {busy === "export" ? t("Esporto…") : t("Esporta tutto")}
                  </button>
                </div>
                {maintMsg && (
                  <p className="set-hint" role="status">
                    {maintMsg}{" "}
                    {exported && (
                      <button className="link-btn" onClick={() => void revealInFolder(exported).catch((e) => setMaintMsg(String(e)))}>
                        {t("Apri la cartella")}
                      </button>
                    )}
                  </p>
                )}
              </Section>
            </div>
          </div>
        </div>
      </div>

      {dirty && (
        <div className="save-bar" role="region" aria-label={t("Modifiche non salvate")}>
          <span>{t("Modifiche non salvate")}</span>
          <button className="btn sm ghost" onClick={() => setD(base)}>
            {tx("Annulla", "Cancel")}
          </button>
          <button className="btn sm primary" onClick={save} title={t("Salva (Ctrl S)")}>
            {t("Salva")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Radio cards: a choice with consequences deserves a sentence each. */
function Choices<V extends string>({
  name,
  labelledBy,
  value,
  onChange,
  options,
}: {
  name: string;
  labelledBy: string;
  value: V;
  onChange: (v: V) => void;
  options: { value: V; title: string; desc: string; tag?: string }[];
}) {
  return (
    <div className="choices" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <label key={o.value} className={"choice" + (value === o.value ? " on" : "")}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span className="choice-text">
            <span className="choice-title">
              {o.title}
              {o.tag && <span className="choice-tag">{o.tag}</span>}
            </span>
            <span className="choice-desc">{o.desc}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function Section({ id, title, intro, children }: { id: SettingsSection; title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="set-section" id={`set-${id}`} aria-labelledby={`set-${id}-h`}>
      <h2 className="set-title" id={`set-${id}-h`} tabIndex={-1}>
        {title}
      </h2>
      {intro && <p className="set-hint">{intro}</p>}
      {children}
    </section>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

function Switch({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="field switch-field">
      <label className="switch-row" htmlFor={id}>
        <span className="switch-text">
          <span className="field-label">{label}</span>
          {hint && <span className="field-hint">{hint}</span>}
        </span>
        <input id={id} type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </label>
    </div>
  );
}

function TestRow({
  which,
  test,
  disabled,
  onTest,
}: {
  which: "main" | "priv";
  test: { which: "main" | "priv"; ok: boolean | null; message: string } | null;
  disabled?: boolean;
  onTest: () => void;
}) {
  return (
    <div className="test-row">
      <button className="btn sm" onClick={onTest} disabled={test?.ok === null || disabled}>
        {t("Verifica")}
      </button>
      {test?.which === which && (
        <span className={"test-msg" + (test.ok === null ? "" : test.ok ? " ok" : " ko")} role="status">
          {test.message}
        </span>
      )}
    </div>
  );
}

// One click to a working setup. Models are only suggestions: every field stays editable.
const PROVIDER_PRESETS: { name: string; baseUrl: string; model: string; local: boolean; tag: string; hint: string }[] = [
  {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    local: false,
    tag: t("gratis"),
    hint: t("Veloce, piano gratuito, non allena sui tuoi dati. Chiave su console.groq.com"),
  },
  {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    local: false,
    tag: "cloud",
    hint: t("Chiave su platform.openai.com"),
  },
  {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-oss-120b",
    local: false,
    tag: "cloud",
    hint: t("Centinaia di modelli con una chiave sola. Chiave su openrouter.ai"),
  },
  {
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
    local: true,
    tag: t("locale"),
    hint: t("Gratis e sul tuo PC: ollama.com, poi `ollama pull qwen2.5:7b`"),
  },
  {
    name: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    model: "local-model",
    local: true,
    tag: t("locale"),
    hint: t("Gratis e sul tuo PC: lmstudio.ai, avvia il server locale con un modello caricato"),
  },
];

/** Where the words go, in one line. */
function ProviderBadge({ cfg }: { cfg: ProviderConfig }) {
  if (!cfg.baseUrl.trim()) return null;
  const local = isLocalProvider(cfg);
  let host = cfg.baseUrl;
  try {
    host = new URL(cfg.baseUrl.trim()).host;
  } catch {
    /* show what was typed */
  }
  return (
    <p className={"provider-badge" + (local ? " loc" : "")}>
      <LockIcon open={!local} size={12} />
      {local ? t("Sul tuo PC ({host}): non esce niente.", { host }) : t("In cloud ({host}): escono solo i pezzi utili alla risposta.", { host })}
    </p>
  );
}
