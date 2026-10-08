// "Oggi" — the page Mori opens on. Pure logic only (no DB, no React): what to
// say, what to put first, which questions to suggest. Everything here is
// computed on this machine, no model involved, so the page costs nothing and
// shows up instantly. Run by scripts/checks.mjs.

import { bucketOf, compareTodos, type Due } from "./todo-logic";
import { t, tn, locale } from "../i18n";

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return t("Ancora sveglio?");
  if (h < 13) return t("Buongiorno");
  if (h < 18) return t("Buon pomeriggio");
  return t("Buonasera");
}

export function longDate(now: Date = new Date()): string {
  const s = now.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type HomeTodo = {
  id: string;
  text: string;
  assignee: string | null;
  due: Due;
  mine: boolean;
  status: "open" | "done";
  sessionAt: string | null;
};

/** Mine and due by the end of the week (late first), then the undated recent
 *  ones to fill up to `limit`: what deserves the first glance of the day. */
export function myFocus<T extends HomeTodo>(todos: T[], now: Date = new Date(), limit = 6): T[] {
  const open = todos.filter((t) => t.status === "open" && t.mine);
  const byDue = (a: T, b: T) =>
    compareTodos({ due: a.due, sessionAt: a.sessionAt }, { due: b.due, sessionAt: b.sessionAt });
  const urgent = open
    .filter((t) => {
      const b = bucketOf(t.due, now);
      return b === "ritardo" || b === "settimana";
    })
    .sort(byDue);
  if (urgent.length >= limit) return urgent.slice(0, limit);
  const rest = open
    .filter((t) => !urgent.includes(t) && !t.due.date)
    .sort((a, b) => (b.sessionAt ?? "").localeCompare(a.sessionAt ?? ""));
  return [...urgent, ...rest].slice(0, limit);
}

/** What others promised: dated ones first (late on top), then the rest by recency. */
export function waitingOn<T extends HomeTodo>(todos: T[], limit = 5): T[] {
  const open = todos.filter((t) => t.status === "open" && !t.mine && !!(t.assignee ?? "").trim());
  return open
    .sort((a, b) => {
      const da = a.due.date ? a.due.date.getTime() : Infinity;
      const db = b.due.date ? b.due.date.getTime() : Infinity;
      if (da !== db) return da - db;
      return (b.sessionAt ?? "").localeCompare(a.sessionAt ?? "");
    })
    .slice(0, limit);
}

export function countLate(todos: HomeTodo[], now: Date = new Date()): number {
  return todos.filter((t) => t.status === "open" && t.mine && bucketOf(t.due, now) === "ritardo").length;
}

/** Questions worth one click, built from what is actually in the archive —
 *  never the same three canned examples. */
export function suggestQuestions(input: {
  openMine: number;
  late: number;
  people: string[]; // most recent first
  projects: string[]; // most recent first
  lastCallTitle: string | null;
}): string[] {
  const out: string[] = [];
  if (input.late > 0) out.push(t("Cosa ho in ritardo e da dove viene?"));
  else if (input.openMine > 0) out.push(t("Cosa devo fare questa settimana?"));
  if (input.people[0]) out.push(t("Cosa ci siamo detti l'ultima volta con {name}?", { name: input.people[0] }));
  if (input.projects[0]) out.push(t("Cosa abbiamo deciso su {project}?", { project: input.projects[0] }));
  if (input.lastCallTitle) out.push(t("Riassumimi “{title}” in tre punti", { title: input.lastCallTitle }));
  if (input.people[1]) out.push(t("Cosa aspetto da {name}?", { name: input.people[1] }));
  if (!out.length) {
    out.push(t("Cosa sai fare, Mori?"), t("Come registro la mia prima call?"));
  }
  return out.slice(0, 4);
}

/** "3 call questa settimana · 2 ore registrate": the archive in one line. */
export function statsLine(s: { calls: number; callsThisWeek: number; minutes: number; openMine: number }): string {
  const parts: string[] = [];
  if (s.callsThisWeek > 0) parts.push(tn(s.callsThisWeek, "1 call questa settimana", "{n} call questa settimana"));
  // A new Mori has only the sample calls: no count is better than "0 calls".
  else if (s.calls > 0) parts.push(tn(s.calls, "1 call in archivio", "{n} call in archivio"));
  if (s.minutes >= 60) {
    const h = Math.floor(s.minutes / 60);
    const m = Math.round(s.minutes % 60);
    parts.push(
      m
        ? h === 1
          ? t("{h} ora e {m} min ascoltate", { h, m })
          : t("{h} ore e {m} min ascoltate", { h, m })
        : h === 1
          ? t("{h} ora ascoltate", { h })
          : t("{h} ore ascoltate", { h }),
    );
  } else if (s.minutes > 0) {
    parts.push(t("{n} min ascoltati", { n: Math.round(s.minutes) }));
  }
  if (s.openMine > 0) parts.push(tn(s.openMine, "{n} cosa aperta per te", "{n} cose aperte per te"));
  return parts.join(" · ");
}
