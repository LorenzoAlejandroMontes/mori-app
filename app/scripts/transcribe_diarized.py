"""Speaker-separated transcription for Mori: "Tu" (your mic) vs "Interlocutore"
(system audio = everyone else). Transcribes the two channel WAVs separately,
tags each segment with its speaker, and merges them in chronological order into
a dialogue transcript. VAD skips silence, so two passes cost ~one call's speech.

Usage: python transcribe_diarized.py <mic_wav> <sys_wav> [model_size] [language] [--vocab "names"] [--context "sentence"] [--progress file]
Prints ONE JSON object on stdout:
  {"text": "Tu: ...\\nInterlocutore: ...", "language": "it",
   "segments": [{start,end,speaker,text}, ...]}
`text` is byte-identical to the plain dialogue format used before (turns merged
per speaker, one per line), so anything ignoring `segments` still works.
"""
import sys, os, json, traceback
from whisper_common import load, transcribe as whisper_transcribe
from progress_file import Progress, pop_progress_flag, wav_seconds


try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# A neutral start: it only tells Whisper this is a work conversation. What the
# user's world sounds like comes at runtime, never baked into the product:
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


def segs_for(model, path, speaker, language, prompt, progress=None, offset=0.0):
    """`offset` is how much audio the passes before this one covered: the two
    channels are one line on screen, the mic first and then the system audio."""
    segments, info = whisper_transcribe(model, path, language, prompt)
    if progress:
        progress.run()
    out = []
    for s in segments:
        if progress:
            progress.at(offset + float(s.end))
        t = s.text.strip()
        if t:
            out.append({
                "start": round(float(s.start), 2),
                "end": round(float(s.end), 2),
                "speaker": speaker,
                "text": t,
            })
    return out, getattr(info, "language", None)


def main() -> int:
    argv, progress_path = pop_progress_flag(sys.argv[1:])
    args, vocab, context = parse_flags(argv)
    mic, sysw = args[0], args[1]
    model_size = args[2] if len(args) > 2 else "medium"
    language = args[3] if len(args) > 3 else "auto"
    # Keep each speaker's ORIGINAL language (auto-detect per channel).
    lang = None if language in ("auto", "") else language
    prompt = build_prompt(vocab, context)
    # Both channels are as long as the call: their sum is the whole line.
    mic_len = wav_seconds(mic)
    progress = Progress(progress_path, mic_len + wav_seconds(sysw))

    model = load(model_size)
    mic_segs, mic_lang = segs_for(model, mic, "Tu", lang, prompt, progress, 0.0)
    sys_segs, sys_lang = segs_for(model, sysw, "Interlocutore", lang, prompt, progress, mic_len)

    segs = mic_segs + sys_segs
    segs.sort(key=lambda x: x["start"])

    # Merge consecutive segments from the same speaker into one turn (for `text`).
    turns = []
    for s in segs:
        if turns and turns[-1][0] == s["speaker"]:
            turns[-1][1] += " " + s["text"]
        else:
            turns.append([s["speaker"], s["text"]])

    text = "\n".join(f"{spk}: {t}" for spk, t in turns).strip()
    out = {
        "text": text,
        "language": mic_lang or sys_lang or (lang or ""),
        "segments": segs,
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        sys.stderr.write(traceback.format_exc())
        raise SystemExit(1)
