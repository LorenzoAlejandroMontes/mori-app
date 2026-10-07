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
  // ?call=1: a Meet window is in front, so "Looks like a call" shows up.
  foreground_window_title: () => (params.get("call") === "1" ? "Weekly meeting - Google Meet" : ""),
  companion_tray_ready: () => true,
  // ?setup=1: a packaged Mori on its first launch, preparing its Python (it
  // stays on the second step so it can be looked at); ?setup=fail: it stopped.
  python_env_status: () => ({ ready: !params.get("setup"), can_prepare: true }),
  prepare_python_env: async () => {
    await new Promise((r) => setTimeout(r, 600));
    if (params.get("setup") === "fail") throw new Error("packages: exit status: 2. error: Failed to fetch");
    setupListeners.forEach((cb) => cb({ payload: { stage: "packages" } }));
    await new Promise(() => {});
  },
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
      { start: 0, end: 3.2, speaker: "Tu", text: "Let's try Mori on the preview bench." },
      { start: 3.4, end: 6.8, speaker: "Interlocutore", text: "It works: the transcript shows up too." },
    ];
    const text = segments.map((s) => `${s.speaker}: ${s.text}`).join("\n");
    // ?cloudfail=1: Groq refused, the local Whisper did it (the app says why).
    const cloud_error = params.get("cloudfail") === "1" ? 'cloud: HTTP 401: {"error":"Invalid API Key"}' : undefined;
    return JSON.stringify({ audio_path: null, cloud_error, result: { text, language: "en", segments } });
  },
  transcribe_progress: () => {
    if (!fakeTr) return null;
    if (!fakeTr.startedAt) return JSON.stringify({ stage: "load", done: 0, total: 0, started: 0, t: Date.now() / 1000 });
    const ms = Number(params.get("trms") ?? 5000);
    const done = Math.min(fakeTr.total, ((Date.now() - fakeTr.startedAt) / ms) * fakeTr.total);
    return JSON.stringify({ stage: "run", done, total: fakeTr.total, started: fakeTr.startedAt / 1000, t: Date.now() / 1000 });
  },
  // The two voices, live: both sides talk in turns; ?deadsys=1 → the PC's audio
  // stays silent while you talk (the "I can't hear the other side" warning).
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
      errs: params.get("deadmic") === "1" ? ["mic: device unplugged"] : [],
    });
  },
  recording_silence_secs: () => (params.get("silence") === "1" ? 3600 : 0),
  backups_dir: () => "/preview/backups",
  rotate_backups: () => [],
  audio_stats: () => ({ wav_count: 0, wav_bytes: 0, flac_count: 4, flac_bytes: 61_000_000 }),
  // No ONNX here: recall degrades to lexical-only, exactly like the app does.
  embed_texts: () => {
    throw new Error("embeddings are not available on the preview bench");
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
const setupListeners: ((e: { payload: unknown }) => void)[] = [];

export async function listen(ev: string, cb: (e: { payload: unknown }) => void): Promise<() => void> {
  if (ev === "setup://progress") setupListeners.push(cb);
  if (ev === "companion://pill") {
    const kind = new URLSearchParams(location.search).get("pill") ?? "started";
    const payloads: Record<string, unknown> = {
      started: { kind: "started", title: "Recording started", subtitle: "You and the other side", hint: "Ctrl+Shift+R to stop" },
      stopped: { kind: "stopped", title: "Recording stopped", subtitle: "12:04 · transcribing it now" },
      silence: {
        kind: "silence",
        title: "It seems over",
        subtitle: "8 minutes without a word, from either side. Stopping and sending it to transcription.",
        seconds: 37,
      },
      status: { kind: "status", phase: "recording", title: "Recording", since: Date.now() - 754_000 },
      warn: { kind: "status", phase: "recording", title: "Recording", since: Date.now() - 754_000, hint: "I can't hear the other side" },
      transcribing: { kind: "status", phase: "transcribing", title: "Transcribing the call", subtitle: "42% · about 3 min · +1 in the queue", progress: 0.42 },
      understanding: { kind: "status", phase: "understanding", title: "Understanding the call", subtitle: "part 2 of 3", progress: 0.375 },
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
    const cite = system.match(/\n(\[[^\]\n]+ · [^\]\n]+\])\n/)?.[1] ?? "";
    const answer = `From your calls: the closest thing to what you ask is **${cite ? cite.slice(1, cite.indexOf(" · ")) : "none"}** ${cite}.`;
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
  // The "Test" button / the first step's "Connect": a key with "bad" in it is refused. (The app's model prompts stay in Italian, so the matches below are Italian.)
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
    const text = "Subject: Weekly sync: next steps\n\nHi Julia, hi Sarah,\n\nthanks for today's call. Here is a recap of what we said…\n\nAlex";
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  // ?understand=1: a model that understands a call (organize), slowly, so the
  // "Understanding" line can be looked at; ?understand=429 also asks for a pause once.
  const und = params.get("understand");
  if (und && /Restituisci SOLO un JSON valido|Leggi questa PARTE/.test(system)) {
    if (und === "429" && !askedPause) {
      askedPause = true;
      return new Response("rate limit", { status: 429, headers: { "retry-after": "5" } });
    }
    await new Promise((r) => setTimeout(r, Number(params.get("undms") ?? 3000)));
    const content = /Leggi questa PARTE/.test(system)
      ? JSON.stringify({ punti: ["One point from the call."], azioni: [] })
      : JSON.stringify({
          title: "Bench test",
          summary: "## What was discussed\n- A test of Mori on the bench.",
          actions: [{ text: "Listen to the test again", assignee: "Tu", due: null }],
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
  throw new Error("no model on the preview bench");
}
let askedPause = false;
