import { db, type Segment } from "./db";
import { indexSession } from "./index";
import { applyVocab, applyVocabToSegments, fixName, listTerms } from "./vocab";

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

// Pull unique speaker names from a pasted transcript ("Nome Cognome: testo").
export function parseParticipants(text: string): string[] {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([\p{Lu}][\p{L}'’.]+(?:\s+[\p{L}'’.]+){0,3})\s*:\s+\S/u);
    if (m) {
      const name = m[1].trim();
      if (name.length > 1 && !/trascrizione/i.test(name)) names.add(name);
    }
  }
  return [...names];
}

export type NewCall = { title: string; folder: string; transcript: string; sensitive?: boolean };

// Add a real call from a pasted transcript. Returns the new session id.
// `sensitive` is set in the same INSERT, before anything is queued: a private
// call must never have a moment in which a cloud model could pick it up.
export async function addCall(input: NewCall): Promise<string> {
  const d = await db();
  const id = uid();
  const t = now();

  await d.execute(
    `INSERT INTO session
       (id, title, kind, status, folder_path, language, started_at, ended_at, metadata_json, sensitive, created_at, updated_at)
     VALUES ($1, $2, 'meeting', 'done', $3, 'it', $4, $4, '{}', $5, $4, $4)`,
    [id, input.title.trim() || "Call senza titolo", input.folder.trim() || "/Inbox", t, input.sensitive ? 1 : 0],
  );

  await d.execute(
    `INSERT INTO session_transcript (id, session_id, memo, provider, model, created_at)
     VALUES ($1, $2, $3, 'import', 'import', $4)`,
    [uid(), id, input.transcript.trim(), t],
  );

  for (const name of parseParticipants(input.transcript)) {
    await d.execute(
      `INSERT INTO session_participant (id, session_id, display_name, email, role, organization)
       VALUES ($1, $2, $3, NULL, NULL, NULL)`,
      [uid(), id, name],
    );
  }

  // Index for recall in the background so the "Aggiungi" action returns at once.
  void indexSession(id).catch(() => {});
  return id;
}

// Create a recording session immediately (status 'transcribing'), so the call is
// visible the moment you stop — the transcript fills in later, in the background.
export async function addRecordingPlaceholder(title: string): Promise<string> {
  const d = await db();
  const id = uid();
  const t = now();
  await d.execute(
    `INSERT INTO session
       (id, title, kind, status, folder_path, language, started_at, ended_at, metadata_json, sensitive, created_at, updated_at)
     VALUES ($1, $2, 'meeting', 'transcribing', '/', 'it', $3, $3, '{}', 0, $3, $3)`,
    [id, title.trim() || "Registrazione", t],
  );
  return id;
}

// Fill in the transcript once background transcription finishes and mark it done.
// `segments`/`language`/`audioPath` come from parseTranscribeResult (Phase A); all
// optional so legacy callers and plain-text transcripts still work.
export async function finishRecording(
  id: string,
  transcript: string,
  segments?: Segment[],
  language?: string,
  audioPath?: string | null,
): Promise<void> {
  const d = await db();
  const t = now();
  // Post-transcription pass with the user's name dictionary: Whisper's
  // "Fondazione Aurola" becomes "Fondazione Aurora" BEFORE anything is
  // stored, so the transcript, the chunks and the entities all agree.
  await listTerms();
  const fixed = applyVocab(transcript.trim());
  const fixedSegs = segments && segments.length ? applyVocabToSegments(segments) : [];
  const segsJson = fixedSegs.length ? JSON.stringify(fixedSegs) : null;
  await d.execute(
    `INSERT INTO session_transcript (id, session_id, memo, segments_json, provider, model, created_at)
     VALUES ($1, $2, $3, $4, 'recording', 'whisper', $5)`,
    [uid(), id, fixed, segsJson, t],
  );
  for (const name of parseParticipants(fixed)) {
    await d.execute(
      `INSERT INTO session_participant (id, session_id, display_name, email, role, organization)
       VALUES ($1, $2, $3, NULL, NULL, NULL)`,
      [uid(), id, fixName(name)],
    );
  }
  await d.execute(
    `UPDATE session
        SET status = 'done', audio_path = COALESCE($1, audio_path),
            language = COALESCE($2, language), updated_at = $3
      WHERE id = $4`,
    [audioPath ?? null, language && language.trim() ? language.trim() : null, t, id],
  );

  // Index for recall now (we're already in a background task, so awaiting is
  // fine and it never touches the UI thread). An embed failure must not fail the
  // recording, which is already saved.
  try {
    await indexSession(id);
  } catch {
    /* recall index is best-effort; the transcript is safe regardless */
  }
}

// Mark a recording session as failed (keeps it visible; audio stays on disk).
export async function failRecording(id: string): Promise<void> {
  const d = await db();
  await d.execute(`UPDATE session SET status = 'failed', updated_at = $1 WHERE id = $2`, [now(), id]);
}
