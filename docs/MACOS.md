# Mori on macOS

Status: **in progress, looking for help.** Mori is used every day on Windows.
On a Mac the app compiles, passes its tests and comes out of CI as a `.dmg`
for Apple Silicon ([workflow](../.github/workflows/macos-app.yml)). On every
change a GitHub Mac takes the app out of that `.dmg` and opens it with no
Python installed for it: Mori prepares its own, then a recording is started
with `Cmd+Shift+R`, a known sentence is played, and Mori's "others" channel
has to contain it. What is missing: a published release to download it from, a
signature macOS trusts, and a person looking at it on a real Mac. This page is
the plan. The research behind it, with sources for every claim, is in
[`research/macos.md`](research/macos.md).

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
| M2 | **It feels like a Mac app** | `Cmd` in every shortcut label and `Cmd+Shift+R` as the global shortcut (✅ in CI), Mac wording, a menu bar of its own where `Cmd+Q` during a call saves it first (✅ in CI); the menu bar icon and the floating pill look right (still to see on a Mac) | CI, then Mac |
| M3 | **Honest states** | When the helper is missing or stops in the middle of a call, the recorder says so in what the interface reads and your side keeps recording (✅ in CI); a person sees the warning on a Mac | CI, then Mac |
| M4 | **The other side** | With a known speech file playing, the "others" channel contains it and its transcript matches (✅ in CI, from source and in the app from the `.dmg`); no Screen Recording prompt appeared; denying the permission shows a clear message (still to see in the packaged app) | CI, then Mac |
| M5 | **No Python to install** | With no `~/.mori/venv` and none of the machine's Pythons on its `PATH`, first launch prepares everything by itself (bundled `uv`, environment in `~/.mori/venv`), then records with it: ✅ in CI on macOS, and on Windows from the installer | CI, then Mac |
| M6 | **Download and run** | The [release workflow](../.github/workflows/release.yml) builds the `.dmg` and the Windows installer and, on the Windows machine, installs it and opens it (✅ run by hand). A tag would open a draft release with the two files: no tag has been pushed yet | CI, then Mac |
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
  recording with `Cmd+Shift+R` sent by another process, and the recording it
  made contains the sentence. That step reports without deciding whether the
  job is green: driving a window on a CI machine is the fragile part.

Not seen: the two permission prompts (CI writes the answers before the first
capture, because nobody can click there), what Gatekeeper says about a
downloaded copy, a person speaking into a microphone, an Intel Mac, and any
macOS older than 26.

### What M2, M3 and M5 prove

Seen in the same workflow, on the app taken from the `.dmg`:

- **First launch.** The job sets up no Python. The app is opened with
  `PATH=/usr/bin:/bin:/usr/sbin:/sbin` and no `~/.mori/venv`. With the `uv`
  inside the app (`Contents/MacOS/uv`) it downloads a Python 3.12 into
  `~/.mori/python`, creates `~/.mori/venv` and installs `requirements.txt`:
  about 200 MB and 70 MB on disk, a few seconds on the CI network. What `uv`
  printed is kept in `~/.mori/setup.log`. The recording that follows is made by
  `~/.mori/venv/bin/python`.
- **Mac keys and words.** The screenshots show `⌘ ⇧ R` on the record control,
  "on your Mac", "from the menu bar", a menu bar with Mori, Edit and Window, and
  the menu behind the menu bar icon in English with `⇧⌘R`.
- **Cmd+Q during a call.** A second recording is ended with `Cmd+Q`: the
  recorder closes its file, the call is saved, Mori quits, and no recorder or
  helper process is left. It passed in 3 runs and failed in 1, where Mori was
  still open a minute later while the first call was being transcribed; the
  cause is not known, and the step now samples the process if it happens again.
- **Without the helper.** A copy of the app with the helper removed, then the
  real app with the helper killed two seconds into a recording: in both the
  recorder writes `sys: mori-sysaudio not found` or `sys: mori-sysaudio stopped`
  in the levels the interface reads, exits normally, and the microphone file
  is a valid recording of the whole time.

Not seen: the floating pill, the warning as a person reads it in the
interface, and the setup on a slow or absent network (the strip offers "Try
again"; its two states were looked at in the preview bench, not on a Mac).

The macOS-only bundle settings live in
[`tauri.macos-app.conf.json`](../app/src-tauri/tauri.macos-app.conf.json), so
Windows and Linux builds never need the Swift helper. To build on a Mac:

```
cd app
pnpm install
bash native/mori-sysaudio/build.sh
bash native/uv/fetch.sh
pnpm exec tauri build --config src-tauri/tauri.macos-app.conf.json --bundles app,dmg
```

Until M7 a downloaded build opens through *System Settings → Privacy &
Security → Open Anyway*.

## Known gaps today

- The menu bar icon is the app's colour icon, not a template image that
  follows the menu bar's light and dark.
- "It looks like you are in a call" relies on the title of the window in
  front, which is Windows-only today.
- Local Whisper runs on the CPU on a Mac; the hosted option (seconds per
  hour of call) works the same on every platform.

## How to help

Open an issue before you start so two people do not build the same thing.
For M2 to M4, a screenshot from a real Mac and the text of any error are worth
more than a long description.
