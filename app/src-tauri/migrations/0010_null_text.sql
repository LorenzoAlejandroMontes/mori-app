-- A model sometimes answers the string "null" instead of JSON null, and it was
-- stored as if it were a name or a date (seen in "Oggi" on 2026-10-05: an owner
-- pill reading "null"). organize.ts drops it now; this empties the rows written
-- before. Only whole-value matches, so no real name or date can be touched.
UPDATE session_action_item SET assignee = NULL
 WHERE lower(trim(assignee)) IN ('', 'null', 'none', 'nil', 'undefined', 'n/a', 'nessuno', 'nessuna', '-');
UPDATE session_action_item SET due_at = NULL
 WHERE lower(trim(due_at)) IN ('', 'null', 'none', 'n/a', 'nessuna', '-');
UPDATE companion_todo SET assignee = NULL
 WHERE lower(trim(assignee)) IN ('', 'null', 'none', 'nil', 'undefined', 'n/a', 'nessuno', 'nessuna', '-');
UPDATE companion_todo SET due_at = NULL
 WHERE lower(trim(due_at)) IN ('', 'null', 'none', 'n/a', 'nessuna', '-');
