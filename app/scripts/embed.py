"""Local text-embedding sidecar for Mori (free, private, offline via fastembed/ONNX).
No torch: fastembed runs the model on onnxruntime, which is already in the venv.

Two ways to run it:

  python embed.py [--mode passage|query]
      One shot. Reads a JSON array of strings from STDIN, prints a JSON array
      of float arrays (one 384-dim vector per input) to STDOUT.

  python embed.py --serve
      Stays alive so the model is loaded ONCE. Each request is one line of JSON
      on STDIN: {"texts": [...], "mode": "query"}; each answer is one line on
      STDOUT: {"ok": true, "vectors": [[...], ...]} or {"ok": false, "error": "..."}.
      Exits when STDIN closes (Mori quit or crashed — no orphan process) or
      after MORI_EMBED_IDLE seconds without a request (default 600), to give
      the RAM back; Mori starts it again on the next question.

Everything else (progress, logs) goes to STDERR so STDOUT stays parseable.

Model: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 (384 dims,
multilingual incl. Italian, ~120 MB, ONNX). The spec named intfloat/multilingual-
e5-small, but fastembed 0.8 does not ship an e5-*small* build (only e5-large,
1024 dims). This MiniLM model matches every stated constraint (small, multilingual,
384-dim, torch-free) and — unlike E5 — is symmetric, so we do NOT add the
"query:"/"passage:" prefixes (they would degrade a MiniLM model). The --mode flag
is still accepted so the Rust/TS callers keep a stable interface.

MORI_EMBED_FAKE=1 replaces the model with deterministic hash vectors: only for
tests of the process plumbing, never set by the app.
"""
import sys, os, json, queue, threading, hashlib

# Keep any library chatter off STDOUT.
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
DIMS = 384


def cache_dir() -> str:
    base = os.environ.get("USERPROFILE") or os.environ.get("HOME") or "."
    d = os.path.join(base, ".mori", "models")
    os.makedirs(d, exist_ok=True)
    return d


class FakeModel:
    """Deterministic stand-in for tests: same text, same vector."""

    def embed(self, texts):
        for t in texts:
            h = hashlib.sha256(t.encode("utf-8")).digest()
            yield [((h[i % len(h)] / 255.0) - 0.5) for i in range(DIMS)]


def load_model():
    if os.environ.get("MORI_EMBED_FAKE") == "1":
        return FakeModel()
    from fastembed import TextEmbedding

    return TextEmbedding(model_name=MODEL, cache_dir=cache_dir())


def embed_with(model, texts):
    return [list(map(float, v)) for v in model.embed(texts)]


def clean(texts):
    if not isinstance(texts, list):
        return []
    return [str(t) for t in texts]


def one_shot() -> int:
    raw = sys.stdin.read()
    try:
        texts = clean(json.loads(raw) if raw.strip() else [])
    except Exception:
        texts = []
    if not texts:
        print("[]")
        return 0
    print(json.dumps(embed_with(load_model(), texts)))
    return 0


def serve() -> int:
    idle = float(os.environ.get("MORI_EMBED_IDLE", "600"))
    lines: "queue.Queue[str | None]" = queue.Queue()

    def reader():
        # A thread, because on Windows a pipe cannot be waited on with a timeout.
        for line in sys.stdin:
            lines.put(line)
        lines.put(None)  # EOF: the app is gone

    # The model is loaded (and run once) BEFORE the reader thread exists. On
    # Windows a thread blocked reading the stdin pipe makes the load of numpy's
    # native library wait on that same pipe: with the reader already running the
    # server never answered, and every call sat 30 minutes behind it (6 Oct 2026).
    model, load_error = None, None
    try:
        model = load_model()
        embed_with(model, ["."])
    except Exception as e:
        load_error = f"{type(e).__name__}: {e}"

    threading.Thread(target=reader, daemon=True).start()
    while True:
        try:
            line = lines.get(timeout=idle)
        except queue.Empty:
            return 0  # idle: give the memory back, Mori restarts us on demand
        if line is None:
            return 0
        if not line.strip():
            continue
        if model is None:
            # Say why and leave: Mori starts a fresh server on the next request.
            sys.stdout.write(json.dumps({"ok": False, "error": load_error}) + "\n")
            sys.stdout.flush()
            return 1
        try:
            req = json.loads(line)
            texts = clean(req.get("texts"))
            out = {"ok": True, "vectors": embed_with(model, texts) if texts else []}
        except Exception as e:  # a bad request or a model error: answer, don't die
            out = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


def main() -> int:
    argv = sys.argv[1:]
    if "--serve" in argv:
        return serve()
    # --mode is accepted (passage|query) but intentionally unused for this model.
    return one_shot()


if __name__ == "__main__":
    raise SystemExit(main())
