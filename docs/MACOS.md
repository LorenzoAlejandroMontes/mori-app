# Mori on macOS

Status: **in progress, looking for help.** Mori is used every day on Windows.
On a Mac the app compiles, passes its tests and comes out of CI as a `.dmg`
for Apple Silicon ([workflow](../.github/workflows/macos-app.yml)). On every
change a GitHub Mac takes the app out of that `.dmg`, opens it, starts a
recording with the global shortcut, plays a known sentence and checks that
Mori's "others" channel contains it, transcribed. What is missing: a release
to download it from, a signature macOS trusts, and the look and wording of a
Mac app. This page is the plan. The research behind it, with sources for every
claim, is in [`research/macos.md`](research/macos.md).

The maintainer has no Mac. Milestones marked **CI** can be proven by GitHub
Actions alone; the ones marked **Mac** need someone to run a build and report
what they see. If you have a Mac, that is the most useful thing you can do.

## The one hard piece: hearing the other side

On Windows Mori records the computer's audio through WASAPI loopback, on its
own channel, so the transcript knows who said what. The Python library it uses
has no loopback on macOS.

A small helper, [`mori-sysaudio`](../app/native/mori-sysaudio/main.swift), uses
**Core Audio process taps** (macOS 14.2+) and hands the audio to the existing
recorder. A tap asks for the "system audio" permission only: no Screen
Recording prompt. The two largest open-source recorders on macOS (anarlog and
Meetily, both MIT) capture this way. Mori's helper is one Swift file with no
dependencies: `bash app/native/mori-sysaudio/build.sh` builds it with the Xcode
command line tools.

What a refused permission looks like is not settled. In CI, switching the
stored answer to "no" gave silence in one run and normal audio in two, so the
workflow cannot tell yet; it needs someone to click "Don't Allow" on a real Mac.

First target: Apple Silicon, macOS 14.2 or later.

## Milestones

| # | Milestone | Done when | Proven by |
|---|---|---|---|
| M0 ✅ | **macOS in CI** | A `macos-latest` job is green: types, checks, Rust tests, and every Python dependency resolves to a macOS wheel | CI |
| M1 ✅ | **A Mac app comes out of CI** | The workflow uploads a `.dmg`; its `Info.plist` carries the microphone and audio-capture descriptions; the helper and the Python scripts are inside; the recorder inside the app hears a played sentence | CI |
| M2 | **It feels like a Mac app** | `Cmd` in every shortcut label, the global hotkey works with another app in front, the tray icon and the floating pill look right | Mac |
| M3 | **Microphone recording** | A 10 s recording becomes a call with the right transcript, and Mori says plainly that the other side is not captured yet | Mac |
| M4 | **The other side** | With a known speech file playing, the "others" channel contains it and its transcript matches (✅ in CI, from source and in the app from the `.dmg`); no Screen Recording prompt appeared; denying the permission shows a clear message (still to see in the packaged app) | CI, then Mac |
| M5 | **No Python to install** | On a machine with no Python, first launch prepares everything by itself (bundled `uv`, environment in `~/.mori/venv`), on macOS and on Windows | CI, then Mac |
| M6 | **Download and run** | A tag produces a release with a `.dmg` and a Windows installer | CI, then Mac |
| M7 | **No warning on first open** | The app is signed with a Developer ID and notarized from CI | CI |
| M8 | **Faster local Whisper on Apple Silicon** (optional) | Same transcript, measured time reported | Mac |

### What M1 proves, and what it does not

Seen in CI on `macos-latest` (macOS 26, Apple Silicon), in the
[macOS app](../.github/workflows/macos-app.yml) workflow:

- `tauri build` produces `Mori.app` and `Mori_0.1.0_aarch64.dmg` (about 8 MB),
  uploaded as the artifact `Mori-macos-apple-silicon-dmg`.
- Inside the app taken from the `.dmg`: the helper at
  `Contents/MacOS/mori-sysaudio`, the Python scripts in
  `Contents/Resources/scripts/`, `requirements.txt` next to them, an
  `Info.plist` with both usage descriptions and a minimum macOS of 14.2.
  The signature is ad hoc (`Signature=adhoc`) and `codesign --verify --deep
  --strict` passes.
- The `record.py` inside the app finds the helper inside the app by itself and
  writes the played sentence to the "others" channel.
- The app opens, shows its window and its menu bar icon, starts and stops a
  recording with `Ctrl+Shift+R` sent by another process, and the recording it
  made contains the sentence. That step reports without deciding whether the
  job is green: driving a window on a CI machine is the fragile part.

Not seen: the two permission prompts (CI writes the answers before the first
capture, because nobody can click there), what Gatekeeper says about a
downloaded copy, a person speaking into a microphone, an Intel Mac, and any
macOS older than 26. The app still expects a Python environment in
`~/.mori/venv` (M5).

The macOS-only bundle settings live in
[`tauri.macos-app.conf.json`](../app/src-tauri/tauri.macos-app.conf.json), so
Windows and Linux builds never need the Swift helper. To build on a Mac:

```
cd app
pnpm install
bash native/mori-sysaudio/build.sh
pnpm exec tauri build --config src-tauri/tauri.macos-app.conf.json --bundles app,dmg
```

Until M7 a downloaded build opens through *System Settings → Privacy &
Security → Open Anyway*.

## Known gaps today

- Shortcut labels say `Ctrl`, and some interface text says "PC" or "Windows".
- "It looks like you are in a call" relies on the title of the window in
  front, which is Windows-only today.
- Local Whisper runs on the CPU on a Mac; the hosted option (seconds per
  hour of call) works the same on every platform.

## How to help

Open an issue before you start so two people do not build the same thing.
M5 and M6 start in CI, with no Mac. For M2 to M4, a screenshot and the text of any
error are worth more than a long description.
