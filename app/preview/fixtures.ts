// Invented data for the preview bench: a small product studio, "Cloudly". Every
// name, number and sentence here is fictional. Dates are relative to "now" so
// the "Today" page always looks like a real morning.

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
    title: "Weekly product sync",
    started: at(0, 9, 30),
    people: ["Julia Ferris", "Sarah Collins"],
    summary: `## What was discussed
- The state of the **new onboarding**: design is ready, the copy is missing.
- The Android 14 crash reported by three users.
- The demo for Mark on **Thursday**.

## Decisions
- The onboarding ships **next Tuesday**, even without animations.
- The crash comes before everything else.

## Open
- Who writes the onboarding copy?`,
    segments: [
      { start: 2.1, end: 7.8, speaker: "Tu", text: "Let's start with onboarding: Julia, where are we with the design?" },
      { start: 8.4, end: 16.2, speaker: "Interlocutore", text: "The design is done, only the copy is missing. We can do the animations later." },
      { start: 17.0, end: 24.5, speaker: "Tu", text: "Then we ship next Tuesday even without animations. What about the Android crash?" },
      { start: 25.1, end: 33.9, speaker: "Interlocutore", text: "I'll fix it by tomorrow, it's a problem with notification permissions." },
      { start: 34.6, end: 40.2, speaker: "Tu", text: "Perfect. I'll prepare the demo for Mark on Thursday." },
    ],
    actions: [
      ["Fix the Android 14 crash (notification permissions)", "Sarah", day(1)],
      ["Prepare the demo for Mark", "Tu", day(2)],
      ["Write the onboarding copy", null, null],
    ],
    decisions: [["Ship the onboarding on Tuesday, even without animations", null]],
    commitments: [
      ["Sarah", null, "fix the Android crash by tomorrow", day(1)],
      ["Tu", "Mark", "prepare the Thursday demo", day(2)],
    ],
    entities: [["person", "Julia Ferris"], ["person", "Sarah Collins"], ["project", "Onboarding"], ["person", "Mark Bennett"]],
    categories: ["Product"],
  },
  {
    id: "c-pricing",
    title: "Annual plan pricing",
    started: at(1, 15, 0),
    people: ["Sarah Collins"],
    summary: `## What was discussed
- The price of the annual plan: between **$39** and **$49**.
- The A/B test on the paywall.

## Decisions
- Start at **$39 a year** and run an A/B test at $49 on 20% of users.`,
    actions: [
      ["Set up the paywall A/B test on RevenueCat", "Tu", day(-2)],
      ["Send this month's conversion numbers", "Sarah", day(-1)],
    ],
    decisions: [["Annual plan at $39, A/B test at $49 on 20%", "$39, $49, 20%"]],
    commitments: [["Sarah", "Tu", "send this month's conversion numbers", day(-1)]],
    entities: [["person", "Sarah Collins"], ["project", "Paywall"]],
    categories: ["Product", "Business"],
  },
  {
    id: "c-kickoff",
    title: "Redesign kickoff with Mark",
    started: at(3, 11, 0),
    people: ["Mark Bennett", "Julia Ferris"],
    summary: `## What was discussed
- Mark wants a **simpler** app: three screens instead of seven.
- Budget confirmed: **$18,000** for the redesign.

## Decisions
- First delivery of the mockups on the **15th of the month**.`,
    actions: [
      ["Send Mark the signed quote", "Tu", day(-3)],
      ["Share the mockups in Figma", "Julia", day(6)],
    ],
    decisions: [["Redesign budget: $18,000", "$18,000"]],
    commitments: [
      ["Mark", "Tu", "send the content for the three screens", day(4)],
      ["Tu", "Mark", "send the signed quote", day(-3)],
    ],
    entities: [["person", "Mark Bennett"], ["person", "Julia Ferris"], ["project", "Cloudly redesign"]],
    categories: ["Clients"],
  },
  {
    id: "c-seed",
    title: "Seed round with David",
    started: at(9, 18, 0),
    sensitive: true,
    people: ["David Ross"],
    summary: `## What was discussed
- The terms of the round: valuation and shares.

## Open
- We need the lawyer's opinion before answering.`,
    actions: [["Talk to the lawyer about the term sheet", "Tu", day(5)]],
    entities: [["person", "David Ross"]],
    categories: ["Business"],
  },
  {
    id: "c-raw",
    title: "User interview #4",
    started: at(2, 17, 30),
    people: ["Emma"],
    transcript:
      "Tu: How do you use the app during the week?\nEmma: Mostly in the evening, to plan the next day. I find the morning reminder too early.",
  },
  { id: "c-rec", title: "Recording of today 11:02", started: at(0, 11, 2), status: "transcribing", people: [] },
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
       VALUES (${q(c.id)}, ${q(c.title)}, 'meeting', ${q(c.status ?? "done")}, '/', 'en', ${q(c.started)}, ${q(c.started)}, '{}', ${c.sensitive ? 1 : 0}, ${q(c.started)}, ${q(c.started)});`,
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
     VALUES ('m1', 'person', 'Mark Bennett', 'Mark prefers to receive materials on Monday morning', 'preference', 0.8, 'active', 'c-kickoff', ${q(at(3, 11))}, ${q(at(3, 11))});`,
    `INSERT INTO memory_link (memory_id, session_id) VALUES ('m1', 'c-kickoff');`,
    `INSERT INTO companion_todo (id, text, assignee, status, due_at, created_at, updated_at)
     VALUES ('mt1', 'Renew the cloudly.app domain', 'Tu', 'open', ${q(day(0))}, ${q(at(1, 9))}, ${q(at(1, 9))});`,
    // Timestamps for "hours listened".
    `INSERT INTO transcript_chunk (id, session_id, idx, start_sec, end_sec, speaker, text, created_at)
     VALUES ('ch1', 'c-sync', 0, 0, 2460, 'misto', 'onboarding crash android demo marco', ${q(at(0, 10))}),
            ('ch2', 'c-pricing', 0, 0, 1980, 'misto', 'piano annuale 39 euro test ab paywall', ${q(at(1, 16))}),
            ('ch3', 'c-kickoff', 0, 0, 3120, 'misto', 'redesign tre schermate budget 18000', ${q(at(3, 12))});`,
    // A provider, so the page shows a configured Mori (?fresh=1 skips all this).
    `INSERT INTO app_setting (key, value) VALUES ('provider', '{"baseUrl":"https://api.groq.com/openai/v1","apiKey":"gsk_preview","model":"openai/gpt-oss-120b"}');`,
    `INSERT INTO app_setting (key, value) VALUES ('companion_my_names', 'Tu, te, io, me, Alex');`,
  );

  // A conversation that already happened, with a markdown answer and citations.
  const t0 = at(0, 9, 50);
  const sources = [
    { id: "c-pricing", title: "Annual plan pricing", date: "yesterday", start: null },
    { id: "c-sync", title: "Weekly product sync", date: "today", start: 17 },
  ];
  out.push(
    `INSERT INTO chat_thread (id, title, created_at, updated_at) VALUES ('th1', 'What do I need to do this week?', ${q(t0)}, ${q(t0)});`,
    `INSERT INTO chat_message (id, thread_id, role, content, sources_json, is_error, created_at)
     VALUES ('cm1', 'th1', 'user', 'What do I need to do this week?', NULL, 0, ${q(t0)});`,
    `INSERT INTO chat_message (id, thread_id, role, content, sources_json, is_error, created_at)
     VALUES ('cm2', 'th1', 'assistant', ${q(
       `You have three things of your own this week, one already **overdue**:\n\n- **Set up the paywall A/B test** on RevenueCat — it was due two days ago [Annual plan pricing — yesterday]\n- **Prepare the demo for Mark** by Thursday [Weekly product sync — today]\n- Renew the domain, which you added yourself: it expires **today**.\n\nYou are also waiting on Sarah for this month's conversion numbers.`,
     )}, ${q(JSON.stringify(sources))}, 0, ${q(t0)});`,
  );

  return out.join("\n");
}
