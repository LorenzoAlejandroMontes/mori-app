// A call as a Markdown document — to paste in Notion/Slack/an email, or to keep
// as a human-readable copy outside Mori (DECISIONS.md, decision 3: export as the
// anti lock-in backup). Pure: the DB reads live in followup.ts.
import { locale, t } from "./i18n";
import { assigneeLabel, speakerLabel } from "./speakers-logic";

export type ExportCall = {
  title: string;
  startedAt: string | null;
  participants: string[];
  categories: string[];
  summary: string;
  actions: { text: string; assignee: string | null; due: string | null; done: boolean }[];
  decisions?: { what: string; figures: string | null }[];
  /** Included only when asked for: it can be very long. */
  transcript?: string;
  private?: boolean;
};

function fmtDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" });
}

/** Strip the summary's own "## " level down one, so the call title stays the
 *  only top heading of the document. */
function demote(md: string): string {
  return md.replace(/^(#{1,5})\s/gm, (_m, h: string) => `${h}# `);
}

export function callToMarkdown(c: ExportCall): string {
  const out: string[] = [];
  out.push(`# ${c.title.trim() || t("Call senza titolo")}`);
  const meta: string[] = [];
  const day = fmtDay(c.startedAt);
  if (day) meta.push(day);
  if (c.participants.length) meta.push(c.participants.map(speakerLabel).join(", "));
  if (c.categories.length) meta.push(c.categories.map((x) => `#${x.replace(/\s+/g, "-")}`).join(" "));
  if (meta.length) out.push(`_${meta.join(" · ")}_`);
  if (c.private) out.push("> " + t("Call privata: letta solo da un modello locale."));

  if (c.summary.trim()) out.push("", demote(c.summary.trim()));

  if (c.decisions?.length) {
    out.push("", "## " + t("Decisioni"));
    for (const d of c.decisions) out.push(`- ${d.what}${d.figures ? ` (${d.figures})` : ""}`);
  }

  if (c.actions.length) {
    out.push("", "## " + t("Da fare"));
    for (const a of c.actions) {
      const tail = [a.assignee ? assigneeLabel(a.assignee) : "", a.due ? t("entro {due}", { due: a.due }) : ""].filter(Boolean).join(", ");
      out.push(`- [${a.done ? "x" : " "}] ${a.text}${tail ? ` (${tail})` : ""}`);
    }
  }

  if (c.transcript?.trim()) out.push("", "## " + t("Trascritto"), "", c.transcript.trim());

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export type TranscriptTurn = { speaker: string; start: number | null; text: string };

/** The transcript as turns: the lines one voice says in a row become one
 *  paragraph, timed where it starts. `nameOf` turns the recorder's label into
 *  the name to print. Without timed lines, the saved text is read line by line. */
export function transcriptTurns(
  segments: { start: number; speaker: string; text: string }[],
  memo: string,
  nameOf: (label: string) => string,
): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  const push = (label: string, start: number | null, text: string) => {
    const body = text.trim();
    if (!body) return;
    const speaker = label ? nameOf(label) : "";
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) last.text += " " + body;
    else turns.push({ speaker, start, text: body });
  };
  if (segments.length) {
    for (const s of segments) push(s.speaker, s.start, s.text);
    return turns;
  }
  for (const raw of memo.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([^:]{1,40}):\s*(.*)$/.exec(line);
    if (m && /^(Tu|Interlocutore|[A-ZÀ-Ù])/.test(m[1].trim())) push(m[1].trim(), null, m[2]);
    else if (turns.length) turns[turns.length - 1].text += " " + line;
    else turns.push({ speaker: "", start: null, text: line });
  }
  return turns;
}

function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** The whole transcript as plain text, to paste anywhere: "Giulia: …". */
export function transcriptToText(turns: TranscriptTurn[]): string {
  return turns.map((x) => (x.speaker ? `${x.speaker}: ${x.text}` : x.text)).join("\n\n") + "\n";
}

/** The transcript as the Markdown file an assistant reads best: what the call
 *  was and who spoke on top, then one block per turn with its time. */
export function transcriptToMarkdown(
  c: Pick<ExportCall, "title" | "startedAt">,
  turns: TranscriptTurn[],
  durationSecs = 0,
): string {
  const out: string[] = [`# ${c.title.trim() || t("Call senza titolo")}`, ""];
  const day = fmtDay(c.startedAt);
  if (day) out.push(`- ${t("Data")}: ${day}`);
  if (durationSecs > 0) out.push(`- ${t("Durata")}: ${clock(durationSecs)}`);
  const voices = [...new Set(turns.map((x) => x.speaker).filter(Boolean))];
  if (voices.length) out.push(`- ${t("Voci")}: ${voices.join(", ")}`);
  out.push(`- ${t("Origine")}: ${t("trascritto automatico di una call registrata; nomi e termini tecnici possono essere scritti male.")}`);
  out.push("", "## " + t("Trascritto"));
  for (const x of turns) {
    const head = [x.speaker ? `**${x.speaker}**` : "", x.start != null ? `[${clock(x.start)}]` : ""].filter(Boolean).join(" ");
    out.push("", ...(head ? [head] : []), x.text);
  }
  return out.join("\n") + "\n";
}

/** A safe, sortable file name: "2026-09-15 Allineamento backlog.md". */
export function exportFileName(c: Pick<ExportCall, "title" | "startedAt">, taken: Set<string> = new Set()): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(c.startedAt ?? "")?.[0] ?? t("senza-data");
  const title = (c.title || "Call")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, "");
  let name = `${day} ${title || "Call"}.md`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${day} ${title || "Call"} (${n}).md`;
  taken.add(name.toLowerCase());
  return name;
}

/** The material a follow-up email may be written from: facts already extracted,
 *  never the raw transcript (the surface that leaves the PC stays minimal). */
export function followUpContext(c: ExportCall, myName: string | null): string {
  const lines: string[] = [];
  lines.push(`Call: ${c.title}${fmtDay(c.startedAt) ? `, ${fmtDay(c.startedAt)}` : ""}`);
  if (c.participants.length) lines.push(`Partecipanti: ${c.participants.join(", ")}`);
  if (myName) lines.push(`Chi scrive la mail: ${myName}`);
  if (c.summary.trim()) lines.push("", "Sintesi:", c.summary.trim());
  if (c.decisions?.length) {
    lines.push("", "Decisioni:");
    for (const d of c.decisions) lines.push(`- ${d.what}${d.figures ? ` (${d.figures})` : ""}`);
  }
  const open = c.actions.filter((a) => !a.done);
  if (open.length) {
    lines.push("", "Prossimi passi:");
    for (const a of open) lines.push(`- ${a.text}${a.assignee ? `, ${a.assignee}` : ""}${a.due ? ` (entro ${a.due})` : ""}`);
  }
  return lines.join("\n");
}
