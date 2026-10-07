-- Mori base schema (Slice 1). Surgical subset of anarlog's session model
-- + Mori's own organization & memory tables. See project DECISIONS.md.

CREATE TABLE IF NOT EXISTS session (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'meeting',
  status        TEXT NOT NULL DEFAULT 'done',
  folder_path   TEXT NOT NULL DEFAULT '/',
  language      TEXT NOT NULL DEFAULT 'it',
  started_at    TEXT,
  ended_at      TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  sensitive     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_document (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'note',      -- 'note' | 'summary' | 'raw_memo'
  title       TEXT,
  body        TEXT NOT NULL DEFAULT '',
  body_format TEXT NOT NULL DEFAULT 'markdown',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_transcript (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  memo        TEXT NOT NULL DEFAULT '',          -- full transcript text
  provider    TEXT,
  model       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_participant (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  email         TEXT,
  role          TEXT,
  organization  TEXT
);

CREATE TABLE IF NOT EXISTS session_action_item (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  assignee     TEXT,
  status       TEXT NOT NULL DEFAULT 'open',      -- 'open' | 'done'
  due_at       TEXT,
  created_at   TEXT NOT NULL
);

-- Organization. Folders live on session.folder_path (one home per note);
-- categories/tags are the cross-cutting axis (many per note).
CREATE TABLE IF NOT EXISTS category (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT,
  kind       TEXT NOT NULL DEFAULT 'custom',      -- 'project'|'theme'|'person'|'custom'
  source     TEXT NOT NULL DEFAULT 'user',        -- 'auto'|'user'
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_category (
  session_id  TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  confidence  REAL,                               -- set for auto-tags
  source      TEXT NOT NULL DEFAULT 'user',        -- auto NEVER overwrites user
  created_at  TEXT NOT NULL,
  PRIMARY KEY (session_id, category_id)
);

-- Memory: the companion brain. Durable atomic facts, distinct from raw notes.
CREATE TABLE IF NOT EXISTS memory (
  id                TEXT PRIMARY KEY,
  subject_type      TEXT NOT NULL,                -- 'person'|'project'|'topic'|'general'
  subject_id        TEXT,
  content           TEXT NOT NULL,
  kind              TEXT NOT NULL,                -- 'fact'|'preference'|'commitment'|'open_question'
  confidence        REAL,
  status            TEXT NOT NULL DEFAULT 'active', -- 'active'|'stale'|'superseded'
  source_session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_link (
  memory_id  TEXT NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  PRIMARY KEY (memory_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_folder ON session(folder_path);
CREATE INDEX IF NOT EXISTS idx_doc_session ON session_document(session_id);
CREATE INDEX IF NOT EXISTS idx_part_session ON session_participant(session_id);
CREATE INDEX IF NOT EXISTS idx_sc_session ON session_category(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_subject ON memory(subject_type, subject_id);
