// Pure logic behind the "Da fare" view: reading a due date that may be an ISO
// string OR free Italian text ("giovedì", "domani mattina", "prossima
// settimana"), sorting it into a time bucket, and deciding whether a row is
// mine or someone else's. No imports — so it can be run directly by
// `node tests/todo-logic.test.ts` without a bundler.

export type DueKind = "none" | "exact" | "approx" | "unknown";

export type Due = {
  kind: DueKind;
  /** Resolved calendar day (local midnight) when we could read one. */
  date: Date | null;
  /** What the row shows: "24 set", "~ gio 24 set", or the raw text. */
  label: string;
  /** Whatever was stored, for the tooltip. */
  raw: string | null;
};

export type Bucket = "ritardo" | "settimana" | "avanti" | "senzadata";

export const BUCKET_LABELS: Record<Bucket, string> = {
  ritardo: "In ritardo",
  settimana: "Questa settimana",
  avanti: "Più avanti",
  senzadata: "Senza data",
};

const MONTHS_SHORT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const DAYS_SHORT = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

// lunedì = 1 … domenica = 7 (ISO), matched without accents so "lunedi" works too.
const WEEKDAYS: Record<string, number> = {
  lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6, domenica: 0,
};

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Lowercase, strip accents and punctuation — "Giovedì," and "giovedi" match. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,;:!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fmtDay(d: Date, withWeekday = false): string {
  const day = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return withWeekday ? `${DAYS_SHORT[d.getDay()]} ${day}` : day;
}

/**
 * Read a stored due value. Handles, in order:
 *   - null / empty            → none
 *   - ISO or yyyy-mm-dd       → exact
 *   - dd/mm(/yyyy)            → exact
 *   - Italian relative words  → approx (shown with a "~")
 *   - anything else           → unknown (raw text kept, sorts with "senza data")
 */
export function parseDue(raw: string | null | undefined, now: Date = new Date()): Due {
  const s = (raw ?? "").trim();
  // "null" as text: a model answer stored before organize learnt to drop it.
  if (!s || /^(null|none|-)$/i.test(s)) return { kind: "none", date: null, label: "", raw: null };

  // ISO date or datetime.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!isNaN(d.getTime())) return { kind: "exact", date: d, label: fmtDay(d), raw: s };
  }

  // 12/09 or 12/09/2026 (day first, as written in Italian).
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (dmy) {
    const year = dmy[3] ? (dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])) : now.getFullYear();
    const d = new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
    if (!isNaN(d.getTime())) return { kind: "exact", date: d, label: fmtDay(d), raw: s };
  }

  const n = norm(s);
  const approx = (d: Date): Due => ({ kind: "approx", date: d, label: `~ ${fmtDay(d, true)}`, raw: s });

  if (/\boggi\b|\bstasera\b|\bstamattina\b|\bin giornata\b/.test(n)) return approx(startOfDay(now));
  if (/\bdopodomani\b/.test(n)) return approx(addDays(now, 2));
  if (/\bdomani\b/.test(n)) return approx(addDays(now, 1));
  if (/\bprossima settimana\b|\bsettimana prossima\b/.test(n)) return approx(nextMonday(now));
  if (/\bquesta settimana\b|\bentro la settimana\b|\bfine settimana\b/.test(n)) return approx(endOfWeek(now));
  if (/\bfine mese\b|\bentro il mese\b/.test(n)) {
    return approx(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }

  // A weekday name → its next occurrence, 1–7 days out ("giovedì" said on a
  // Monday means this Thursday; said on a Thursday it means the next one).
  for (const [word, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${word}\\b`).test(n)) {
      const delta = ((dow - now.getDay() + 7) % 7) || 7;
      return approx(addDays(now, delta));
    }
  }

  return { kind: "unknown", date: null, label: s, raw: s };
}

function nextMonday(now: Date): Date {
  const delta = ((1 - now.getDay() + 7) % 7) || 7;
  return addDays(now, delta);
}

function endOfWeek(now: Date): Date {
  const delta = (7 - now.getDay()) % 7; // Sunday closes the week
  return addDays(now, delta);
}

/**
 * Which section a row belongs to. "Questa settimana" is the next 7 days
 * inclusive, so the bucket never goes empty just because it's Friday.
 */
export function bucketOf(due: Due, now: Date = new Date()): Bucket {
  if (!due.date) return "senzadata";
  const today = startOfDay(now).getTime();
  const t = startOfDay(due.date).getTime();
  if (t < today) return "ritardo";
  if (t <= addDays(now, 7).getTime()) return "settimana";
  return "avanti";
}

export const BUCKET_ORDER: Bucket[] = ["ritardo", "settimana", "avanti", "senzadata"];

// --- Mine vs theirs ---------------------------------------------------------

// How the transcript names the user before they tell Mori their name: "Tu" is
// the mic channel. Their own name is added in Settings (and "Oggi" asks for it).
export const DEFAULT_MY_NAMES = ["Tu", "te", "io", "me"];

export function parseMyNames(stored: string | null | undefined): string[] {
  const list = (stored ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return list.length ? list : DEFAULT_MY_NAMES;
}

function nameSet(names: string[]): Set<string> {
  return new Set(names.map((n) => norm(n)));
}

/** Words worth comparing when matching an action to one of my commitments. */
function keyTokens(s: string): Set<string> {
  return new Set(
    norm(s)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3),
  );
}

/**
 * Read an assignee, from the model or from the DB. Models sometimes answer the
 * string "null" instead of JSON null (seen live on "Definizione pagine e
 * sprint"): that is nobody, not a person called null.
 */
export function cleanAssignee(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s || /^(null|none|nil|undefined|n\/a|nessuno|nessuna|[-–—])$/i.test(s)) return null;
  return s;
}

export type MineInput = {
  assignee: string | null;
  text: string;
  /** Open commitments from the same call: who committed, and to what. */
  commitments: { who: string | null; what: string }[];
};

/**
 * A row is mine when it is assigned to one of my names, or — when nobody is
 * named — when the same call holds a commitment *I* made that says the same
 * thing (at least two shared significant words).
 */
export function isMine(input: MineInput, myNames: string[] = DEFAULT_MY_NAMES): boolean {
  const mine = nameSet(myNames);
  const a = cleanAssignee(input.assignee);
  if (a) {
    // "Sarah, Andrew" is a list: mine if any part is me.
    return a.split(/[,/&]| e /).some((part) => mine.has(norm(part)));
  }
  const want = keyTokens(input.text);
  for (const c of input.commitments) {
    if (!mine.has(norm(c.who ?? ""))) continue;
    let shared = 0;
    for (const t of keyTokens(c.what)) if (want.has(t)) shared++;
    if (shared >= 2) return true;
  }
  return false;
}

// --- Sorting ----------------------------------------------------------------

/** Within a bucket: earliest first, undated last, then by call date desc. */
export function compareTodos(
  a: { due: Due; sessionAt: string | null },
  b: { due: Due; sessionAt: string | null },
): number {
  const ta = a.due.date ? a.due.date.getTime() : Infinity;
  const tb = b.due.date ? b.due.date.getTime() : Infinity;
  if (ta !== tb) return ta - tb;
  return (b.sessionAt ?? "").localeCompare(a.sessionAt ?? "");
}
