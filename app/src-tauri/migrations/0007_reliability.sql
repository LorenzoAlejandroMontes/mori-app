-- Session 1 · Affidabile. Everything that makes the pipeline survive a crash,
-- a failed LLM call or a closed app: a durable job queue, a user-editable name
-- dictionary, and persisted chat threads.

-- The work queue. transcribe → organize → index used to be a promise chain in
-- App.tsx: if the app closed or the LLM failed, the work was lost and nobody
-- retried (2 real calls of 14 Sept were never organized). Now every step is a
-- row: it survives a restart, it carries its own retry count and last error.
CREATE TABLE IF NOT EXISTS job (
  id           TEXT PRIMARY KEY,
  session_id   TEXT REFERENCES session(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                      -- 'transcribe' | 'organize' | 'index'
  status       TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'running' | 'done' | 'failed'
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',         -- e.g. the WAV path, so a transcribe can re-run
  next_at      TEXT,                               -- earliest retry time (backoff)
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_status ON job(status, next_at, created_at);
-- At most ONE live job of a kind per session: enqueueing twice is a no-op, so a
-- double-click or a startup recovery can never schedule the same work twice.
CREATE UNIQUE INDEX IF NOT EXISTS ux_job_active
  ON job(session_id, kind) WHERE status IN ('pending', 'running');

-- Name dictionary. Whisper mangles recurring proper nouns ("Fondazione
-- Aurola", "Alenso"). `wrong` empty = a canonical name with nothing to correct
-- yet (still fed to Whisper as vocabulary).
CREATE TABLE IF NOT EXISTS vocab_term (
  id         TEXT PRIMARY KEY,
  wrong      TEXT NOT NULL DEFAULT '',
  correct    TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'person',       -- 'person' | 'project' | 'org' | 'term'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_vocab_wrong ON vocab_term(lower(wrong)) WHERE wrong <> '';

-- Chat with memory: threads survive a restart, so "e poi?" still has a past.
CREATE TABLE IF NOT EXISTS chat_thread (
  id         TEXT PRIMARY KEY,
  title      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_message (
  id           TEXT PRIMARY KEY,
  thread_id    TEXT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,                      -- 'user' | 'assistant'
  content      TEXT NOT NULL,
  sources_json TEXT,                               -- the Source[] shown under an answer
  is_error     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_msg ON chat_message(thread_id, created_at);

-- Marks a document Mori wrote itself. Re-organize may refresh its OWN summary
-- (source='auto') and must never touch a pre-existing one (source NULL) or a
-- user's (Rule Zero-D: auto never clobbers manual).
ALTER TABLE session_document ADD COLUMN source TEXT;
