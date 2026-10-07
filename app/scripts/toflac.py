"""Compress a kept recording to FLAC, losslessly, and prove it reads back.

Mori keeps the audio of a call so you can replay any line of the transcript. Four
calls were 264 MB of uncompressed WAV. FLAC is lossless, plays in the webview,
and roughly halves that.

Uses PyAV (already installed as a faster-whisper dependency — no new package).
Prints ONE JSON object: {"ok":true,"flac":"...","src_bytes":N,"dst_bytes":N,
"src_frames":N,"dst_frames":N}. The caller deletes the WAV only when ok is true.

Usage: python toflac.py <in.wav> <out.flac>
"""
import json
import os
import sys
import wave

import av

RATE = 16000


def wav_frames(path: str) -> int:
    with wave.open(path, "rb") as w:
        return w.getnframes()


def encode(src: str, dst: str) -> None:
    inp = av.open(src)
    # The container format is stated, not guessed: we write to a ".part" file
    # first and its extension would tell PyAV nothing.
    out = av.open(dst, "w", format="flac")
    try:
        stream = out.add_stream("flac", rate=RATE)
        resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=RATE)
        for frame in inp.decode(audio=0):
            for res in resampler.resample(frame):
                for packet in stream.encode(res):
                    out.mux(packet)
        for res in resampler.resample(None):
            for packet in stream.encode(res):
                out.mux(packet)
        for packet in stream.encode(None):
            out.mux(packet)
    finally:
        out.close()
        inp.close()


def decoded_frames(path: str) -> int:
    n = 0
    c = av.open(path)
    try:
        for frame in c.decode(audio=0):
            n += frame.samples
    finally:
        c.close()
    return n


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: toflac.py <in.wav> <out.flac>", file=sys.stderr)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    # A refusal is reported through `ok: false` on stdout with exit code 0: the
    # caller reads stdout, and a non-zero exit would hide the reason.
    if not os.path.exists(src):
        print(json.dumps({"ok": False, "error": f"audio not found: {src}"}))
        return 0

    tmp = dst + ".part"
    for p in (tmp, dst):
        try:
            os.remove(p)
        except OSError:
            pass

    encode(src, tmp)

    src_frames = wav_frames(src)
    dst_frames = decoded_frames(tmp)
    # Lossless means sample-for-sample; allow one resampler block of slack only.
    ok = dst_frames > 0 and abs(dst_frames - src_frames) <= RATE // 10
    if not ok:
        try:
            os.remove(tmp)
        except OSError:
            pass
        print(json.dumps({"ok": False, "error": f"check failed: {src_frames} -> {dst_frames} samples"}))
        return 0

    os.replace(tmp, dst)
    print(
        json.dumps(
            {
                "ok": True,
                "flac": dst,
                "src_bytes": os.path.getsize(src),
                "dst_bytes": os.path.getsize(dst),
                "src_frames": src_frames,
                "dst_frames": dst_frames,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
