// Le query della scheda persona/progetto. Tutto parte da `entity` +
// `session_entity` (migrazione 0006) e dagli alias della 0008.

import { db } from "../db";
import { parseDue, type Due } from "./todo-logic";

export type Entity = {
  id: string;
  kind: string; // person | project | org | topic
  name: string;
  aliases: string[];
  calls: number;
  lastAt: string | null;
};

export type EntityCall = {
  id: string;
  title: string;
  startedAt: string | null;
  decisions: number;
  actions: number;
};

export type Debt = {
  id: string;
  what: string;
  due: Due;
  dueRaw: string | null;
  quote: string | null;
  sessionId: string;
  sessionTitle: string;
  startSec: number | null;
};

export type EntityDecision = { id: string; what: string; figures: string | null; sessionId: string; sessionTitle: string; startSec: number | null };
export type EntityMemory = { content: string; kind: string; sessionId?: string | null };

export type PersonDossier = {
  entity: Entity;
  calls: EntityCall[];
  /** Impegni presi da lui verso di me. */
  theyOwe: Debt[];
  /** Impegni presi da me nelle call che avete fatto insieme. */
  iOwe: Debt[];
  decisions: EntityDecision[];
  memories: EntityMemory[];
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Presenza a parola intera, così "Sara" non scatta dentro "Saradwijk". */
function mentions(hay: string | null | undefined, name: string): boolean {
  if (!hay) return false;
  const h = norm(hay);
  const n = norm(name);
  if (!n) return false;
  let from = 0;
  for (;;) {
    const i = h.indexOf(n, from);
    if (i === -1) return false;
    const before = i === 0 ? "" : h[i - 1];
    const after = i + n.length >= h.length ? "" : h[i + n.length];
    const letter = (c: string) => /[\p{L}\p{N}]/u.test(c);
    if (!letter(before) && !letter(after)) return true;
    from = i + n.length;
  }
}

/** Tutti i nomi con cui questa entità può comparire nelle trascrizioni. */
function allNames(e: Pick<Entity, "name" | "aliases">): string[] {
  return [e.name, ...e.aliases].map((n) => n.trim()).filter(Boolean);
}

export async function listEntities(): Promise<Entity[]> {
  const d = await db();
  const rows = await d.select<{ id: string; kind: string; name: string; calls: number; last_at: string | null }[]>(
    `SELECT e.id, e.kind, e.name,
            COUNT(se.session_id) AS calls,
            MAX(COALESCE(s.started_at, s.created_at)) AS last_at
       FROM entity e
       LEFT JOIN session_entity se ON se.entity_id = e.id
       LEFT JOIN session s ON s.id = se.session_id
      GROUP BY e.id, e.kind, e.name
      ORDER BY calls DESC, lower(e.name)`,
  );
  const aliasRows = await d.select<{ entity_id: string; alias: string }[]>(
    `SELECT entity_id, alias FROM entity_alias`,
  );
  const byId = new Map<string, string[]>();
  for (const a of aliasRows) {
    const list = byId.get(a.entity_id) ?? [];
    list.push(a.alias);
    byId.set(a.entity_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    aliases: byId.get(r.id) ?? [],
    calls: r.calls,
    lastAt: r.last_at,
  }));
}

export async function entityById(id: string): Promise<Entity | null> {
  const all = await listEntities();
  return all.find((e) => e.id === id) ?? null;
}

/** L'entità che corrisponde a un nome scritto in chiaro (partecipante, assegnatario). */
export async function entityByName(name: string): Promise<Entity | null> {
  const n = norm(name);
  if (!n) return null;
  const all = await listEntities();
  return all.find((e) => allNames(e).some((x) => norm(x) === n)) ?? null;
}

export async function dossierFor(entityId: string, myNames: string[], now: Date = new Date()): Promise<PersonDossier | null> {
  const entity = await entityById(entityId);
  if (!entity) return null;
  const d = await db();

  const calls = await d.select<{ id: string; title: string; started_at: string | null; decisions: number; actions: number }[]>(
    `SELECT s.id, s.title, s.started_at,
            (SELECT COUNT(*) FROM decision dc WHERE dc.session_id = s.id) AS decisions,
            (SELECT COUNT(*) FROM session_action_item ai WHERE ai.session_id = s.id) AS actions
       FROM session_entity se
       JOIN session s ON s.id = se.session_id
      WHERE se.entity_id = $1
      ORDER BY COALESCE(s.started_at, s.created_at) DESC`,
    [entityId],
  );

  const ids = calls.map((c) => c.id);
  const names = allNames(entity);
  const mine = new Set(myNames.map(norm));

  let theyOwe: Debt[] = [];
  let iOwe: Debt[] = [];
  let decisions: EntityDecision[] = [];

  if (ids.length) {
    const ph = ids.map((_, i) => `$${i + 1}`).join(",");
    const titleById = new Map(calls.map((c) => [c.id, c.title]));

    const commits = await d.select<
      { id: string; who: string | null; to_whom: string | null; what: string; due: string | null; quote: string | null; start_sec: number | null; session_id: string }[]
    >(
      `SELECT id, who, to_whom, what, due, quote, start_sec, session_id
         FROM commitment WHERE session_id IN (${ph}) AND status = 'open'
        ORDER BY created_at DESC`,
      ids,
    );

    const toDebt = (c: (typeof commits)[number]): Debt => ({
      id: c.id,
      what: c.what,
      due: parseDue(c.due, now),
      dueRaw: c.due,
      quote: c.quote,
      sessionId: c.session_id,
      sessionTitle: titleById.get(c.session_id) ?? "",
      startSec: c.start_sec,
    });

    for (const c of commits) {
      const who = norm(c.who ?? "");
      const isHim = names.some((n) => norm(n) === who) || names.some((n) => mentions(c.who, n));
      if (isHim) {
        theyOwe.push(toDebt(c));
        continue;
      }
      // Mio: vale se l'ho detto a lui, oppure se l'ho detto in una call che
      // avete fatto insieme e non è indirizzato a nessun altro in particolare.
      if (mine.has(who)) {
        const toSomeoneElse = !!c.to_whom && !names.some((n) => mentions(c.to_whom, n));
        if (!toSomeoneElse) iOwe.push(toDebt(c));
      }
    }

    const decRows = await d.select<{ id: string; what: string; figures: string | null; start_sec: number | null; session_id: string }[]>(
      `SELECT id, what, figures, start_sec, session_id FROM decision
        WHERE session_id IN (${ph}) ORDER BY created_at DESC`,
      ids,
    );
    decisions = decRows.map((r) => ({
      id: r.id,
      what: r.what,
      figures: r.figures,
      sessionId: r.session_id,
      sessionTitle: titleById.get(r.session_id) ?? "",
      startSec: r.start_sec,
    }));
  }

  // Memorie: quelle il cui soggetto o contenuto nomina l'entità.
  const memRows = await d.select<
    { content: string; kind: string; subject_id: string | null; source_session_id: string | null }[]
  >(`SELECT content, kind, subject_id, source_session_id FROM memory WHERE status = 'active'`);
  const memories: EntityMemory[] = memRows
    .filter((m) => names.some((n) => mentions(m.subject_id, n) || mentions(m.content, n)))
    .map((m) => ({ content: m.content, kind: m.kind, sessionId: m.source_session_id }));

  return {
    entity,
    calls: calls.map((c) => ({ id: c.id, title: c.title, startedAt: c.started_at, decisions: c.decisions, actions: c.actions })),
    theyOwe,
    iOwe,
    decisions,
    memories,
  };
}

/**
 * Unisce due schede: le call di `fromId` passano su `intoId`, il nome vecchio
 * resta come alias e la scheda vecchia sparisce. Solo su richiesta esplicita.
 */
export async function mergeEntities(fromId: string, intoId: string): Promise<void> {
  if (fromId === intoId) return;
  const d = await db();
  const [from] = await d.select<{ name: string }[]>(`SELECT name FROM entity WHERE id = $1`, [fromId]);
  const [into] = await d.select<{ id: string }[]>(`SELECT id FROM entity WHERE id = $1`, [intoId]);
  if (!from || !into) return;
  const iso = new Date().toISOString();

  // Le call della vecchia passano sulla nuova (IGNORE: potrebbero già esserci).
  await d.execute(
    `INSERT OR IGNORE INTO session_entity (session_id, entity_id)
     SELECT session_id, $1 FROM session_entity WHERE entity_id = $2`,
    [intoId, fromId],
  );
  await d.execute(`DELETE FROM session_entity WHERE entity_id = $1`, [fromId]);

  // Gli alias della vecchia, più il suo nome, diventano alias della nuova.
  await d.execute(`UPDATE OR IGNORE entity_alias SET entity_id = $1 WHERE entity_id = $2`, [intoId, fromId]);
  await d.execute(
    `INSERT OR IGNORE INTO entity_alias (id, entity_id, alias, created_at) VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), intoId, from.name, iso],
  );

  // Il brief della nuova non vale più: ora copre anche le call della vecchia.
  await d.execute(`DELETE FROM entity_brief WHERE entity_id IN ($1, $2)`, [intoId, fromId]);
  await d.execute(`DELETE FROM entity WHERE id = $1`, [fromId]);
}
