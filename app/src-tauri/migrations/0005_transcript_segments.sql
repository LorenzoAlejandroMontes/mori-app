-- Phase A (#3 core): keep the audio and a timestamped, speaker-tagged transcript.
-- `session.language` already exists in the base schema, so we do NOT re-add it.
ALTER TABLE session_transcript ADD COLUMN segments_json TEXT;
ALTER TABLE session ADD COLUMN audio_path TEXT;
