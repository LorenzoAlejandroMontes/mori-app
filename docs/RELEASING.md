# Releasing Mori

One workflow builds what a person downloads: [Release](../.github/workflows/release.yml).
It makes the Windows installer and the `.dmg` for Apple Silicon, then proves both on the
machine that built them.

| How it starts | Mac app | What comes out |
|---|---|---|
| By hand, `sign` not ticked | ad hoc signature, no secret used | the two files as artifacts, kept 14 days |
| By hand, `sign` ticked | Developer ID, notarized | the same two artifacts, the `.dmg` signed |
| A tag `v*` | Developer ID, notarized | the same, plus a draft release with the two files. Publishing it is a click made by a person |

## What the Mac job proves, every time

After the `.dmg` is final, the job takes `Mori.app` out of that file and uses only that copy:

1. **First launch** with no Python on the machine: Mori prepares its own.
2. **A call recorded with the shortcut** while a known sentence plays: the "others" channel
   has to contain it.
3. **The transcript** of that sentence, read back from Mori's database.
4. **A first launch from a quarantined download**: the `.dmg` is marked as downloaded by a
   browser, the app is copied to `/Applications` and opened, with screenshots.

A step that does not hold fails the job. The screenshots, the recordings and the verdicts are
in the `macos-release-proof` artifact.

Before any of that, a **signing rehearsal** runs on every build: a copy of the app is signed
with a certificate made on the spot, with the settings of the real signature (hardened runtime,
the audio input entitlement on `mori` and `mori-sysaudio`, none on `uv`), and every binary
inside is checked.

## A signed release

The Developer ID private key is never on the runner. The job opens a signing session and
waits; the owner joins it from the machine that holds the key
([rcodesign remote signing](https://gregoryszorc.com/docs/apple-codesign/stable/apple_codesign_remote_signing.html)).
Notarization is sent to Apple from that machine too. The runner only waits for the ticket
and staples it.

On the owner's machine, one folder holds:

| File | What it is |
|---|---|
| `devid.key` | the Developer ID private key (PEM) |
| `devid.pem` | its certificate (PEM); the public half is [in the repo](../tools/release/mac/devid-cert.pem) |
| `asc-key.json` | the App Store Connect API key, as `rcodesign encode-app-store-connect-api-key` writes it |
| `rcodesign` | the [rcodesign](https://github.com/indygreg/apple-platform-rs/releases) program, 0.29.0 (or have it on `PATH`) |

Then:

1. Start the run: Actions → Release → Run workflow → tick **sign**. Or
   `gh workflow run release.yml -f sign=true`. Note the run id (the number in its URL).
2. Join it, from Git Bash on Windows or a terminal on macOS or Linux:

   ```
   MORI_SIGNING_DIR=<the folder above> bash tools/release/sign-owner.sh <run id>
   ```

The script follows the run and does four things as the run asks for them: signs the app,
sends it to Apple, signs the `.dmg`, sends it to Apple. It can be started before the run
reaches the first of them. It prints no key, no join string and no token.

The run waits 40 minutes for each signature and 45 minutes for each ticket from Apple. If the
script stops, run it again while the run is still waiting.

When the run is green, the `.dmg` in `Mori-macos-apple-silicon` is the release file, and
`signed.txt` in `macos-release-proof` has what macOS says about it (`spctl`, `stapler
validate`, `codesign -dv`) next to the first-launch screenshots.

## What has been seen, and what has not

Seen on `macos-latest` (macOS 26.6.2, Apple Silicon):

- The unsigned path, start to end: build, rehearsal, the proof on the app from the `.dmg`,
  and the quarantined first launch, where macOS refuses the ad hoc app with "Mori Not Opened"
  (run 37695803034).
- The rehearsal signs `mori`, `mori-sysaudio` and `uv` with the hardened runtime, and
  `codesign --verify --deep --strict` accepts the result (run 37695833142).
- The handover: a run with `sign` ticked opens the session and publishes the join string
  while it is still running; `sign-owner.sh`, pointed at an empty folder, finds it, downloads
  it and stops at the missing key (run 37695833142, cancelled after that).

Not seen yet, because it needs the real key:

- A signature made with the Developer ID certificate, and `rcodesign --for-notarization`
  accepting it (a certificate made on the spot is refused by that check, so the rehearsal
  runs without it).
- Apple accepting the app and the `.dmg`, and the two tickets stapled.
- Gatekeeper's verdict on the notarized app, and the first launch from a quarantined download
  ending with Mori's window on screen.

Until a signed run is green, a downloaded `.dmg` opens through *System Settings → Privacy &
Security → Open Anyway*.
