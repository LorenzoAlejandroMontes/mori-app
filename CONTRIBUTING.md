# Contributing to Mori

Thanks for wanting to help. A few things keep this codebase healthy: please read them before opening a pull request.

## The rules of the house

1. **Privacy is a feature, not a setting.** Audio, transcripts and the index never leave the machine. Anything sent to a model goes through `providerFor(sensitive)` (`app/src/llm.ts`), and a private call (`session.sensitive = 1`) must never reach a non-local model. If you add a new path that sends text to an LLM, add a check for it in `scripts/checks.mjs` section 8/9.
2. **Never block the UI thread.** Every Tauri command that does real work is `async` and wraps `spawn_blocking`. A synchronous command runs on the main thread and freezes the window.
3. **Never lose a recording.** Work after "stop" goes through the durable job queue (`app/src/jobs.ts`), not a promise chain. Audio is never deleted on failure.
4. **Auto never clobbers manual.** What the user typed (titles, categories, a summary they edited) is never overwritten by Mori's automatic passes.
5. **Migrations only add.** Never edit a migration that has shipped: SQLite checks its checksum and Mori would refuse to start on existing databases. Add a new numbered file instead.
6. **Match the code around you.** UI copy is Italian; code comments are English and explain *why*. Reuse the CSS tokens in `App.css` (both themes read them).

## Before you push

```bash
cd app
pnpm exec tsc --noEmit -p tsconfig.json
node scripts/checks.mjs
node tests/todo-logic.test.ts && node tests/companion-logic.test.ts
cd src-tauri && cargo test --locked
```

For UI changes, look at them in the preview bench (`app/preview`, see its README) in both light and dark (`?theme=dark`), and include a screenshot in the PR. The fixtures there are invented: never copy rows from a real database into the repository.

Logic worth testing goes in a pure module (no DB, no React: see `*-logic.ts`) so `checks.mjs` can run it directly.
