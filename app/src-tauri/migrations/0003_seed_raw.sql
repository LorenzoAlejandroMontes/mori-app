-- A RAW, unprocessed call: transcript only, no summary/categories/memory.
-- This is what a freshly-recorded call looks like before Mori understands it.
-- Idempotent (fixed ids + INSERT OR IGNORE).

INSERT OR IGNORE INTO session (id, title, kind, folder_path, started_at, ended_at, created_at, updated_at) VALUES
  ('s4', 'Sync settimanale — priorità', 'meeting', '/Studio Nord',
   '2026-08-23T09:00:00Z', '2026-08-23T09:25:00Z', '2026-08-23T09:00:00Z', '2026-08-23T09:25:00Z');

INSERT OR IGNORE INTO session_participant (id, session_id, display_name, email, role, organization) VALUES
  ('p4a', 's4', 'Luca', 'you@example.com', 'owner', 'Studio Nord'),
  ('p4b', 's4', 'Giulia', 'giulia@studionord.example', 'designer', 'Studio Nord');

INSERT OR IGNORE INTO session_transcript (id, session_id, memo, provider, model, created_at) VALUES
  ('t4', 's4',
   'Giulia: questa settimana la priorità numero uno è chiudere il nuovo onboarding. Luca: d''accordo. Poi dobbiamo decidere il prezzo del piano annuale. Giulia: io partirei da 39 euro l''anno. Luca: ci penso, ma decidiamo entro mercoledì. Giulia: e ricordati che il logo nuovo è ancora da approvare, lo aspetta il team marketing. Luca: ok, lo guardo io stasera.',
   'seed', 'seed', '2026-08-23T09:25:00Z');
