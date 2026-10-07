## What changes

<!-- One or two sentences: what a user can do now that they could not before, or what was broken. -->

## How I checked it

- [ ] `pnpm exec tsc --noEmit -p tsconfig.json`
- [ ] `node scripts/checks.mjs`
- [ ] `node tests/todo-logic.test.ts && node tests/companion-logic.test.ts`
- [ ] `cargo test --locked` (if Rust changed)
- [ ] UI change: looked at it in the preview bench, light and dark, screenshot attached

## House rules touched

<!-- Tick what applies and say how it is respected (see CONTRIBUTING.md). -->

- [ ] Sends text to a model (goes through `providerFor(sensitive)`, private calls stay local)
- [ ] Adds a Tauri command (async, off the UI thread)
- [ ] Adds a migration (new numbered file, nothing shipped was edited)
- [ ] No real names, transcripts or keys in code, tests or fixtures
