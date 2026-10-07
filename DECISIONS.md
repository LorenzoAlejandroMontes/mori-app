# Mori: founding decisions

Three decisions taken before the first line of code, because they are cheap to
take early and expensive to change once real calls are in the database. The
code refers to this file by name (`DECISIONS.md, rule 3`).

## 1. Privacy: only the minimum leaves the machine

| Data | Where it lives |
|---|---|
| Raw audio | On the device. Deleted once the transcript is saved, unless the user chooses to keep it. |
| Semantic index (embeddings) | On the device only. |
| Database | One SQLite file, `~/.mori/mori.db`. |
| Recall and understanding (LLM) | Only the relevant snippets plus the question go to the model. Never the archive. |

Rules:

1. **Minimal-surface retrieval.** Mori finds the relevant pieces locally and
   sends the model only those and the question.
2. **Providers that do not train on the data.** A free tier that trains on what
   it receives is not acceptable as a default, even if it is free.
3. **Private calls stay local.** A call marked private (`session.sensitive = 1`)
   is read only by a model running on the same machine (Ollama, LM Studio).
   With a cloud model it is excluded from recall, briefs and follow-ups. This is
   enforced in two independent places and covered by `scripts/checks.mjs`.
4. **At rest**: the operating system's disk encryption (BitLocker, FileVault,
   the phone's own storage encryption). No app-level encryption.
5. **In transit**: TLS only.

### Update, 5 October 2026: speed

Local Whisper on a laptop CPU takes 10 to 30 minutes for an hour of call. The
default is now a hosted Whisper (Groq `whisper-large-v3-turbo`, which does not
train on the audio): only the speech is sent (silence is cut locally), never
for a private call, and without a key or on any error Mori falls back to local
Whisper. "On this PC" is one click away in the settings and is respected once
chosen. This is the only exception to "audio does not leave".

Audio is no longer kept by default: it is deleted as soon as the transcript is
safely saved, never before. Who wants to replay lines keeps it on the PC or in
a folder of their choice.

## 2. Data model: categories and memory are two different things

Everything is additive to the base schema, and **automatic passes never
overwrite what the user touched**.

- **Categories** say what a call is about (many per call). Auto-tagging writes
  `source = 'auto'` with a confidence; once the user edits, `source = 'user'`
  and the automatic pass leaves it alone.
- **Memory** is the companion's brain: durable, atomic facts about people and
  projects, each linked to the call it came from (`memory`, `memory_link`).
  Superseded facts are marked, not deleted, so "a month ago you said X, now Y"
  stays answerable, and every answer can cite its call.

The schema lives in `app/src-tauri/migrations`. Migrations only add: a shipped
migration is never edited (SQLite stores its checksum and Mori would refuse to
start on existing databases).

## 3. Backups: a local SQLite file is a single point of loss

- Daily snapshots with `VACUUM INTO`, rotated.
- An optional second destination chosen by the user, ideally a folder already
  synced by OneDrive, Google Drive or Dropbox: off-machine durability without
  building a sync service.
- Markdown export of every call as the human-readable, lock-in-free copy.
- A snapshot is verified (it opens, row counts match) before an older one is
  rotated away. The last good backup is never deleted automatically.
