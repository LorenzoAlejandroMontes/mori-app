-- Sessione 3 · Compagno. Tre cose: il brief per persona/progetto (con la sua
-- cache), gli alias dopo un'unione di schede, e le cose da fare aggiunte a mano
-- (che non nascono da nessuna call).

-- Brief scritto dall'LLM per una persona o un progetto. Una riga per entità:
-- si rigenera solo quando arriva una call più recente di `latest_session_id`.
CREATE TABLE IF NOT EXISTS entity_brief (
  entity_id         TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  latest_session_id TEXT,                       -- la call più recente al momento della scrittura
  body              TEXT NOT NULL DEFAULT '',   -- 4-6 righe, una per riga
  sources_json      TEXT NOT NULL DEFAULT '[]', -- [{id,title,date}] per i chip sotto ogni riga
  model             TEXT,
  created_at        TEXT NOT NULL
);

-- "Sara" e "Sarah" sono la stessa persona: unendo le schede le call passano
-- sull'entità scelta e il nome vecchio resta qui, così resta ricercabile.
CREATE TABLE IF NOT EXISTS entity_alias (
  id         TEXT PRIMARY KEY,
  entity_id  TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_alias ON entity_alias(lower(alias));
CREATE INDEX IF NOT EXISTS idx_entity_alias_entity ON entity_alias(entity_id);

-- Cose da fare scritte a mano nella vista "Da fare". Non appartengono a nessuna
-- call, quindi non possono stare in session_action_item (session_id e' NOT NULL
-- e una call finta sporcherebbe lo storico).
CREATE TABLE IF NOT EXISTS companion_todo (
  id         TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  assignee   TEXT,
  status     TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'done'
  due_at     TEXT,                           -- ISO o testo libero, come le altre
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_companion_todo_status ON companion_todo(status);
