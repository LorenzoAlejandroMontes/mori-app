// Invented data for the preview bench: a small product studio, "Nuvola". Every
// name, number and sentence here is fictional. Dates are relative to "now" so
// the "Oggi" page always looks like a real morning.

const DAY = 86_400_000;
const at = (daysAgo: number, h: number, m = 0) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const day = (offset: number) => {
  const d = new Date(Date.now() + offset * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const q = (s: string | null) => (s === null ? "NULL" : `'${s.replace(/'/g, "''")}'`);

type Call = {
  id: string;
  title: string;
  started: string;
  status?: string;
  sensitive?: boolean;
  people: string[];
  summary?: string;
  transcript?: string;
  segments?: { start: number; end: number; speaker: string; text: string }[];
  actions?: [string, string | null, string | null, ("open" | "done")?][];
  decisions?: [string, string | null][];
  commitments?: [string, string | null, string, string | null][]; // who, to, what, due
  entities?: [string, string][]; // kind, name
  categories?: string[];
};

const CALLS: Call[] = [
  {
    id: "c-sync",
    title: "Sync settimanale prodotto",
    started: at(0, 9, 30),
    people: ["Giulia Ferri", "Sara Conti"],
    summary: `## Di cosa si è parlato
- Lo stato del **nuovo onboarding**: design pronto, mancano i testi.
- Il crash su Android 14 segnalato da tre utenti.
- La demo per Marco di **giovedì**.

## Decisioni
- Si rilascia l'onboarding **martedì prossimo**, anche senza animazioni.
- Il crash ha la priorità su tutto il resto.

## Aperto
- Chi scrive i testi dell'onboarding?`,
    segments: [
      { start: 2.1, end: 7.8, speaker: "Tu", text: "Partiamo dall'onboarding: Giulia, a che punto siamo col design?" },
      { start: 8.4, end: 16.2, speaker: "Interlocutore", text: "Il design è chiuso, mancano solo i testi. Le animazioni le possiamo fare dopo." },
      { start: 17.0, end: 24.5, speaker: "Tu", text: "Allora rilasciamo martedì prossimo anche senza animazioni. Il crash su Android invece?" },
      { start: 25.1, end: 33.9, speaker: "Interlocutore", text: "Lo sistemo io entro domani, è un problema con i permessi delle notifiche." },
      { start: 34.6, end: 40.2, speaker: "Tu", text: "Perfetto. Io preparo la demo per Marco di giovedì." },
    ],
    actions: [
      ["Sistemare il crash su Android 14 (permessi notifiche)", "Sara", day(1)],
      ["Preparare la demo per Marco", "Tu", day(2)],
      ["Scrivere i testi dell'onboarding", null, null],
    ],
    decisions: [["Rilascio dell'onboarding martedì, anche senza animazioni", null]],
    commitments: [
      ["Sara", null, "sistemare il crash su Android entro domani", day(1)],
      ["Tu", "Marco", "preparare la demo di giovedì", day(2)],
    ],
    entities: [["person", "Giulia Ferri"], ["person", "Sara Conti"], ["project", "Onboarding"], ["person", "Marco Bellini"]],
    categories: ["Prodotto"],
  },
  {
    id: "c-pricing",
    title: "Pricing del piano annuale",
    started: at(1, 15, 0),
    people: ["Sara Conti"],
    summary: `## Di cosa si è parlato
- Il prezzo del piano annuale: tra **39 €** e **49 €**.
- Il test A/B sul paywall.

## Decisioni
- Si parte con **39 € l'anno** e un test A/B a 49 € sul 20% degli utenti.`,
    actions: [
      ["Impostare il test A/B del paywall su RevenueCat", "Tu", day(-2)],
      ["Mandare i numeri di conversione del mese", "Sara", day(-1)],
    ],
    decisions: [["Piano annuale a 39 €, test A/B a 49 € sul 20%", "39 €, 49 €, 20%"]],
    commitments: [["Sara", "Tu", "mandare i numeri di conversione del mese", day(-1)]],
    entities: [["person", "Sara Conti"], ["project", "Paywall"]],
    categories: ["Prodotto", "Business"],
  },
  {
    id: "c-kickoff",
    title: "Kickoff redesign con Marco",
    started: at(3, 11, 0),
    people: ["Marco Bellini", "Giulia Ferri"],
    summary: `## Di cosa si è parlato
- Marco vuole un'app **più semplice**: tre schermate invece di sette.
- Budget confermato: **18.000 €** per il redesign.

## Decisioni
- Prima consegna dei mockup il **15 del mese**.`,
    actions: [
      ["Mandare a Marco il preventivo firmato", "Tu", day(-3)],
      ["Condividere i mockup in Figma", "Giulia", day(6)],
    ],
    decisions: [["Budget del redesign: 18.000 €", "18.000 €"]],
    commitments: [
      ["Marco", "Tu", "mandare i contenuti delle tre schermate", day(4)],
      ["Tu", "Marco", "mandare il preventivo firmato", day(-3)],
    ],
    entities: [["person", "Marco Bellini"], ["person", "Giulia Ferri"], ["project", "Redesign Nuvola"]],
    categories: ["Clienti"],
  },
  {
    id: "c-seed",
    title: "Round seed con Davide",
    started: at(9, 18, 0),
    sensitive: true,
    people: ["Davide Russo"],
    summary: `## Di cosa si è parlato
- Le condizioni del round: valutazione e quote.

## Aperto
- Serve il parere dell'avvocato prima di rispondere.`,
    actions: [["Sentire l'avvocato sul term sheet", "Tu", day(5)]],
    entities: [["person", "Davide Russo"]],
    categories: ["Business"],
  },
  {
    id: "c-raw",
    title: "Intervista utente #4",
    started: at(2, 17, 30),
    people: ["Elena"],
    transcript:
      "Tu: Come usi l'app durante la settimana?\nElena: Soprattutto la sera, per pianificare il giorno dopo. Il promemoria del mattino lo trovo troppo presto.",
  },
  { id: "c-rec", title: "Registrazione di oggi 11:02", started: at(0, 11, 2), status: "transcribing", people: [] },
];

export function fixtureSql(): string {
  const out: string[] = [];
  // The demo calls of the first migrations: a real user has usually removed them.
  out.push(`DELETE FROM memory WHERE source_session_id IN ('s1','s2','s3','s4');`);
  out.push(`DELETE FROM session WHERE id IN ('s1','s2','s3','s4');`);
  out.push(`DELETE FROM category;`);

  const cats = new Map<string, string>();
  const ents = new Map<string, string>();
  let n = 0;
  const uid = (p: string) => `${p}-${++n}`;

  for (const c of CALLS) {
    out.push(
      `INSERT INTO session (id, title, kind, status, folder_path, language, started_at, ended_at, metadata_json, sensitive, created_at, updated_at)
       VALUES (${q(c.id)}, ${q(c.title)}, 'meeting', ${q(c.status ?? "done")}, '/', 'it', ${q(c.started)}, ${q(c.started)}, '{}', ${c.sensitive ? 1 : 0}, ${q(c.started)}, ${q(c.started)});`,
    );
    for (const p of c.people) {
      out.push(`INSERT INTO session_participant (id, session_id, display_name) VALUES (${q(uid("p"))}, ${q(c.id)}, ${q(p)});`);
    }
    if (c.status === "transcribing") continue;
    const memo =
      c.transcript ?? (c.segments ?? []).map((s) => `${s.speaker}: ${s.text}`).join("\n") ?? "";
    out.push(
      `INSERT INTO session_transcript (id, session_id, memo, segments_json, provider, model, created_at)
       VALUES (${q(uid("t"))}, ${q(c.id)}, ${q(memo || "Tu: …")}, ${q(c.segments ? JSON.stringify(c.segments) : null)}, 'recording', 'whisper', ${q(c.started)});`,
    );
    if (c.summary) {
      out.push(
        `INSERT INTO session_document (id, session_id, kind, title, body, body_format, source, created_at, updated_at)
         VALUES (${q(uid("d"))}, ${q(c.id)}, 'summary', 'Sintesi', ${q(c.summary)}, 'markdown', 'auto', ${q(c.started)}, ${q(c.started)});`,
      );
    }
    for (const [text, who, due, status] of c.actions ?? []) {
      out.push(
        `INSERT INTO session_action_item (id, session_id, text, assignee, status, due_at, created_at)
         VALUES (${q(uid("a"))}, ${q(c.id)}, ${q(text)}, ${q(who)}, ${q(status ?? "open")}, ${q(due)}, ${q(c.started)});`,
      );
    }
    for (const [what, fig] of c.decisions ?? []) {
      out.push(
        `INSERT INTO decision (id, session_id, what, figures, created_at) VALUES (${q(uid("dc"))}, ${q(c.id)}, ${q(what)}, ${q(fig)}, ${q(c.started)});`,
      );
    }
    for (const [who, to, what, due] of c.commitments ?? []) {
      out.push(
        `INSERT INTO commitment (id, session_id, who, to_whom, what, due, status, created_at)
         VALUES (${q(uid("k"))}, ${q(c.id)}, ${q(who)}, ${q(to)}, ${q(what)}, ${q(due)}, 'open', ${q(c.started)});`,
      );
    }
    for (const [kind, name] of c.entities ?? []) {
      let id = ents.get(`${kind}:${name}`);
      if (!id) {
        id = uid("e");
        ents.set(`${kind}:${name}`, id);
        out.push(`INSERT INTO entity (id, kind, name, created_at) VALUES (${q(id)}, ${q(kind)}, ${q(name)}, ${q(c.started)});`);
      }
      out.push(`INSERT INTO session_entity (session_id, entity_id) VALUES (${q(c.id)}, ${q(id)});`);
    }
    for (const name of c.categories ?? []) {
      let id = cats.get(name);
      if (!id) {
        id = uid("cat");
        cats.set(name, id);
        out.push(`INSERT INTO category (id, name, kind, source, created_at) VALUES (${q(id)}, ${q(name)}, 'theme', 'auto', ${q(c.started)});`);
      }
      out.push(
        `INSERT INTO session_category (session_id, category_id, confidence, source, created_at) VALUES (${q(c.id)}, ${q(id)}, 0.8, 'auto', ${q(c.started)});`,
      );
    }
  }

  out.push(
    `INSERT INTO memory (id, subject_type, subject_id, content, kind, confidence, status, source_session_id, created_at, updated_at)
     VALUES ('m1', 'person', 'Marco Bellini', 'Marco preferisce ricevere i materiali il lunedì mattina', 'preference', 0.8, 'active', 'c-kickoff', ${q(at(3, 11))}, ${q(at(3, 11))});`,
    `INSERT INTO memory_link (memory_id, session_id) VALUES ('m1', 'c-kickoff');`,
    `INSERT INTO companion_todo (id, text, assignee, status, due_at, created_at, updated_at)
     VALUES ('mt1', 'Rinnovare il dominio nuvola.app', 'Tu', 'open', ${q(day(0))}, ${q(at(1, 9))}, ${q(at(1, 9))});`,
    // Timestamps for "ore ascoltate".
    `INSERT INTO transcript_chunk (id, session_id, idx, start_sec, end_sec, speaker, text, created_at)
     VALUES ('ch1', 'c-sync', 0, 0, 2460, 'misto', 'onboarding crash android demo marco', ${q(at(0, 10))}),
            ('ch2', 'c-pricing', 0, 0, 1980, 'misto', 'piano annuale 39 euro test ab paywall', ${q(at(1, 16))}),
            ('ch3', 'c-kickoff', 0, 0, 3120, 'misto', 'redesign tre schermate budget 18000', ${q(at(3, 12))});`,
    // A provider, so the page shows a configured Mori (?fresh=1 skips all this).
    `INSERT INTO app_setting (key, value) VALUES ('provider', '{"baseUrl":"https://api.groq.com/openai/v1","apiKey":"gsk_preview","model":"openai/gpt-oss-120b"}');`,
    `INSERT INTO app_setting (key, value) VALUES ('companion_my_names', 'Tu, te, io, me, Luca');`,
  );

  // A conversation that already happened, with a markdown answer and citations.
  const t0 = at(0, 9, 50);
  const sources = [
    { id: "c-pricing", title: "Pricing del piano annuale", date: "ieri", start: null },
    { id: "c-sync", title: "Sync settimanale prodotto", date: "oggi", start: 17 },
  ];
  out.push(
    `INSERT INTO chat_thread (id, title, created_at, updated_at) VALUES ('th1', 'Cosa devo fare questa settimana?', ${q(t0)}, ${q(t0)});`,
    `INSERT INTO chat_message (id, thread_id, role, content, sources_json, is_error, created_at)
     VALUES ('cm1', 'th1', 'user', 'Cosa devo fare questa settimana?', NULL, 0, ${q(t0)});`,
    `INSERT INTO chat_message (id, thread_id, role, content, sources_json, is_error, created_at)
     VALUES ('cm2', 'th1', 'assistant', ${q(
       `Questa settimana hai tre cose tue, una già **in ritardo**:\n\n- **Impostare il test A/B del paywall** su RevenueCat — era per due giorni fa [Pricing del piano annuale — ieri]\n- **Preparare la demo per Marco** entro giovedì [Sync settimanale prodotto — oggi]\n- Rinnovare il dominio, che hai aggiunto tu: scade **oggi**.\n\nIn più aspetti da Sara i numeri di conversione del mese.`,
     )}, ${q(JSON.stringify(sources))}, 0, ${q(t0)});`,
  );

  return out.join("\n");
}
