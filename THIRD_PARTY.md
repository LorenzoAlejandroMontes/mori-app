# Third-party work

Mori stands on other people's work. Thank you.

## Design lineage

Mori's base data model (sessions, documents, transcripts, participants, action
items, see `app/src-tauri/migrations/0001_base.sql`) started as a subset of the
session model of [anarlog](https://github.com/fastrepl/anarlog) (formerly
Hyprnote), which is MIT licensed:

> MIT License. Copyright (c) 2023-present Fastrepl, Inc.

The rest of the application was written for Mori. If you recognize something
that should be credited here, please open an issue.

## Runtime components

| Component | Used for | License |
|---|---|---|
| [Tauri](https://tauri.app) and its plugins (sql, http, global-shortcut, single-instance) | desktop shell | MIT or Apache-2.0 |
| [React](https://react.dev) | interface | MIT |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | local transcription | MIT |
| [Whisper](https://github.com/openai/whisper) models | local transcription | MIT |
| [fastembed](https://github.com/qdrant/fastembed) | local embeddings | Apache-2.0 |
| [paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) | embedding model | Apache-2.0 |
| [SoundCard](https://github.com/bastibe/SoundCard) | microphone and system audio capture | BSD-3-Clause |
| [NumPy](https://numpy.org) | audio buffers | BSD-3-Clause |
| Hanken Grotesk, Instrument Serif, JetBrains Mono (via [Fontsource](https://fontsource.org)) | typography | SIL OFL 1.1 |

## Development only

| Component | Used for | License |
|---|---|---|
| [sql.js](https://github.com/sql-js/sql.js) | the in-browser preview bench | MIT |
| [axe-core](https://github.com/dequelabs/axe-core) | accessibility audit | MPL-2.0 |
| [Vite](https://vitejs.dev), [TypeScript](https://www.typescriptlang.org) | build | MIT, Apache-2.0 |

The full dependency trees, with exact versions, are in `app/pnpm-lock.yaml`,
`app/src-tauri/Cargo.lock` and `app/requirements.txt`.

## Services

Mori can talk to any OpenAI-compatible endpoint you configure (Groq, OpenAI,
OpenRouter, Ollama, LM Studio). None of them is bundled, and their own terms
apply when you use them.
