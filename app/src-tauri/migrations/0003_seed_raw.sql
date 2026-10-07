-- A RAW, unprocessed call: transcript only, no summary/categories/memory.
-- This is what a freshly-recorded call looks like before Mori understands it.
-- Idempotent (fixed ids + INSERT OR IGNORE).

INSERT OR IGNORE INTO session (id, title, kind, folder_path, started_at, ended_at, created_at, updated_at) VALUES
  ('s4', 'Weekly sync: priorities', 'meeting', '/North Studio',
   '2026-08-23T09:00:00Z', '2026-08-23T09:25:00Z', '2026-08-23T09:00:00Z', '2026-08-23T09:25:00Z');

INSERT OR IGNORE INTO session_participant (id, session_id, display_name, email, role, organization) VALUES
  ('p4a', 's4', 'Alex', 'you@example.com', 'owner', 'North Studio'),
  ('p4b', 's4', 'Julia', 'julia@northstudio.example', 'designer', 'North Studio');

INSERT OR IGNORE INTO session_transcript (id, session_id, memo, provider, model, created_at) VALUES
  ('t4', 's4',
   'Julia: this week the number one priority is finishing the new onboarding. Alex: agreed. Then we need to decide the price of the annual plan. Julia: I would start at 39 dollars a year. Alex: let me think about it, but we decide by Wednesday. Julia: and remember the new logo still needs your approval, the marketing team is waiting for it. Alex: ok, I''ll look at it tonight.',
   'seed', 'seed', '2026-08-23T09:25:00Z');
