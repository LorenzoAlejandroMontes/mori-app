"""Local Whisper transcription for Mori (free, private, offline via faster-whisper).
Usage: python transcribe.py <audio_path> [model_size] [language] [--vocab "names"] [--context "sentence"] [--progress file]
Prints ONE JSON object on stdout:
  {"text": "<plain dialogue text>", "language": "it", "segments": [{start,end,speaker,text}]}
`text` keeps the exact plain format callers relied on before (space-joined segments),
so anything ignoring `segments` still works. Model is downloaded once and cached.
"""
import sys, os, json
from whisper_common import load, transcribe as whisper_transcribe
from progress_file import Progress, pop_progress_flag


# Windows consoles default to cp1252; Whisper can emit any Unicode (even stray
# CJK on noisy audio). Force UTF-8 so print() never crashes on the transcript.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# Vocabulary hint: biases Whisper toward the recurring proper nouns / jargon of
# the user's world, which the model otherwise mangles. A neutral start: it only
# says this is a work conversation. What the user's world sounds like comes at
# runtime, never baked into the product:
#   --context "free sentence about what they usually talk about" (Settings)
#   --vocab   "the people and projects they talk to and about" (dictionary)
BASE_PROMPT = "Conversazione di lavoro."


def parse_flags(argv):
    """Pull the optional `--vocab "a, b"` and `--context "..."` flags out of argv.
    Returns (positional args, vocab, context)."""
    flags = {"--vocab": "", "--context": ""}
    rest = []
    i = 0
    while i < len(argv):
        if argv[i] in flags and i + 1 < len(argv):
            flags[argv[i]] = argv[i + 1]
            i += 2
        else:
            rest.append(argv[i])
            i += 1
    return rest, flags["--vocab"], flags["--context"]


def build_prompt(vocab: str, context: str = "") -> str:
    """Whisper reads only the last ~224 tokens of the prompt: keep it short."""
    base = " ".join(context.split())[:300] or BASE_PROMPT
    if not base.endswith((".", "!", "?")):
        base += "."
    names = ", ".join(n.strip() for n in vocab.split(",") if n.strip())[:400]
    if names:
        return f"{base} Persone e progetti: {names}."
    return base


def main() -> int:
    argv, progress_path = pop_progress_flag(sys.argv[1:])
    args, vocab, context = parse_flags(argv)
    if len(args) < 1:
        print("usage: transcribe.py <audio_path> [model_size] [language] [--vocab names] [--context sentence]", file=sys.stderr)
        return 2
    audio = args[0]
    model_size = args[1] if len(args) > 1 else "medium"
    language = args[2] if len(args) > 2 else "auto"
    # Keep the ORIGINAL spoken language: auto-detect unless an explicit one is given.
    lang = None if language in ("auto", "") else language
    prompt = build_prompt(vocab, context)
    progress = Progress(progress_path)

    model = load(model_size)
    segments, info = whisper_transcribe(model, audio, lang, prompt)

    # transcribe() has decoded the audio, so its length is known: segments are
    # produced lazily from here on, and each one moves the line forward.
    progress.run(float(getattr(info, "duration", 0) or 0))

    seg_list = []
    texts = []
    for seg in segments:
        progress.at(float(seg.end))
        t = seg.text.strip()
        if not t:
            continue
        texts.append(t)
        seg_list.append({
            "start": round(float(seg.start), 2),
            "end": round(float(seg.end), 2),
            "speaker": "",
            "text": t,
        })

    text = " ".join(texts).strip()
    out = {
        "text": text,
        "language": getattr(info, "language", None) or (lang or ""),
        "segments": seg_list,
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
