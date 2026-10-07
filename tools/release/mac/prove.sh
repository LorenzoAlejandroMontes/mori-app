#!/usr/bin/env bash
# The proof that the Mori.app a person downloads works, run on the release machine against the
# app taken out of the release .dmg (signed and notarized, or ad hoc in a dry run):
#
#   1. first launch with no Python anywhere: Mori prepares its own with the uv inside the app
#   2. a recording started and stopped with the global shortcut while a known sentence plays:
#      the "others" channel has to contain the sentence
#   3. the app turns that call into text by itself
#
# Every check that fails ends the script with a non-zero exit code. The same steps live in
# .github/workflows/macos-app.yml, where the reasons for each of them are written down.
#
#   prove.sh <path to Mori.app> <results folder>
set -euo pipefail

APP="$(cd "$1" && pwd)"; R="$2"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT/app"
mkdir -p "$R"
MORI="$APP/Contents/MacOS/mori"
PY="$HOME/.mori/venv/bin/python"
T="$(getconf DARWIN_USER_TEMP_DIR)"
FINDER_PATH=/usr/bin:/bin:/usr/sbin:/sbin     # the PATH of an app opened from Finder

running() { pgrep -f "$MORI\$" > /dev/null; }
shortcut() { osascript -e 'tell application "System Events" to key code 15 using {command down, shift down}' 2>&1 || echo "could not send the shortcut"; }
quit_mori() {
    osascript -e 'tell application "System Events" to tell process "mori" to set frontmost to true' 2>&1 || true
    sleep 1
    osascript -e 'tell application "System Events" to keystroke "q" using {command down}' 2>&1 || echo "could not send Cmd+Q"
    for _ in $(seq 1 50); do running || break; sleep 0.2; done
    if running; then echo "Mori did not quit: stopping it"; pkill -f "$APP/Contents/MacOS" || true; sleep 1; else echo "Mori quit"; fi
}
# The app looks for scripts next to its source folder first. On this machine that folder exists;
# it is hidden while the app runs, so the app can only use its own.
restore() { [ -d scripts.checkout ] && mv scripts.checkout scripts || true; }
trap restore EXIT

echo "## a sentence to play"
bash "$(dirname "$0")/make-speech.sh" "$R"
osascript -e "set volume output volume 60" || true

# On a person's Mac these are two system questions. Nobody can click them here, and an unanswered
# question blocks every later capture: the answers are written where macOS keeps them, before the
# first capture, for the helper by path and for the app by its identifier.
echo "## allow the microphone and system audio recording"
BIN="$APP/Contents/MacOS/mori-sysaudio"
SQL="CREATE TEMP TABLE t AS SELECT * FROM access WHERE service IN ('kTCCServiceMicrophone','kTCCServiceScreenCapture') GROUP BY client;
     UPDATE t SET service='kTCCServiceAudioCapture', auth_value=2;
     INSERT OR REPLACE INTO access SELECT * FROM t;
     CREATE TEMP TABLE b AS SELECT * FROM t WHERE client LIKE '/%' LIMIT 1;
     UPDATE b SET client='$BIN', csreq=NULL;
     INSERT OR REPLACE INTO access SELECT * FROM b;
     UPDATE b SET client='com.mori.app', client_type=0;
     INSERT OR REPLACE INTO access SELECT * FROM b;
     UPDATE b SET service='kTCCServiceMicrophone';
     INSERT OR REPLACE INTO access SELECT * FROM b;
     SELECT service, client, client_type, auth_value FROM access ORDER BY service, client;"
echo "# system"; sudo sqlite3 "/Library/Application Support/com.apple.TCC/TCC.db" "$SQL" | tee "$R/tcc_system.txt"
echo "# user"; sqlite3 "$HOME/Library/Application Support/com.apple.TCC/TCC.db" "$SQL" | tee "$R/tcc_user.txt"

echo "## 1. first launch: Mori prepares its own Python"
[ ! -e "$HOME/.mori/venv" ] || { echo "FAILED: there is already a ~/.mori/venv, this would prove nothing"; exit 1; }
mv scripts scripts.checkout
open --env PATH="$FINDER_PATH" --stdout "$R/app.out" --stderr "$R/app.err" "$APP"
SHOT=0
for _ in $(seq 1 400); do
    if [ -f "$HOME/.mori/setup.log" ] && [ $SHOT -lt 12 ]; then SHOT=$((SHOT + 1)); screencapture -x "$R/setup_$SHOT.png" || true; fi
    if grep -q "^## check" "$HOME/.mori/setup.log" 2>/dev/null && "$PY" -c "import soundcard, numpy, faster_whisper" 2>/dev/null; then break; fi
    sleep 1
done
echo "# the setup log (~/.mori/setup.log)"
cat "$HOME/.mori/setup.log" | tee "$R/setup.log" || { echo "FAILED: Mori wrote no setup log"; cat "$R/app.err" || true; exit 1; }
"$PY" -c "import sys, soundcard, numpy, faster_whisper; print('imports ok,', sys.version); print(sys.executable)" | tee "$R/setup_python.txt" \
    || { echo "FAILED: Mori did not prepare its Python"; exit 1; }
BASE="$(readlink "$HOME/.mori/venv/bin/python" || "$PY" -c "import sys; print(sys.base_prefix)")"
case "$BASE" in "$HOME/.mori/python"*) ;; *) echo "FAILED: the venv is not built on Mori's own Python ($BASE)"; exit 1 ;; esac
du -sh "$HOME/.mori/venv" "$HOME/.mori/python" | tee "$R/setup_sizes.txt"
sleep 4
screencapture -x "$R/setup_ready.png" || true
quit_mori
echo "Mori prepared its own Python"

# One try: open the app, record with the shortcut while the sentence plays, check the channel.
live() {
    local N="$1" STARTED="" WAV
    rm -f "$T"/mori_rec_* || true
    open --env PATH="$FINDER_PATH" --stdout "$R/app_live_$N.out" --stderr "$R/app_live_$N.err" "$APP"
    sleep 12
    pgrep -fl "$APP/Contents/MacOS" || { echo "the app is not running"; cat "$R/app_live_$N.err" || true; return 1; }
    screencapture -x "$R/app_open_$N.png" || true
    echo "# shortcut: start"
    shortcut
    for _ in $(seq 1 150); do STARTED=$(ls "$T"/mori_rec_*.wav.started 2>/dev/null | head -1 || true); [ -n "$STARTED" ] && break; sleep 0.2; done
    [ -n "$STARTED" ] || { echo "no recording started after the shortcut"; screencapture -x "$R/app_no_recording_$N.png" || true; cat "$R/app_live_$N.out" "$R/app_live_$N.err" 2>/dev/null || true; return 1; }
    WAV="${STARTED%.started}"
    sleep 2
    echo "# recorder and helper started by the app"
    pgrep -fl "record.py" | tee "$R/live_recorder.txt" || true
    pgrep -fl "mori-sysaudio" | tee "$R/live_helper.txt" || true
    afplay "$R/speech.wav" &
    local A=$!
    sleep 4
    screencapture -x "$R/app_recording_$N.png" || true
    cat "$WAV.levels" 2>/dev/null | tee "$R/live_levels_$N.json" || true
    echo
    wait $A || true
    sleep 2
    echo "# shortcut: stop"
    shortcut
    # The app deletes the channel files once the call is transcribed: copy the others' channel
    # the moment the recorder says it is done.
    for _ in $(seq 1 300); do [ -f "$WAV.done" ] && break; sleep 0.1; done
    cp "$WAV.sys.wav" "$R/live_others.wav" 2>/dev/null || true
    cp "$WAV.mic.wav" "$R/live_you.wav" 2>/dev/null || true
    [ -f "$WAV.done" ] && [ -f "$R/live_others.wav" ] || { echo "the recording did not finish"; ls -la "$T" | grep mori_rec || true; cat "$T"/mori_rec_*.log 2>/dev/null || true; return 1; }
    sleep 3
    screencapture -x "$R/app_after_stop_$N.png" || true
    echo "# the others' channel, recorded by the running app"
    "$PY" native/mori-sysaudio/ci_check.py "$R/live_others.wav" meeting thursday slides | tee "$R/live_others.json" || return 1
    grep -qE "$HOME/\.mori/(venv|python)/" "$R/live_recorder.txt" || { echo "the recorder was not run by the Python Mori prepared"; return 1; }
    grep -q "$APP/Contents/Resources/scripts/record.py" "$R/live_recorder.txt" || { echo "the recorder was not the one inside the app"; return 1; }
    grep -q "$APP/Contents/MacOS/mori-sysaudio" "$R/live_helper.txt" || { echo "the helper was not the one inside the app"; return 1; }
}

echo "## 2. the app, opened and driven with its shortcut"
OK=""
for N in 1 2 3; do
    if live "$N"; then OK=yes; break; fi
    # Seen on this kind of machine: both channels all zeros and shorter than the time that
    # passed. That is the machine's sound system not running: restart it and try again.
    echo "## attempt $N failed: restarting the app, the sound system and the permission daemon"
    pkill -f "$APP/Contents/MacOS" || true
    sudo killall coreaudiod || true
    sudo killall tccd || true
    killall tccd || true
    sleep 6
    osascript -e "set volume output volume 60" || true
done
[ -n "$OK" ] || { echo "FAILED: the running app did not record the other side in 3 attempts"; exit 1; }
echo "the running app recorded the other side"

# With no key, as on a new install: the local Whisper, which downloads its model the first time.
echo "## 3. the app transcribes the call it recorded"
Q="select s.title, s.status, t.provider, t.model, replace(t.memo, char(10), ' / ') from session s join session_transcript t on t.session_id = s.id where t.provider != 'seed'"
for i in $(seq 1 120); do
    sqlite3 "$HOME/.mori/mori.db" "$Q" > "$R/transcript_in_app.txt" 2>/dev/null || true
    grep -qi "thursday" "$R/transcript_in_app.txt" && break
    if [ $((i % 6)) -eq 0 ]; then echo "waiting ($((i * 5)) s)"; sqlite3 "$HOME/.mori/mori.db" "select kind, status, attempts, coalesce(last_error, '') from job" 2>/dev/null || true; fi
    sleep 5
done
echo "# what Mori wrote down"
cat "$R/transcript_in_app.txt"
for _ in $(seq 1 30); do sqlite3 "$HOME/.mori/mori.db" "select status from job where kind = 'transcribe'" | grep -q running || break; sleep 2; done
sqlite3 "$HOME/.mori/mori.db" "select kind, status, attempts, coalesce(last_error, '') from job" | tee "$R/jobs_in_app.txt" || true
sleep 4
screencapture -x "$R/app_transcribed.png" || true
grep -qi "thursday" "$R/transcript_in_app.txt" || { echo "FAILED: the transcript did not arrive"; exit 1; }
grep -qi "slides" "$R/transcript_in_app.txt" || { echo "FAILED: the transcript is not the sentence that was played"; exit 1; }
echo "the app transcribed the call it recorded"

quit_mori
echo "PROVED: first launch, both sides of a call, the transcript"
