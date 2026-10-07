#!/usr/bin/env bash
# The sentence the proofs play as "the other side of the call": speech.aiff and speech.wav
# (16 kHz mono) in the folder given.
#
# On the cloud Mac `say -o` sometimes writes a file with no sound in it and exits 0 (release
# run 37703345291: 4 KB instead of 214 KB). Every later step then records real silence and
# blames the recorder. So the file is measured here, and made again until it has the sentence.
set -euo pipefail
R="${1:?usage: make-speech.sh <results folder>}"
TEXT="[[slnc 500]] Hello Sarah, the meeting moved to Thursday at three. Can you bring the slides?"
MIN_BYTES=96000   # 3 seconds at 16 kHz, 16 bit, mono; the sentence is about 5

for attempt in 1 2 3 4 5 6; do
    # the default voice first, then two that every macOS has
    case "$attempt" in 1|2) VOICE="" ;; 3|4) VOICE="Samantha" ;; *) VOICE="Alex" ;; esac
    rm -f "$R/speech.aiff" "$R/speech.wav"
    if [ -n "$VOICE" ]; then
        say -v "$VOICE" -o "$R/speech.aiff" "$TEXT" || true
    else
        say -o "$R/speech.aiff" "$TEXT" || true
    fi
    [ -f "$R/speech.aiff" ] && afconvert -f WAVE -d LEI16@16000 -c 1 "$R/speech.aiff" "$R/speech.wav" || true
    SIZE=$(stat -f %z "$R/speech.wav" 2>/dev/null || echo 0)
    if [ "$SIZE" -ge "$MIN_BYTES" ]; then
        echo "speech.wav: $SIZE bytes, attempt $attempt, voice ${VOICE:-default}"
        exit 0
    fi
    echo "attempt $attempt: say wrote $SIZE bytes, no sentence in it. Restarting the speech service"
    killall -9 com.apple.speech.speechsynthesisd 2>/dev/null || true
    sleep 3
done
echo "FAILED: this Mac's speech service did not produce the test sentence in 6 attempts."
echo "This is the test machine, not Mori: nothing was recorded yet. Run the job again."
exit 1
