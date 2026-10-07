// ⌘K (docs/DESIGN.md §5, reference: Raycast): one field, results in groups,
// the first row lit up, ↑↓ to choose, Enter to run it. Finds calls, sentences
// said in them, people; goes to any section or settings; does things.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "../db";
import type { Entity } from "./people";
import { searchTranscripts, type TranscriptHit } from "../search";
import { getTheme, setTheme, type Theme } from "../theme";
import Dragon from "../ui/Mark";
import { fmtClock, fmtDate } from "../ui/format";
import { hotkeyParts } from "../ui/keys";
import { IconFile, IconKeyboard, IconMoon, IconPlus, IconSettings, IconSun, IconWave } from "../ui/icons";
import { SECTIONS } from "./Sidebar";
import type { SettingsSection } from "./settings/SettingsView";
import { t, tn } from "../i18n";
import "./CommandPalette.css";

type Item = {
  key: string;
  group: string;
  /** What filtering matches against (lowercase). */
  text: string;
  label: ReactNode;
  icon: ReactNode;
  hint?: ReactNode;
  run: () => void;
};

const SETTINGS: [SettingsSection, string][] = [
  ["modello", t("Modello")],
  ["registrazione", t("Registrazione")],
  ["trascrizione", t("Trascrizione")],
  ["nomi", t("Tu e i nomi")],
  ["aspetto", t("Aspetto")],
  ["spazio", t("Spazio e copie")],
];

export default function CommandPalette({
  sessions,
  entities,
  mineCount,
  hotkey,
  onClose,
  onAsk,
  onOpenSource,
  onOpenPerson,
  onSection,
  onRecord,
  onAddCall,
  onOpenSettings,
  onOpenShortcuts,
}: {
  sessions: Session[];
  entities: Entity[];
  mineCount: number;
  hotkey: string;
  onClose: () => void;
  onAsk: (q: string) => void;
  onOpenSource: (id: string, start?: number | null) => void;
  onOpenPerson: (id: string | null) => void;
  onSection: (s: (typeof SECTIONS)[number]["id"]) => void;
  onRecord: () => void;
  onAddCall: () => void;
  onOpenSettings: (section?: SettingsSection) => void;
  onOpenShortcuts: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<TranscriptHit[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim();
  const ql = q.toLowerCase();

  // Lines of transcript that contain what is typed.
  useEffect(() => {
    if (q.length < 3) {
      setHits([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void searchTranscripts(q, 6)
        .then((h) => alive && setHits(h))
        .catch(() => alive && setHits([]));
    }, 140);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const theme = getTheme();
    const ask: Item | null = q
      ? { key: "ask", group: "", text: ql, label: <>{t("Chiedi a Mori: “{q}”", { q })}</>, icon: <Dragon size={16} />, run: () => onAsk(q) }
      : null;
    // A question goes to Mori first; a word or a name first looks for what it
    // names (a call, a person, a section), and asking stays one row below.
    const question = /\?|^(cosa|chi|quando|come|perch|dove|quant|qual|che |mi |ho |abbiamo|devo|dimmi|riassum)/i.test(q) || q.split(/\s+/).length >= 3;
    if (ask && question) out.push(ask);
    const calls = (q ? sessions.filter((s) => s.title.toLowerCase().includes(ql)) : sessions).slice(0, 5);
    for (const s of calls) {
      out.push({
        key: "call-" + s.id,
        group: q ? t("Call") : t("Recenti"),
        text: s.title.toLowerCase(),
        label: s.title,
        icon: <IconFile size={15} />,
        hint: <span className="mono">{fmtDate(s.started_at)}</span>,
        run: () => onOpenSource(s.id),
      });
    }
    const hitItems: Item[] = [];
    hits.forEach((h, i) =>
      hitItems.push({
        key: `hit-${h.sessionId}-${i}`,
        group: t("Detto nelle call"),
        text: ql,
        label: (
          <span className="cmd-hit">
            <span className="cmd-hit-text">
              {h.speaker && <b>{h.speaker}: </b>}
              {h.snippet.before}
              <mark>{h.snippet.match}</mark>
              {h.snippet.after}
            </span>
            <span className="cmd-hit-src">{h.title}</span>
          </span>
        ),
        icon: <IconWave size={15} />,
        hint: h.start != null ? <span className="mono">▶ {fmtClock(Math.floor(h.start))}</span> : undefined,
        run: () => onOpenSource(h.sessionId, h.start),
      }),
    );
    if (question) out.push(...hitItems);
    if (q) {
      for (const e of entities.filter((x) => x.name.toLowerCase().includes(ql)).slice(0, 5)) {
        out.push({
          key: "ent-" + e.id,
          group: t("Persone e progetti"),
          text: e.name.toLowerCase(),
          label: e.name,
          icon: <span className={"merge-mini" + (e.kind === "project" ? " proj" : "")}>{(e.name.trim()[0] ?? "?").toUpperCase()}</span>,
          hint: <span className="mono">{tn(e.calls, "1 call", "{n} call")}</span>,
          run: () => onOpenPerson(e.id),
        });
      }
    }
    const goto: Item[] = SECTIONS.map((s, i) => ({
      key: "go-" + s.id,
      group: t("Vai a"),
      text: s.label.toLowerCase(),
      label: s.label,
      icon: <s.icon size={15} />,
      hint: (
        <span className="kbd-row">
          <kbd>Ctrl</kbd>
          <kbd>{i + 1}</kbd>
        </span>
      ),
      run: () => onSection(s.id),
    }));
    goto[2].hint = mineCount > 0 ? <span className="mono">{t("{n} tue", { n: mineCount })}</span> : goto[2].hint;
    const settings: Item[] = SETTINGS.map(([id, label]) => ({
      key: "set-" + id,
      group: t("Vai a"),
      text: `${t("Impostazioni")} ${label}`.toLowerCase(),
      label: <>{t("Impostazioni → {section}", { section: label })}</>,
      icon: <IconSettings size={15} />,
      run: () => onOpenSettings(id),
    }));
    const themes: [Theme, string, ReactNode][] = [
      ["dark", t("Tema scuro"), <IconMoon size={15} key="m" />],
      ["light", t("Tema chiaro"), <IconSun size={15} key="s" />],
      ["auto", t("Tema come Windows"), <IconSettings size={15} key="a" />],
    ];
    const actions: Item[] = [
      {
        key: "rec",
        group: t("Azioni"),
        text: t("Registra la call").toLowerCase(),
        label: t("Registra la call"),
        icon: <span className="cmd-rec" aria-hidden="true" />,
        hint: (
          <span className="kbd-row">
            {hotkeyParts(hotkey).map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </span>
        ),
        run: onRecord,
      },
      {
        key: "add",
        group: t("Azioni"),
        text: t("aggiungi call incolla un trascritto"),
        label: t("Incolla un trascritto"),
        icon: <IconPlus size={15} />,
        run: onAddCall,
      },
      ...themes
        .filter(([th]) => th !== theme)
        .map(([th, label, icon]) => ({ key: "theme-" + th, group: t("Azioni"), text: label.toLowerCase(), label, icon, run: () => setTheme(th) })),
      {
        key: "keys",
        group: t("Azioni"),
        text: t("Scorciatoie da tastiera").toLowerCase(),
        label: t("Scorciatoie da tastiera"),
        icon: <IconKeyboard size={15} />,
        hint: <kbd>?</kbd>,
        run: onOpenShortcuts,
      },
    ];
    if (q) {
      const match = (it: Item) => it.text.includes(ql);
      out.push(...goto.filter(match), ...settings.filter(match), ...actions.filter(match));
      if (ask && !question) out.push(ask, ...hitItems);
    } else {
      out.push(...goto, { ...settings[0], label: t("Impostazioni"), text: t("Impostazioni").toLowerCase(), run: () => onOpenSettings() }, ...actions);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sessions, hits, entities, mineCount, hotkey]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`#cmd-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function run(i: number) {
    const it = items[i];
    if (!it) return;
    onClose();
    it.run();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      run(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  // Render in groups, keeping one running index for the keyboard.
  let lastGroup: string | null = null;
  return (
    <div className="cmd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmd" role="dialog" aria-modal="true" aria-label={t("Cerca o chiedi")}>
        <div className="cmd-input-row">
          <Dragon size={18} />
          <input
            className="cmd-input"
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-list"
            aria-autocomplete="list"
            aria-activedescendant={items.length ? `cmd-opt-${active}` : undefined}
            aria-label={t("Cerca una call, una frase, una persona, o chiedi a Mori")}
            placeholder={t("Cerca una call, una frase detta, una persona… o chiedi")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <kbd>esc</kbd>
        </div>

        <div className="cmd-list" id="cmd-list" role="listbox" ref={listRef} aria-label={t("Risultati")}>
          {items.map((it, i) => {
            const head = it.group !== lastGroup && it.group ? <div className="cmd-group-label" role="presentation">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.key} role="presentation">
                {head}
                <div
                  id={`cmd-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={"cmd-row" + (i === active ? " active" : "")}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => run(i)}
                >
                  <span className="cmd-ico">{it.icon}</span>
                  <span className="cmd-row-main">{it.label}</span>
                  {it.hint && <span className="cmd-hint">{it.hint}</span>}
                </div>
              </div>
            );
          })}
          {items.length === 0 && <p className="cmd-empty">{t("Niente da mostrare.")}</p>}
        </div>

        <div className="cmd-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t("scegli")}
          </span>
          <span>
            <kbd>↵</kbd> {t("apri")}
          </span>
          <span className="cmd-foot-right">
            <kbd>esc</kbd> {t("chiudi")}
          </span>
        </div>
      </div>
    </div>
  );
}
