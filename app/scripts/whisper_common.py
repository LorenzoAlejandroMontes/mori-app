"""How Mori runs Whisper on the CPU, shared by transcribe.py and
transcribe_diarized.py. Tuned for speed on an ordinary laptop, measured on the
choices faster-whisper documents:

- greedy decoding (beam_size=1): about twice as fast as a 5-wide beam, for a
  word error rate that moves by a fraction of a point on large-v3-turbo;
- batched inference over the speech found by VAD (BatchedInferencePipeline):
  several stretches decoded at once, up to twice as fast again — but only with
  enough cores to feed it (and ~2 GB more RAM), so it is used from 8 up;
- no conditioning on the previous text: faster, and it stops the loops where
  Whisper repeats one sentence for minutes over a noisy stretch;
- more threads than before: the process runs at idle priority, so the OS gives
  the cores back to whatever the user is doing the moment they are needed.

If the batched pipeline is missing (older faster-whisper) or fails, the plain
sequential path runs instead: slower, never broken.
"""
import os, sys

from faster_whisper import WhisperModel

try:
    from faster_whisper import BatchedInferencePipeline
except Exception:  # faster-whisper < 1.1
    BatchedInferencePipeline = None

# Idle priority already yields to the user's apps: leave two logical cores free
# for the UI and audio, use the rest (CTranslate2 gains little past 8).
CPU_THREADS = max(2, min(8, (os.cpu_count() or 4) - 2))
BATCH_SIZE = 8
BATCHED = (os.cpu_count() or 4) >= 8 and os.environ.get("MORI_WHISPER_BATCHED", "1") != "0"


def load(model_size: str) -> WhisperModel:
    return WhisperModel(model_size, device="cpu", compute_type="int8", cpu_threads=CPU_THREADS)


def transcribe(model: WhisperModel, path: str, language, prompt: str):
    """(segments generator, info), batched when possible."""
    if BatchedInferencePipeline is not None and BATCHED:
        try:
            pipe = BatchedInferencePipeline(model=model)
            return pipe.transcribe(
                path,
                language=language,
                batch_size=BATCH_SIZE,
                beam_size=1,
                initial_prompt=prompt,
                vad_filter=True,
            )
        except Exception as e:  # pragma: no cover - depends on the installed version
            print(f"batched not available, going sequential: {e}", file=sys.stderr)
    return model.transcribe(
        path,
        language=language,
        vad_filter=True,
        beam_size=1,
        initial_prompt=prompt,
        condition_on_previous_text=False,
    )
