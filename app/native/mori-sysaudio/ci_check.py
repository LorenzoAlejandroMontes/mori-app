"""Is the sentence that was played really in this recording?

Used by .github/workflows/macos-audio.yml. Reads a 16 kHz mono recording (.wav
or raw s16le .pcm), measures how loud its loudest second is, transcribes it with
the same local Whisper Mori uses, and checks the expected words are there.

    python ci_check.py <recording> <word> [<word> ...]

Prints one JSON line. Exit 0 only if the audio is there AND every word is heard.
"""
import json
import sys
import wave

import numpy as np

SR = 16000
LOUD_ENOUGH = 0.01  # the same threshold record.py uses to tell signal from silence


def load(path):
    if path.endswith(".pcm"):
        raw = open(path, "rb").read()
    else:
        with wave.open(path) as w:
            assert w.getframerate() == SR and w.getnchannels() == 1, "expected 16 kHz mono"
            raw = w.readframes(w.getnframes())
    return np.frombuffer(raw[: len(raw) // 2 * 2], dtype="<i2").astype("float32") / 32767.0


def loudest_second(a):
    if a.size < SR:
        return float(np.sqrt(np.mean(a * a))) if a.size else 0.0
    n = a.size // SR
    blocks = a[: n * SR].reshape(n, SR)
    return float(np.sqrt((blocks * blocks).mean(axis=1)).max())


def main():
    path, words = sys.argv[1], [w.lower() for w in sys.argv[2:]]
    a = load(path)
    loud = loudest_second(a)
    text = ""
    if loud > 0.001:
        from faster_whisper import WhisperModel

        model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
        segments, _ = model.transcribe(a, language="en")
        text = " ".join(s.text.strip() for s in segments)
    missing = [w for w in words if w not in text.lower()]
    ok = loud > LOUD_ENOUGH and not missing
    print(json.dumps({
        "file": path.rsplit("/", 1)[-1],
        "seconds": round(a.size / SR, 1),
        "loudest_second_rms": round(loud, 4),
        "peak": round(float(np.abs(a).max()) if a.size else 0.0, 4),
        "transcript": text,
        "missing_words": missing,
        "ok": ok,
    }))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
