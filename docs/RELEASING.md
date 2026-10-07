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

Seen with the real key (run 37701746535, signed from the owner's PC):

- `rcodesign --for-notarization` accepts the app signed with the Developer ID certificate.
- Apple accepts the app and the `.dmg`, about a minute each, and both tickets are stapled
  (`stapler validate` passes on both).
- `spctl` on both: `accepted`, `source=Notarized Developer ID`. `syspolicy_check distribution`
  on the installed copy: "App passed all pre-distribution checks".
- First launch from a quarantined download: macOS asks the one standard question ("Mori is an
  app downloaded from the Internet... Apple checked it for malicious software and none was
  detected"), and after *Open* Mori's window is on screen.
- The proof on that same app: first launch prepares Python, a played call is recorded on both
  sides with the hardened runtime on, and it is transcribed.

One thing learned on the way: the signing session on the relay ends after about ten minutes
with nobody joining it, well before the run stops waiting. Start `sign-owner.sh` right after
starting the run; it waits for the session by itself.

Not seen: the microphone and audio capture prompts as a person meets them (CI writes the
answers before the first capture), an Intel Mac, and a macOS older than 26.
