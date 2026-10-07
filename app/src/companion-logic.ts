// La logica pura del compagno: niente database, niente Tauri, niente rete.
// Sta a parte proprio per poter essere eseguita e verificata da riga di comando
// (`node tests/companion-logic.test.ts`) invece che a occhio nell'app.

import type { PersonDossier } from "./views/people";

// --- Stop dopo un silenzio lungo --------------------------------------------

/**
 * Cosa fare a ogni giro di controllo del silenzio.
 *  - `silence`: secondi di silenzio CONTINUO letti da `<wav>.silence`. Per
 *    contratto con record.py torna a zero appena qualcuno riparla: non è un
 *    contatore che cresce sempre.
 *  - `armed`: il conto alla rovescia è già partito.
 *  - `snoozed`: l'utente ha appena detto "continua a registrare". Finché resta
 *    zitto non gli si richiede niente; la proposta torna possibile solo dopo
 *    che qualcuno ha davvero riparlato (silenzio sceso sotto la soglia) e poi
 *    si è fatto di nuovo un silenzio intero.
 *
 * "unsnooze" = qualcuno ha riparlato, si può tornare a proporre.
 */
export function silenceDecision(input: {
  silence: number;
  thresholdMin: number;
  armed: boolean;
  snoozed?: boolean;
}): "idle" | "arm" | "disarm" | "keep" | "unsnooze" {
  if (input.thresholdMin <= 0) return input.armed ? "disarm" : "idle";
  const limit = input.thresholdMin * 60;
  if (input.silence < limit) {
    if (input.armed) return "disarm";
    return input.snoozed ? "unsnooze" : "idle";
  }
  if (input.armed) return "keep";
  return input.snoozed ? "idle" : "arm";
}

// --- Brief -------------------------------------------------------------------

export type BriefSource = { id: string; title: string; date: string };

export function fmtBriefDate(iso: string | null, loc = "it-IT"): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(loc, { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * La chiave della cache: l'id della call più recente dell'entità. Finché non ne
 * arriva una nuova, il brief salvato va ancora bene e non si riscrive.
 */
export function briefCacheKey(d: PersonDossier): string | null {
  return d.calls[0]?.id ?? null;
}

/**
 * Il dossier senza niente che venga da una call privata: è quello che si può
 * mandare a un modello in cloud quando non c'è un modello locale.
 */
export function withoutPrivate(d: PersonDossier, priv: Set<string>): PersonDossier {
  if (!priv.size) return d;
  const ok = (sid: string | null | undefined) => !sid || !priv.has(sid);
  return {
    ...d,
    calls: d.calls.filter((c) => ok(c.id)),
    theyOwe: d.theyOwe.filter((x) => ok(x.sessionId)),
    iOwe: d.iOwe.filter((x) => ok(x.sessionId)),
    decisions: d.decisions.filter((x) => ok(x.sessionId)),
    memories: d.memories.filter((m) => ok(m.sessionId)),
  };
}

/** Sotto questa soglia un brief sarebbe solo aria fritta: meglio dirlo. */
export function briefWorthWriting(d: PersonDossier): boolean {
  return d.calls.length > 0 && d.theyOwe.length + d.iOwe.length + d.decisions.length + d.memories.length >= 2;
}

/** Le righe come le restituisce il modello, ripulite da trattini e vuoti. */
export function parseBriefLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((l) => l.length > 2)
    .slice(0, 6);
}

/** Il materiale che esce verso l'LLM: fatti già estratti, mai il trascritto. */
export function buildBriefContext(d: PersonDossier, today: Date = new Date()): string {
  const blocks: string[] = [];
  const who = d.entity.kind === "project" ? "il progetto" : "la persona";
  blocks.push(
    `Soggetto: ${who} "${d.entity.name}"${d.entity.aliases.length ? ` (anche: ${d.entity.aliases.join(", ")})` : ""}.`,
  );
  blocks.push(`Oggi è ${today.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })}.`);

  if (d.calls.length) {
    blocks.push(
      `Call insieme:\n${d.calls.slice(0, 8).map((c) => `- ${c.title} — ${fmtBriefDate(c.startedAt)}`).join("\n")}`,
    );
  }
  if (d.theyOwe.length) {
    blocks.push(
      `Impegni presi da ${d.entity.name}:\n${d.theyOwe
        .slice(0, 8)
        .map((c) => `- ${c.what}${c.dueRaw ? ` (entro ${c.dueRaw})` : ""} [${c.sessionTitle}]`)
        .join("\n")}`,
    );
  }
  if (d.iOwe.length) {
    blocks.push(
      `Impegni presi da te:\n${d.iOwe
        .slice(0, 8)
        .map((c) => `- ${c.what}${c.dueRaw ? ` (entro ${c.dueRaw})` : ""} [${c.sessionTitle}]`)
        .join("\n")}`,
    );
  }
  if (d.decisions.length) {
    blocks.push(
      `Decisioni prese insieme:\n${d.decisions
        .slice(0, 8)
        .map((x) => `- ${x.what}${x.figures ? ` (${x.figures})` : ""} [${x.sessionTitle}]`)
        .join("\n")}`,
    );
  }
  if (d.memories.length) {
    blocks.push(`Cosa Mori ricorda:\n${d.memories.slice(0, 10).map((m) => `- ${m.content}`).join("\n")}`);
  }
  return blocks.join("\n\n");
}

/**
 * Il modello chiude ogni riga con [Titolo della call]. Qui si separa il testo
 * dalle call citate, così i titoli diventano chip cliccabili.
 */
export function splitCitations(line: string, sources: BriefSource[]): { text: string; cited: BriefSource[] } {
  const cited: BriefSource[] = [];
  const text = line
    .replace(/\[([^\]]+)\]/g, (_m: string, inner: string) => {
      const needle = inner.trim().toLowerCase();
      const hit = sources.find(
        (s) =>
          s.title.toLowerCase() === needle ||
          s.title.toLowerCase().startsWith(needle) ||
          needle.startsWith(s.title.toLowerCase()),
      );
      if (hit && !cited.some((c) => c.id === hit.id)) cited.push(hit);
      return "";
    })
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { text, cited };
}
