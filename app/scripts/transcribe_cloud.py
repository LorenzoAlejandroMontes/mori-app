"""Fast transcription through a cloud Whisper (Groq's free whisper-large-v3-turbo,
or any OpenAI-shaped /audio/transcriptions endpoint). Opt-in, never for
private calls (the app decides). A one-hour call takes seconds instead of the
tens of minutes Whisper needs on a laptop CPU.

What leaves the PC is only the SPEECH: silence is cut here, with the same VAD
faster-whisper uses (bundled, offline), so the free allowance (2 h of audio an
hour, 8 a day on Groq) goes on words, and each piece stays well under the
25 MB upload limit (16 kHz mono FLAC, at most ~8 minutes of speech a piece).
The timestamps that come back are mapped onto the original recording, so
clicking a line still plays the right second.

Usage (same shape as the local scripts, so Rust can fall back to them):
  python transcribe_cloud.py <mic_wav> <sys_wav> [--vocab ..] [--context ..] [--progress file]
  python transcribe_cloud.py <audio> [--vocab ..] [--context ..] [--progress file]
Endpoint, key and model come from the environment (never argv, which other
processes can read): MORI_STT_URL, MORI_STT_KEY, MORI_STT_MODEL.
Prints ONE JSON object like transcribe*.py. Any failure → exit code 3 and a
reason on stderr; the caller then transcribes locally.
"""
import io, json, os, sys, time, uuid, urllib.request, urllib.error

import numpy as np
from faster_whisper.audio import decode_audio
from faster_whisper.vad import VadOptions, get_speech_timestamps

from progress_file import Progress, pop_progress_flag

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

RATE = 16000
MAX_PIECE_S = 480        # speech per upload: ~8 min ≈ 8–10 MB of FLAC
GAP_S = 0.4              # silence put back between stretches, so words don't run together
PAD_S = 0.2              # a little air around each stretch the VAD found
BASE_PROMPT = "Conversazione di lavoro."


class CloudError(Exception):
    pass


def parse_flags(argv):
    flags = {"--vocab": "", "--context": ""}
    rest, i = [], 0
    while i < len(argv):
        if argv[i] in flags and i + 1 < len(argv):
            flags[argv[i]] = argv[i + 1]
            i += 2
        else:
            rest.append(argv[i])
            i += 1
    return rest, flags["--vocab"], flags["--context"]


def build_prompt(vocab: str, context: str = "") -> str:
    base = " ".join(context.split())[:300] or BASE_PROMPT
    if not base.endswith((".", "!", "?")):
        base += "."
    names = ", ".join(n.strip() for n in vocab.split(",") if n.strip())[:400]
    return f"{base} Persone e progetti: {names}." if names else base


def pieces(audio: np.ndarray):
    """Cut the silence out and group the speech into uploadable pieces.
    Yields (samples, spans) where spans maps piece time → original time:
    [(piece_start_s, orig_start_s, dur_s), ...]."""
    stamps = get_speech_timestamps(audio, VadOptions(min_silence_duration_ms=500, speech_pad_ms=int(PAD_S * 1000)))
    gap = np.zeros(int(GAP_S * RATE), dtype=np.float32)
    buf, spans, t = [], [], 0.0
    for st in stamps:
        seg = audio[st["start"]:st["end"]]
        dur = len(seg) / RATE
        if buf and t + dur > MAX_PIECE_S:
            yield np.concatenate(buf), spans
            buf, spans, t = [], [], 0.0
        # A single stretch longer than a piece (a monologue): split it plainly.
        off = 0
        while dur - off / RATE > MAX_PIECE_S:
            part = seg[off:off + MAX_PIECE_S * RATE]
            yield part, [(0.0, st["start"] / RATE + off / RATE, len(part) / RATE)]
            off += MAX_PIECE_S * RATE
        seg = seg[off:]
        if not len(seg):
            continue
        spans.append((t, st["start"] / RATE + off / RATE, len(seg) / RATE))
        buf += [seg, gap]
        t += len(seg) / RATE + GAP_S
    if buf:
        yield np.concatenate(buf), spans


def to_original(t: float, spans) -> float:
    """Piece time → time in the recording (inside the gaps, the nearest edge)."""
    best = spans[0]
    for sp in spans:
        if sp[0] <= t:
            best = sp
        else:
            break
    start, orig, dur = best
    return orig + min(max(0.0, t - start), dur)


def flac_bytes(samples: np.ndarray) -> bytes:
    import av

    out = io.BytesIO()
    with av.open(out, mode="w", format="flac") as c:
        st = c.add_stream("flac", rate=RATE)
        st.layout = "mono"
        pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16).reshape(1, -1)
        frame = av.AudioFrame.from_ndarray(pcm, format="s16", layout="mono")
        frame.sample_rate = RATE
        for p in st.encode(frame):
            c.mux(p)
        for p in st.encode(None):
            c.mux(p)
    return out.getvalue()


def post(url: str, key: str, model: str, prompt: str, language, data: bytes) -> dict:
    boundary = uuid.uuid4().hex
    fields = {"model": model, "response_format": "verbose_json", "temperature": "0", "prompt": prompt}
    if language:
        fields["language"] = language
    body = io.BytesIO()
    for k, v in fields.items():
        body.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    body.write(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="piece.flac"\r\nContent-Type: audio/flac\r\n\r\n'.encode())
    body.write(data)
    body.write(f"\r\n--{boundary}--\r\n".encode())
    payload = body.getvalue()
    for attempt in range(4):
        req = urllib.request.Request(
            url.rstrip("/") + "/audio/transcriptions",
            data=payload,
            # A named client: Groq's edge answers 403 (error code 1010) to
            # urllib's default "Python-urllib/3.x", and every call fell back
            # to the slow local Whisper (measured 6 Oct 2026).
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "User-Agent": "Mori/0.1",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")[:300]
            if e.code == 429 and attempt < 3:
                # The provider says how long; past two minutes the local
                # Whisper is the faster way, so give up and let it run.
                wait = float(e.headers.get("retry-after") or 20)
                if wait > 120:
                    raise CloudError(f"free limit reached ({text})")
                time.sleep(wait + 0.5)
                continue
            if e.code >= 500 and attempt < 2:
                time.sleep(3)
                continue
            raise CloudError(f"HTTP {e.code}: {text}")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            if attempt < 2:
                time.sleep(3)
                continue
            raise CloudError(f"network: {e}")
    raise CloudError("no answer")


def transcribe_channel(path, speaker, ctx, progress, done_before):
    audio = decode_audio(path, sampling_rate=RATE)
    out, lang = [], None
    done = done_before
    for samples, spans in pieces(audio):
        res = post(ctx["url"], ctx["key"], ctx["model"], ctx["prompt"], ctx["language"], flac_bytes(samples))
        lang = lang or res.get("language")
        for s in res.get("segments") or []:
            text = (s.get("text") or "").strip()
            if not text:
                continue
            out.append({
                "start": round(to_original(float(s.get("start", 0)), spans), 2),
                "end": round(to_original(float(s.get("end", 0)), spans), 2),
                "speaker": speaker,
                "text": text,
            })
        if not res.get("segments") and (res.get("text") or "").strip():
            out.append({"start": round(spans[0][1], 2), "end": round(spans[-1][1] + spans[-1][2], 2), "speaker": speaker, "text": res["text"].strip()})
        done += sum(sp[2] for sp in spans)
        progress.at(done)
    return out, lang, done


def main() -> int:
    argv, progress_path = pop_progress_flag(sys.argv[1:])
    args, vocab, context = parse_flags(argv)
    ctx = {
        "url": os.environ.get("MORI_STT_URL", "").strip(),
        "key": os.environ.get("MORI_STT_KEY", "").strip(),
        "model": os.environ.get("MORI_STT_MODEL", "").strip() or "whisper-large-v3-turbo",
        "prompt": build_prompt(vocab, context),
        "language": os.environ.get("MORI_STT_LANGUAGE", "").strip() or None,
    }
    if not ctx["url"] or not ctx["key"] or not args:
        print("cloud: endpoint, key or audio missing", file=sys.stderr)
        return 3
    diarized = len(args) >= 2 and args[1].lower().endswith(".wav") and os.path.exists(args[1])
    channels = [(args[0], "Tu"), (args[1], "Interlocutore")] if diarized else [(args[0], "")]

    progress = Progress(progress_path)
    # Progress is measured in speech seconds: the length of what is uploaded.
    # The VAD runs again inside transcribe_channel; it takes a second or two.
    total = 0.0
    for path, _ in channels:
        for _, spans in pieces(decode_audio(path, sampling_rate=RATE)):
            total += sum(sp[2] for sp in spans)
    progress.total = total
    progress.run()

    try:
        segs, lang, done = [], None, 0.0
        for path, speaker in channels:
            s, l, done = transcribe_channel(path, speaker, ctx, progress, done)
            segs += s
            lang = lang or l
    except CloudError as e:
        print(f"cloud: {e}", file=sys.stderr)
        return 3

    segs.sort(key=lambda x: x["start"])
    if diarized:
        turns = []
        for s in segs:
            if turns and turns[-1][0] == s["speaker"]:
                turns[-1][1] += " " + s["text"]
            else:
                turns.append([s["speaker"], s["text"]])
        text = "\n".join(f"{spk}: {t}" for spk, t in turns).strip()
    else:
        text = " ".join(s["text"] for s in segs).strip()
    print(json.dumps({"text": text, "language": lang or "", "segments": segs, "engine": "cloud"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # anything unexpected: let the local Whisper do it
        print(f"cloud: {type(e).__name__}: {e}", file=sys.stderr)
        raise SystemExit(3)
