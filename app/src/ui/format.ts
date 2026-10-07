// Small formatting helpers shared by the views. Pure: no React, no database.
import type { Session } from "../db";
import type { Due } from "../views/todo-logic";
import { t, lang, locale } from "../i18n";

export function fmtClock(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(locale(), { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * "sabato 4 ottobre 2026": without it "cosa devo fare questa settimana?" had no "now".
 * Stays Italian on purpose: it goes into the (Italian) system prompt, not the UI.
 */
export function todayLong(): string {
  return new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case "commitment": return t("impegno");
    case "preference": return t("preferenza");
    case "open_question": return t("domanda aperta");
    default: return t("fatto");
  }
}

// Group a session list into time buckets (Notion-style) so a long history stays
// scannable. Order is fixed; empty buckets are dropped. The Italian names are
// the internal keys; `label` is what is shown, in the current language.
export function groupByTime(list: Session[]): { label: string; items: Session[] }[] {
  const order = ["Oggi", "Ieri", "Ultimi 7 giorni", "Questo mese", "Prima"];
  const groups: Record<string, Session[]> = { Oggi: [], Ieri: [], "Ultimi 7 giorni": [], "Questo mese": [], Prima: [] };
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const day = 86_400_000;
  for (const s of list) {
    const t = s.started_at ? new Date(s.started_at).getTime() : 0;
    let key: string;
    if (!t) key = "Prima";
    else {
      const d0 = startOfDay(new Date(t));
      const dt = new Date(t);
      if (d0 === today) key = "Oggi";
      else if (d0 === today - day) key = "Ieri";
      else if (d0 > today - 7 * day) key = "Ultimi 7 giorni";
      else if (dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear()) key = "Questo mese";
      else key = "Prima";
    }
    groups[key].push(s);
  }
  return order.filter((k) => groups[k].length).map((k) => ({ label: timeLabel(k), items: groups[k] }));
}

function timeLabel(key: string): string {
  switch (key) {
    case "Oggi": return t("Oggi");
    case "Ieri": return t("Ieri");
    case "Ultimi 7 giorni": return t("Ultimi 7 giorni");
    case "Questo mese": return t("Questo mese");
    default: return t("Prima");
  }
}

/**
 * What a due-date chip shows. todo-logic stays Italian (it is pure and tested
 * as such), so in Italian this is its label as is; in English a date it could
 * read is written again in the current locale. Text it could not read is the
 * user's own words: shown untouched.
 */
export function dueLabel(due: Due): string {
  if (lang() === "it" || !due.date) return due.label;
  if (due.kind === "approx") {
    return "~ " + due.date.toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" });
  }
  return due.date.toLocaleDateString(locale(), { day: "numeric", month: "short" });
}

/** Clipboard with a fallback for webviews that refuse the async API. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* fall back below */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error(t("gli appunti non sono disponibili"));
}
