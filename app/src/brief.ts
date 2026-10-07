// "L'ultima volta con X…": quattro-sei righe da leggere in venti secondi prima
// di una call, scritte dall'LLM sui fatti già estratti (impegni, decisioni,
// memorie) e non sul trascritto grezzo — la superficie che esce resta minima,
// come da DECISIONS.md.
//
// La cache sta in `entity_brief` (migrazione 0008) ed è chiavata su
// entità + id della call più recente: finché non arriva una call nuova, il
// brief non si riscrive e non costa niente.
//
// Il testo puro (contesto, pulizia delle righe, citazioni) sta in
// companion-logic.ts, che gira anche fuori dall'app per poter essere verificato.

import { db, privateSessionIds } from "./db";
import { answerLanguageNote, locale, t } from "./i18n";
import { chatComplete, isLocalProvider, providerFor } from "./llm";
import type { PersonDossier } from "./views/people";
import {
  briefCacheKey,
  briefWorthWriting,
  buildBriefContext,
  fmtBriefDate,
  parseBriefLines,
  withoutPrivate,
  type BriefSource,
} from "./companion-logic";

export { briefCacheKey, briefWorthWriting, buildBriefContext, parseBriefLines, splitCitations } from "./companion-logic";
export type { BriefSource } from "./companion-logic";

export type Brief = {
  /** Una riga per elemento, nell'ordine in cui vanno lette. */
  lines: string[];
  sources: BriefSource[];
  /** Quando è stato scritto (ISO). */
  createdAt: string;
  /** La call più recente che il brief copre. */
  latestSessionId: string | null;
};

const SYSTEM = `Sei Mori, il compagno di lavoro di chi ti parla. Prepari in poche righe chi sta per rientrare in call con una persona o riprendere un progetto.
Regole:
- Italiano semplice, da collega. Dai del tu.
- Da 4 a 6 righe, una frase per riga, nessun elenco puntato, nessun titolo.
- Usa SOLO i fatti qui sotto. Non inventare nomi, date o numeri.
- La prima riga dice com'è finita l'ultima volta, con la data.
- Poi: cosa è rimasto in sospeso da una parte e dall'altra, e cosa conviene chiedere.
- Chiudi ogni riga con la fonte tra parentesi quadre, es. [Kickoff sito nuovo].
- Se i fatti sono pochi, scrivi meno righe invece di allungare il brodo.`;

export async function readCachedBrief(entityId: string): Promise<Brief | null> {
  const d = await db();
  const rows = await d.select<
    { latest_session_id: string | null; body: string; sources_json: string; created_at: string }[]
  >(`SELECT latest_session_id, body, sources_json, created_at FROM entity_brief WHERE entity_id = $1`, [entityId]);
  const row = rows[0];
  if (!row || !row.body.trim()) return null;
  let sources: BriefSource[] = [];
  try {
    const parsed = JSON.parse(row.sources_json);
    if (Array.isArray(parsed)) sources = parsed as BriefSource[];
  } catch {
    /* fonti illeggibili: il brief resta valido lo stesso */
  }
  return {
    lines: row.body.split("\n").filter(Boolean),
    sources,
    createdAt: row.created_at,
    latestSessionId: row.latest_session_id,
  };
}

async function writeCachedBrief(entityId: string, brief: Brief, model: string): Promise<void> {
  const d = await db();
  await d.execute(
    `INSERT INTO entity_brief (entity_id, latest_session_id, body, sources_json, model, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(entity_id) DO UPDATE SET
       latest_session_id = $2, body = $3, sources_json = $4, model = $5, created_at = $6`,
    [entityId, brief.latestSessionId, brief.lines.join("\n"), JSON.stringify(brief.sources), model, brief.createdAt],
  );
}

export type BriefResult =
  | { state: "ok"; brief: Brief; fresh: boolean }
  | { state: "thin" } // troppo poco materiale per dire qualcosa
  | { state: "nokey" } // manca la chiave del provider
  | { state: "error"; message: string };

/**
 * Il brief per un'entità. Riusa la cache se copre già la call più recente;
 * `force` la ignora (bottone "Rigenera").
 */
export async function getBrief(dossier: PersonDossier, force = false): Promise<BriefResult> {
  const key = briefCacheKey(dossier);

  if (!force) {
    const cached = await readCachedBrief(dossier.entity.id);
    if (cached && cached.latestSessionId === key) return { state: "ok", brief: cached, fresh: false };
  }
  if (!briefWorthWriting(dossier)) return { state: "thin" };

  // Call private (DECISIONS.md, regola 3). Il dossier può toccarle anche da
  // dove non si vede: una memoria nata in una call privata che nomina la
  // persona, anche se quella call non è tra le sue. Regola semplice e senza
  // eccezioni: tutto ciò che va a un modello NON locale passa da withoutPrivate.
  const priv = await privateSessionIds();
  const clean = withoutPrivate(dossier, priv);
  const touchesPrivate = JSON.stringify(clean) !== JSON.stringify(dossier);
  const cfg = providerFor(touchesPrivate) ?? providerFor(false);
  if (!cfg) return { state: "nokey" };
  const material = isLocalProvider(cfg) ? dossier : clean;
  if (!briefWorthWriting(material)) return { state: "thin" };

  try {
    const answer = await chatComplete(
      [
        { role: "system", content: SYSTEM + answerLanguageNote() },
        { role: "user", content: buildBriefContext(material) },
      ],
      cfg,
    );
    const lines = parseBriefLines(answer);
    if (!lines.length) return { state: "error", message: t("il modello non ha scritto niente") };
    const brief: Brief = {
      lines,
      sources: material.calls.slice(0, 6).map((c) => ({ id: c.id, title: c.title, date: fmtBriefDate(c.startedAt, locale()) })),
      createdAt: new Date().toISOString(),
      latestSessionId: key,
    };
    await writeCachedBrief(dossier.entity.id, brief, cfg.model);
    return { state: "ok", brief, fresh: true };
  } catch (e) {
    return { state: "error", message: String(e) };
  }
}
