-- Which calls each chat answer drew on — not only the ones shown as sources
-- (chunks), but also the memories, to-dos and facts in its context. When the
-- model is in the cloud, answers that used a call that is private NOW are kept
-- out of the history sent back to it (DECISIONS.md, rule 3). JSON array of ids.
ALTER TABLE chat_message ADD COLUMN used_sessions_json TEXT;
