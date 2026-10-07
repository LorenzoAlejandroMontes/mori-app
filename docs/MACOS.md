# Mori on macOS

Status: **in progress, looking for help.** Mori is used every day on Windows.
On a Mac the app compiles, records your microphone and does everything that
comes after (transcript, summary, to-dos, Ask Mori). What is missing is the
other side of the call. This page is the plan. The research behind it, with
sources for every claim, is in [`research/macos.md`](research/macos.md).

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

First target: Apple Silicon, macOS 14.2 or later.

## Milestones

| # | Milestone | Done when | Proven by |
|---|---|---|---|
| M0 | **macOS in CI** | A `macos-latest` job is green: types, checks, Rust tests, and every Python dependency resolves to a macOS wheel | CI |
| M1 | **A Mac app comes out of CI** | The workflow uploads a `.dmg`; its `Info.plist` carries the microphone and audio-capture descriptions | CI |
| M2 | **It feels like a Mac app** | `Cmd` in every shortcut label, the global hotkey works with another app in front, the tray icon and the floating pill look right | Mac |
| M3 | **Microphone recording** | A 10 s recording becomes a call with the right transcript, and Mori says plainly that the other side is not captured yet | Mac |
| M4 | **The other side** | With a known speech file playing, the "others" channel contains it and its transcript matches; no Screen Recording prompt appeared; denying the permission shows a clear message | Mac |
| M5 | **No Python to install** | On a machine with no Python, first launch prepares everything by itself (bundled `uv`, environment in `~/.mori/venv`), on macOS and on Windows | CI, then Mac |
| M6 | **Download and run** | A tag produces a release with a `.dmg` and a Windows installer | CI, then Mac |
| M7 | **No warning on first open** | The app is signed with a Developer ID and notarized from CI | CI |
| M8 | **Faster local Whisper on Apple Silicon** (optional) | Same transcript, measured time reported | Mac |

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
M0 and M1 need no Mac at all. For M2 to M4, a screenshot and the text of any
error are worth more than a long description.
