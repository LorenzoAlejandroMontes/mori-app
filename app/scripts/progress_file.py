"""How far a transcription has got, for the app to show a live line and an ETA.

Whisper hands segments over one by one, each with its end time in the audio:
that time over the audio's length is the progress. The file is rewritten
atomically (temp + rename) so the app never reads half a JSON:

  {"stage": "load" | "run", "done": <audio s>, "total": <audio s>,
   "started": <epoch s when "run" began>, "t": <epoch s of this write>}

"load" is the model coming up (the first time it is also the download): there
is no length yet, so the app shows it as indeterminate. The ETA is the app's
job — it knows the clock — this only says where Whisper is.
"""
import json, os, time, wave


class Progress:
    def __init__(self, path: str, total: float = 0.0):
        self.path = path
        self.total = float(total or 0.0)
        self.started = 0.0
        self.last = 0.0
        self._write("load", 0.0, force=True)

    def run(self, total: float = 0.0) -> None:
        """The audio is decoded and Whisper is about to start: the clock starts."""
        if total and not self.total:
            self.total = float(total)
        if not self.started:
            self.started = time.time()
        self._write("run", 0.0, force=True)

    def at(self, done: float) -> None:
        # The last piece always lands, even inside the half-second throttle.
        self._write("run", done, force=bool(self.total) and done >= self.total)

    def _write(self, stage: str, done: float, force: bool = False) -> None:
        if not self.path:
            return
        now = time.time()
        # Twice a second is plenty for a line on screen, and keeps the disk quiet.
        if not force and now - self.last < 0.5:
            return
        self.last = now
        data = {
            "stage": stage,
            "done": round(max(0.0, min(done, self.total or done)), 2),
            "total": round(self.total, 2),
            "started": self.started,
            "t": now,
        }
        tmp = self.path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(tmp, self.path)
        except OSError:
            pass  # progress is a courtesy: never fail a transcription over it


def wav_seconds(path: str) -> float:
    """Length of a WAV without decoding it; 0 when it is not a plain WAV."""
    try:
        with wave.open(path, "rb") as w:
            rate = w.getframerate()
            return w.getnframes() / float(rate) if rate else 0.0
    except Exception:
        return 0.0


def pop_progress_flag(argv):
    """Take `--progress <path>` out of argv. Returns (rest, path or "")."""
    rest, path, i = [], "", 0
    while i < len(argv):
        if argv[i] == "--progress" and i + 1 < len(argv):
            path = argv[i + 1]
            i += 2
        else:
            rest.append(argv[i])
            i += 1
    return rest, path
