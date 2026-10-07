-- Seed data so Slice 1 has a real call history to browse & recall over.
-- Fixed timestamps (migrations must be deterministic).

INSERT INTO category (id, name, color, kind, source, created_at) VALUES
  ('cat_mori',   'Mori',          '#2dd4bf', 'project', 'user', '2026-08-20T09:00:00Z'),
  ('cat_crew',   'Studio Nord',          '#818cf8', 'project', 'user', '2026-08-20T09:00:00Z'),
  ('cat_arch',   'Architettura',  '#f59e0b', 'theme',   'auto', '2026-08-20T09:00:00Z'),
  ('cat_budget', 'Budget',        '#fb7185', 'theme',   'auto', '2026-08-20T09:00:00Z'),
  ('cat_design', 'Design',        '#c084fc', 'theme',   'auto', '2026-08-20T09:00:00Z');

-- Session 1 --------------------------------------------------------------
INSERT INTO session (id, title, kind, folder_path, started_at, ended_at, created_at, updated_at) VALUES
  ('s1', 'Kickoff Mori — architettura', 'meeting', '/Mori',
   '2026-08-21T10:00:00Z', '2026-08-21T10:45:00Z', '2026-08-21T10:00:00Z', '2026-08-21T10:45:00Z');
INSERT INTO session_participant (id, session_id, display_name, email, role, organization) VALUES
  ('p1a', 's1', 'Luca', 'you@example.com', 'owner', 'Studio Nord'),
  ('p1b', 's1', 'Elena Conti', NULL, 'engineer', 'Studio Nord');
INSERT INTO session_document (id, session_id, kind, title, body, created_at, updated_at) VALUES
  ('d1', 's1', 'summary', 'Sintesi',
   '## Decisioni\n- Base = app nuova e pulita, solo i pezzi che servono.\n- Stack: Tauri v2 + Rust + React, target Windows.\n- Il cuore (chat/recall) è già scritto in TypeScript.\n- Privacy: audio e indice restano locali; al modello escono solo gli snippet.',
   '2026-08-21T10:45:00Z', '2026-08-21T10:45:00Z');
INSERT INTO session_transcript (id, session_id, memo, provider, model, created_at) VALUES
  ('t1', 's1',
   'Luca: vorrei un companion che mi aiuti al richiamo, con una sua interfaccia. Elena: chat con le note ed embedding sul dispositivo coprono quasi tutto il richiamo. Partiamo da un''app nuova e pulita, non da un fork. Su Windows la trascrizione la fa Whisper locale.',
   'seed', 'seed', '2026-08-21T10:45:00Z');
INSERT INTO session_action_item (id, session_id, text, assignee, status, due_at, created_at) VALUES
  ('a1', 's1', 'Scrivere il teardown di dipendenze dello Slice 1', 'Elena', 'done', NULL, '2026-08-21T10:45:00Z'),
  ('a2', 's1', 'Fissare modello dati categorie + memoria', 'Elena', 'done', NULL, '2026-08-21T10:45:00Z');
INSERT INTO session_category (session_id, category_id, confidence, source, created_at) VALUES
  ('s1', 'cat_mori', NULL, 'user', '2026-08-21T10:45:00Z'),
  ('s1', 'cat_arch', 0.94, 'auto', '2026-08-21T10:45:00Z');

-- Session 2 --------------------------------------------------------------
INSERT INTO session (id, title, kind, folder_path, started_at, ended_at, created_at, updated_at) VALUES
  ('s2', 'Call con Marco — budget Q3', 'meeting', '/Studio Nord',
   '2026-08-19T15:00:00Z', '2026-08-19T15:30:00Z', '2026-08-19T15:00:00Z', '2026-08-19T15:30:00Z');
INSERT INTO session_participant (id, session_id, display_name, email, role, organization) VALUES
  ('p2a', 's2', 'Luca', 'you@example.com', 'owner', 'Studio Nord'),
  ('p2b', 's2', 'Marco Rossi', 'marco@acme.example', 'client', 'Acme');
INSERT INTO session_document (id, session_id, kind, title, body, created_at, updated_at) VALUES
  ('d2', 's2', 'summary', 'Sintesi',
   '## Esito\n- Marco ha confermato il budget di 20k per il Q3.\n- Prossimo check a metà settembre.\n- Chiede un preventivo scritto entro venerdì.',
   '2026-08-19T15:30:00Z', '2026-08-19T15:30:00Z');
INSERT INTO session_transcript (id, session_id, memo, provider, model, created_at) VALUES
  ('t2', 's2',
   'Marco: confermo il budget, 20 mila per il terzo trimestre. Luca: perfetto, ti mando il preventivo entro venerdì. Marco: ci sentiamo a metà settembre per il check.',
   'seed', 'seed', '2026-08-19T15:30:00Z');
INSERT INTO session_action_item (id, session_id, text, assignee, status, due_at, created_at) VALUES
  ('a3', 's2', 'Inviare preventivo scritto a Marco', 'Luca', 'open', '2026-08-22T17:00:00Z', '2026-08-19T15:30:00Z');
INSERT INTO session_category (session_id, category_id, confidence, source, created_at) VALUES
  ('s2', 'cat_crew', NULL, 'user', '2026-08-19T15:30:00Z'),
  ('s2', 'cat_budget', 0.88, 'auto', '2026-08-19T15:30:00Z');

-- Session 3 --------------------------------------------------------------
INSERT INTO session (id, title, kind, folder_path, started_at, ended_at, created_at, updated_at) VALUES
  ('s3', 'Idea: personalità del draghetto', 'note', '/Mori',
   '2026-08-22T18:00:00Z', '2026-08-22T18:20:00Z', '2026-08-22T18:00:00Z', '2026-08-22T18:20:00Z');
INSERT INTO session_participant (id, session_id, display_name, email, role, organization) VALUES
  ('p3a', 's3', 'Luca', 'you@example.com', 'owner', 'Studio Nord');
INSERT INTO session_document (id, session_id, kind, title, body, created_at, updated_at) VALUES
  ('d3', 's3', 'note', 'Appunti',
   '## Mori, il draghetto\n- Saggio, curioso, affettuoso.\n- Stati: aspetta, pensa, esplora la memoria, dorme in riunione.\n- Deve avere una sua faccia, non essere solo una chat.',
   '2026-08-22T18:20:00Z', '2026-08-22T18:20:00Z');
INSERT INTO session_transcript (id, session_id, memo, provider, model, created_at) VALUES
  ('t3', 's3',
   'Nota vocale: Mori è un draghetto saggio e affettuoso. Può aspettare, pensare, esplorare la sua memoria o addormentarsi durante una riunione. La personalità è secondaria, prima viene un software che funziona bene.',
   'seed', 'seed', '2026-08-22T18:20:00Z');
INSERT INTO session_category (session_id, category_id, confidence, source, created_at) VALUES
  ('s3', 'cat_mori', NULL, 'user', '2026-08-22T18:20:00Z'),
  ('s3', 'cat_design', 0.91, 'auto', '2026-08-22T18:20:00Z');

-- Memory: durable facts distilled across sessions (the companion brain) ---
INSERT INTO memory (id, subject_type, subject_id, content, kind, confidence, status, source_session_id, created_at, updated_at) VALUES
  ('m1', 'person', 'Marco Rossi', 'Marco (Acme) ha confermato un budget di 20k per il Q3.', 'commitment', 0.9, 'active', 's2', '2026-08-19T15:30:00Z', '2026-08-19T15:30:00Z'),
  ('m2', 'project', 'Mori', 'Approccio scelto: app nuova e pulita, non un fork.', 'fact', 0.95, 'active', 's1', '2026-08-21T10:45:00Z', '2026-08-21T10:45:00Z'),
  ('m3', 'person', 'Luca', 'Preferisce prima un software che funziona bene; la personalità del draghetto è secondaria.', 'preference', 0.85, 'active', 's3', '2026-08-22T18:20:00Z', '2026-08-22T18:20:00Z');
INSERT INTO memory_link (memory_id, session_id) VALUES
  ('m1', 's2'), ('m2', 's1'), ('m3', 's3');
