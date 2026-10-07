-- Seed data so Slice 1 has a real call history to browse & recall over.
-- Fixed timestamps (migrations must be deterministic).

INSERT INTO category (id, name, color, kind, source, created_at) VALUES
  ('cat_mori',   'Mori',          '#2dd4bf', 'project', 'user', '2026-08-20T09:00:00Z'),
  ('cat_crew',   'North Studio',          '#818cf8', 'project', 'user', '2026-08-20T09:00:00Z'),
  ('cat_arch',   'Architecture',  '#f59e0b', 'theme',   'auto', '2026-08-20T09:00:00Z'),
  ('cat_budget', 'Budget',        '#fb7185', 'theme',   'auto', '2026-08-20T09:00:00Z'),
  ('cat_design', 'Design',        '#c084fc', 'theme',   'auto', '2026-08-20T09:00:00Z');

-- Session 1 --------------------------------------------------------------
INSERT INTO session (id, title, kind, folder_path, started_at, ended_at, created_at, updated_at) VALUES
  ('s1', 'Mori kickoff: architecture', 'meeting', '/Mori',
   '2026-08-21T10:00:00Z', '2026-08-21T10:45:00Z', '2026-08-21T10:00:00Z', '2026-08-21T10:45:00Z');
INSERT INTO session_participant (id, session_id, display_name, email, role, organization) VALUES
  ('p1a', 's1', 'Alex', 'you@example.com', 'owner', 'North Studio'),
  ('p1b', 's1', 'Emma Clark', NULL, 'engineer', 'North Studio');
INSERT INTO session_document (id, session_id, kind, title, body, created_at, updated_at) VALUES
  ('d1', 's1', 'summary', 'Summary',
   '## Decisions\n- Start from a new, clean app, with only the pieces we need.\n- Stack: Tauri v2 + Rust + React, Windows first.\n- The core (chat and recall) is already written in TypeScript.\n- Audio and index stay on the computer; the model only receives the snippets it needs.',
   '2026-08-21T10:45:00Z', '2026-08-21T10:45:00Z');
INSERT INTO session_transcript (id, session_id, memo, provider, model, created_at) VALUES
  ('t1', 's1',
   'Alex: I want a companion that helps me recall things, with an interface of its own. Emma: chat over the notes plus on-device embeddings covers almost all of recall. Let''s start from a new, clean app, not from a fork. On Windows the transcription is done by a local Whisper.',
   'seed', 'seed', '2026-08-21T10:45:00Z');
INSERT INTO session_action_item (id, session_id, text, assignee, status, due_at, created_at) VALUES
  ('a1', 's1', 'Write the dependency teardown for Slice 1', 'Emma', 'done', NULL, '2026-08-21T10:45:00Z'),
  ('a2', 's1', 'Settle the data model for categories and memory', 'Emma', 'done', NULL, '2026-08-21T10:45:00Z');
INSERT INTO session_category (session_id, category_id, confidence, source, created_at) VALUES
  ('s1', 'cat_mori', NULL, 'user', '2026-08-21T10:45:00Z'),
  ('s1', 'cat_arch', 0.94, 'auto', '2026-08-21T10:45:00Z');

-- Session 2 --------------------------------------------------------------
INSERT INTO session (id, title, kind, folder_path, started_at, ended_at, created_at, updated_at) VALUES
  ('s2', 'Call with Mark: Q3 budget', 'meeting', '/North Studio',
   '2026-08-19T15:00:00Z', '2026-08-19T15:30:00Z', '2026-08-19T15:00:00Z', '2026-08-19T15:30:00Z');
INSERT INTO session_participant (id, session_id, display_name, email, role, organization) VALUES
  ('p2a', 's2', 'Alex', 'you@example.com', 'owner', 'North Studio'),
  ('p2b', 's2', 'Mark Reed', 'mark@acme.example', 'client', 'Acme');
INSERT INTO session_document (id, session_id, kind, title, body, created_at, updated_at) VALUES
  ('d2', 's2', 'summary', 'Summary',
   '## Outcome\n- Mark confirmed the 20k budget for Q3.\n- Next check-in in mid-September.\n- He wants a written quote by Friday.',
   '2026-08-19T15:30:00Z', '2026-08-19T15:30:00Z');
INSERT INTO session_transcript (id, session_id, memo, provider, model, created_at) VALUES
  ('t2', 's2',
   'Mark: I confirm the budget, 20 thousand for the third quarter. Alex: perfect, I''ll send you the quote by Friday. Mark: let''s talk in mid-September for the check-in.',
   'seed', 'seed', '2026-08-19T15:30:00Z');
INSERT INTO session_action_item (id, session_id, text, assignee, status, due_at, created_at) VALUES
  ('a3', 's2', 'Send Mark the written quote', 'Alex', 'open', '2026-08-22T17:00:00Z', '2026-08-19T15:30:00Z');
INSERT INTO session_category (session_id, category_id, confidence, source, created_at) VALUES
  ('s2', 'cat_crew', NULL, 'user', '2026-08-19T15:30:00Z'),
  ('s2', 'cat_budget', 0.88, 'auto', '2026-08-19T15:30:00Z');

-- Session 3 --------------------------------------------------------------
INSERT INTO session (id, title, kind, folder_path, started_at, ended_at, created_at, updated_at) VALUES
  ('s3', 'Idea: the little dragon''s personality', 'note', '/Mori',
   '2026-08-22T18:00:00Z', '2026-08-22T18:20:00Z', '2026-08-22T18:00:00Z', '2026-08-22T18:20:00Z');
INSERT INTO session_participant (id, session_id, display_name, email, role, organization) VALUES
  ('p3a', 's3', 'Alex', 'you@example.com', 'owner', 'North Studio');
INSERT INTO session_document (id, session_id, kind, title, body, created_at, updated_at) VALUES
  ('d3', 's3', 'note', 'Notes',
   '## Mori, the little dragon\n- Wise, curious, warm.\n- States: waiting, thinking, exploring its memory, asleep in a meeting.\n- It needs a face of its own, not just a chat.',
   '2026-08-22T18:20:00Z', '2026-08-22T18:20:00Z');
INSERT INTO session_transcript (id, session_id, memo, provider, model, created_at) VALUES
  ('t3', 's3',
   'Voice note: Mori is a wise, warm little dragon. It can wait, think, explore its memory or fall asleep during a meeting. Personality comes second: first, software that works well.',
   'seed', 'seed', '2026-08-22T18:20:00Z');
INSERT INTO session_category (session_id, category_id, confidence, source, created_at) VALUES
  ('s3', 'cat_mori', NULL, 'user', '2026-08-22T18:20:00Z'),
  ('s3', 'cat_design', 0.91, 'auto', '2026-08-22T18:20:00Z');

-- Memory: durable facts distilled across sessions (the companion brain) ---
INSERT INTO memory (id, subject_type, subject_id, content, kind, confidence, status, source_session_id, created_at, updated_at) VALUES
  ('m1', 'person', 'Mark Reed', 'Mark (Acme) confirmed a 20k budget for Q3.', 'commitment', 0.9, 'active', 's2', '2026-08-19T15:30:00Z', '2026-08-19T15:30:00Z'),
  ('m2', 'project', 'Mori', 'Chosen approach: a new, clean app, not a fork.', 'fact', 0.95, 'active', 's1', '2026-08-21T10:45:00Z', '2026-08-21T10:45:00Z'),
  ('m3', 'person', 'Alex', 'Wants software that works well first; the little dragon''s personality comes second.', 'preference', 0.85, 'active', 's3', '2026-08-22T18:20:00Z', '2026-08-22T18:20:00Z');
INSERT INTO memory_link (memory_id, session_id) VALUES
  ('m1', 's2'), ('m2', 's1'), ('m3', 's3');
