-- Phase B (#1): real recall. Chunk-level embeddings + a light entity/commitment/
-- decision graph so questions like "cosa ho promesso a X?" resolve to real facts.

CREATE TABLE IF NOT EXISTS transcript_chunk (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  start_sec REAL, end_sec REAL,
  speaker TEXT,
  text TEXT NOT NULL,
  embedding_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunk_session ON transcript_chunk(session_id);

CREATE TABLE IF NOT EXISTS entity (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,            -- person | project | org | topic
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_entity ON entity(kind, lower(name));
CREATE TABLE IF NOT EXISTS session_entity (
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  entity_id  TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, entity_id)
);
CREATE TABLE IF NOT EXISTS commitment (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  who TEXT,                      -- who committed ("Tu" or a name)
  to_whom TEXT,
  what TEXT NOT NULL,
  due TEXT,                      -- free text or ISO date
  status TEXT NOT NULL DEFAULT 'open',
  quote TEXT,                    -- verbatim snippet
  start_sec REAL,                -- position in call if known
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_commitment_session ON commitment(session_id);
CREATE TABLE IF NOT EXISTS decision (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  what TEXT NOT NULL,
  figures TEXT,                  -- numbers/amounts mentioned, free text
  quote TEXT,
  start_sec REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decision_session ON decision(session_id);
