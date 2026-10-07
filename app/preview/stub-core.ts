// Fake @tauri-apps/api/core, /event, /window and plugin-http for the preview
// bench: the app runs in a plain browser, with the backend answering like an
// idle Mori (nothing recording, no call app in front, no local models).

const params = new URLSearchParams(location.search);
/** The transcription the bench is pretending to run, for `transcribe_progress`. */
let fakeTr: { loadUntil: number; startedAt: number; total: number } | null = null;
/** When the fake recording started (for the dead side's quiet seconds). */
const fakeRecStart = Date.now() / 1000;

const COMMANDS: Record<string, (args?: Record<string, unknown>) => unknown> = {
  get_db_url: () => "sqlite:preview",
  // ?call=1: a Meet window is in front, so "Sembra una call" shows up.
  foreground_window_title: () => (params.get("call") === "1" ? "Riunione settimanale - Google Meet" : ""),
  companion_tray_ready: () => true,
  // Recording works on the bench (nothing is captured): the UI can be looked at
  // while it records. ?silence=1 makes the recorder report a long silence, so the
  // auto-stop countdown shows up a few seconds after starting.
  start_recording: () => ({ wav: "/preview/rec.wav", stop: "/preview/rec.stop" }),
  stop_recording: () => "/preview/rec.wav",
  // Whisper "takes" two seconds, so the transcribing state is visible, and
  // returns two lines (no audio file: the bench has none).
  transcribe_file: async () => {
    // Like Whisper: a second to load the model, then 90 s of audio in ~5 s,
    // with the progress file the app polls (`transcribe_progress`).
    const total = 90;
    fakeTr = { loadUntil: Date.now() + 1000, startedAt: 0, total };
    await new Promise((r) => setTimeout(r, 1000));
    fakeTr.startedAt = Date.now();
    await new Promise((r) => setTimeout(r, Number(params.get("trms") ?? 5000)));
    fakeTr = null;
    const segments = [
      { start: 0, end: 3.2, speaker: "Tu", text: "Proviamo Mori sul banco di prova." },
      { start: 3.4, end: 6.8, speaker: "Interlocutore", text: "Funziona: si vede anche la trascrizione." },
    ];
    const text = segments.map((s) => `${s.speaker}: ${s.text}`).join("\n");
    // ?cloudfail=1: Groq refused, the local Whisper did it (the app says why).
    const cloud_error = params.get("cloudfail") === "1" ? 'cloud: HTTP 401: {"error":"Invalid API Key"}' : undefined;
    return JSON.stringify({ audio_path: null, cloud_error, result: { text, language: "it", segments } });
  },
  transcribe_progress: () => {
    if (!fakeTr) return null;
    if (!fakeTr.startedAt) return JSON.stringify({ stage: "load", done: 0, total: 0, started: 0, t: Date.now() / 1000 });
    const ms = Number(params.get("trms") ?? 5000);
    const done = Math.min(fakeTr.total, ((Date.now() - fakeTr.startedAt) / ms) * fakeTr.total);
    return JSON.stringify({ stage: "run", done, total: fakeTr.total, started: fakeTr.startedAt / 1000, t: Date.now() / 1000 });
  },
  // The two voices, live: both sides talk in turns; ?deadsys=1 → the PC's audio
  // stays silent while you talk (the "Non sento l'altra parte" warning).
  recording_levels: () => {
    const t = Date.now() / 1000;
    const dead = params.get("deadsys") === "1";
    const micOn = Math.sin(t / 2) > -0.3;
    const sysOn = !dead && Math.sin(t / 2) < 0.3;
    const quiet = dead ? Math.floor(t - fakeRecStart) : 0;
    return JSON.stringify({
      mic: micOn ? 0.05 + 0.04 * Math.abs(Math.sin(t * 3)) : 0.002,
      sys: sysOn ? 0.06 + 0.05 * Math.abs(Math.sin(t * 2.3)) : 0.001,
      mic_quiet: 0,
      sys_quiet: dead ? quiet : 0,
      errs: params.get("deadmic") === "1" ? ["mic: dispositivo scollegato"] : [],
    });
  },
  recording_silence_secs: () => (params.get("silence") === "1" ? 3600 : 0),
  backups_dir: () => "/preview/backups",
  rotate_backups: () => [],
  audio_stats: () => ({ wav_count: 0, wav_bytes: 0, flac_count: 4, flac_bytes: 61_000_000 }),
  // No ONNX here: recall degrades to lexical-only, exactly like the app does.
  embed_texts: () => {
    throw new Error("embedding non disponibile nel banco di prova");
  },
};

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const h = COMMANDS[cmd];
  return (h ? h(args) : undefined) as T;
}

export function convertFileSrc(p: string): string {
  return p;
}

// `listen` delivers a fake pill at once, chosen with
// ?pill=started|stopped|silence|status|transcribing|understanding, so every state can be looked at.
export async function listen(ev: string, cb: (e: { payload: unknown }) => void): Promise<() => void> {
  if (ev === "companion://pill") {
    const kind = new URLSearchParams(location.search).get("pill") ?? "started";
    const payloads: Record<string, unknown> = {
      started: { kind: "started", title: "Registrazione avviata", subtitle: "Tu e l'interlocutore", hint: "Ctrl+Shift+R per fermare" },
      stopped: { kind: "stopped", title: "Registrazione fermata", subtitle: "12:04 · la sto trascrivendo" },
      silence: {
        kind: "silence",
        title: "Sembra finita",
        subtitle: "8 minuti senza una parola, da nessuno dei due lati. Fermo e mando in trascrizione.",
        seconds: 37,
      },
      status: { kind: "status", phase: "recording", title: "Registro", since: Date.now() - 754_000 },
      warn: { kind: "status", phase: "recording", title: "Registro", since: Date.now() - 754_000, hint: "Non sento l'altra parte" },
      transcribing: { kind: "status", phase: "transcribing", title: "Trascrivo la call", subtitle: "42% · circa 3 min · +1 in coda", progress: 0.42 },
      understanding: { kind: "status", phase: "understanding", title: "Capisco la call", subtitle: "parte 2 di 3", progress: 0.375 },
    };
    setTimeout(() => cb({ payload: payloads[kind] ?? payloads.started }), 0);
  }
  return () => {};
}

export async function emit(_ev: string, _payload?: unknown): Promise<void> {}

export function getCurrentWindow() {
  return {
    isFocused: async () => true,
    onFocusChanged: async (_cb: unknown) => () => {},
  };
}

// llm.ts imports fetch from plugin-http. The bench answers like a model only
// where a flow needs it to be walked end to end: the chat (streamed, citing the
// first call it was given) and the follow-up email. Everything else (organize,
// brief) fails loudly, as it did, so the invented data stays as it is.
export async function fetch(_url: string, init?: { body?: string; headers?: Record<string, string> }): Promise<Response> {
  const req = JSON.parse(init?.body ?? "{}") as { stream?: boolean; messages?: { content: string }[] };
  const system = req.messages?.[0]?.content ?? "";
  if (req.stream) {
    const cite = system.match(/\n(\[[^\]\n]+ — [^\]\n]+\])\n/)?.[1] ?? "";
    const answer = `Dalle tue call: la cosa più vicina a quello che chiedi è **${cite ? cite.slice(1, cite.indexOf(" — ")) : "nessuna"}** ${cite}.`;
    const words = answer.split(/(?<= )/);
    const enc = new TextEncoder();
    const body = new ReadableStream({
      async start(ctrl) {
        for (const w of words) {
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`));
          await new Promise((r) => setTimeout(r, 25));
        }
        ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
        ctrl.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  // "Verifica" / the first step's "Collega": a key with "bad" in it is refused.
  if (system.startsWith("Rispondi solo con la parola: pronto")) {
    if (/bad/.test(init?.headers?.Authorization ?? "")) {
      return new Response('{"error":{"message":"Invalid API Key"}}', { status: 401 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "pronto" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (system.startsWith("Scrivi la mail di follow-up")) {
    const text = "Oggetto: Sync settimanale — prossimi passi\n\nCiao Giulia, ciao Sara,\n\ngrazie per la call di oggi. Riassumo quello che ci siamo detti…\n\nLuca";
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  // ?understand=1: a model that understands a call (organize), slowly, so the
  // "Capisco" line can be looked at; ?understand=429 also asks for a pause once.
  const und = params.get("understand");
  if (und && /Restituisci SOLO un JSON valido|Leggi questa PARTE/.test(system)) {
    if (und === "429" && !askedPause) {
      askedPause = true;
      return new Response("rate limit", { status: 429, headers: { "retry-after": "5" } });
    }
    await new Promise((r) => setTimeout(r, Number(params.get("undms") ?? 3000)));
    const content = /Leggi questa PARTE/.test(system)
      ? JSON.stringify({ punti: ["Un punto della call."], azioni: [] })
      : JSON.stringify({
          title: "Prova sul banco",
          summary: "## Di cosa si è parlato\n- Una prova di Mori sul banco.",
          actions: [{ text: "Riascoltare la prova", assignee: "Tu", due: null }],
          categories: [],
          memories: [],
          entities: [],
          commitments: [],
          decisions: [],
        });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "content-type": "application/json", "x-ratelimit-limit-tokens": "8000", "x-ratelimit-remaining-tokens": "6000", "x-ratelimit-reset-tokens": "7.5s" },
    });
  }
  throw new Error("nessun modello nel banco di prova");
}
let askedPause = false;
