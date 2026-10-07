"""Record a call for Mori: microphone (you) + system audio loopback (the others).

Data-safety design (calls can run an hour+ and MUST NOT be lost):
  - Each stream is written to a raw PCM file on disk CONTINUOUSLY as it arrives
    (bounded RAM, not the whole call in memory). If the process dies mid-call,
    the audio captured so far is already on disk (<out>.mic.pcm / <out>.sys.pcm).
  - Writes <out>.started once the recorder threads are live (caller treats a
    missing .started as "recording did not start" and errors loudly).
  - Each stream fails independently: a busy mic never kills the call — the
    loopback (everyone else) keeps recording, and vice-versa.
  - At stop: mixes the two streams into the final mono 16kHz <out> WAV, writes
    <out>.done, and removes the raw PCM. On a crash, writes <out>.error.

Gap-free capture (fixed 2026-09-18). A 75-minute call logged 174 "data
discontinuity in recording" warnings: WASAPI had overwritten capture buffer
content before we read it. Three causes, three fixes:
  - the device buffer was soundcard's default = ONE device period (~10 ms). We
    now ask for seconds of buffer (DEVICE_BUFFER_SECONDS), falling back if the
    driver refuses;
  - we read 0.25 s at a time, so any hiccup was a lost block. We now read a
    whole second;
  - the capture thread wrote to disk itself, so every file write was time the
    buffer kept filling. Writes now happen on a separate thread behind an
    unbounded queue, and the capture threads run at raised priority.

Silence contract (consumed by the auto-stop feature): every ~5 s the file
<out_wav>.silence holds a plain-text integer = seconds of CONTINUOUS silence on
BOTH channels (0 as soon as either one has signal). It is removed at stop.

Levels contract (the live "two voices" and the dead-channel warning): every
~0.4 s <out_wav>.levels holds JSON
  {"mic": rms, "sys": rms, "mic_quiet": s, "sys_quiet": s, "errs": [...]}
— the last block's loudness per channel, seconds since each last had signal,
and any capture thread that died (a device unplugged mid-call). Removed at stop.

Usage: python record.py <out_wav> <stop_file> [max_seconds]
"""
import sys, os, time, threading, queue, wave, traceback
import numpy as np
import soundcard as sc

SR = 16000
BLOCK_SECONDS = 1.0            # how much audio we pull per read
DEVICE_BUFFER_SECONDS = (2.0, 1.0, 0.5, None)  # None = soundcard's default
SILENCE_RMS = 0.01             # below this a block counts as silence
SILENCE_TICK = 5.0             # how often <out>.silence is refreshed
LEVELS_TICK = 0.4              # how often <out>.levels is refreshed


def boost_process():
    """Recording must not lose to a background build. Above-normal, not realtime."""
    try:
        import ctypes
        k = ctypes.windll.kernel32
        k.SetPriorityClass(k.GetCurrentProcess(), 0x00008000)  # ABOVE_NORMAL_PRIORITY_CLASS
    except Exception:
        pass


def boost_thread():
    try:
        import ctypes
        k = ctypes.windll.kernel32
        k.SetThreadPriority(k.GetCurrentThread(), 2)  # THREAD_PRIORITY_HIGHEST
    except Exception:
        pass


def open_recorder(dev):
    """Open with the largest device buffer the driver accepts."""
    last = None
    for secs in DEVICE_BUFFER_SECONDS:
        try:
            blocksize = None if secs is None else int(SR * secs)
            rec = dev.recorder(samplerate=SR, blocksize=blocksize)
            rec.__enter__()
            return rec
        except Exception as e:  # driver refused this buffer size
            last = e
    raise last if last else RuntimeError("nessun buffer accettato")


def rec_loop(get_device, q, stop, label, errs, last_signal, last_rms=None):
    """Capture only: measure the level, hand the bytes to the writer, read again."""
    rec = None
    try:
        dev = get_device()
        boost_thread()
        rec = open_recorder(dev)
        frames = int(SR * BLOCK_SECONDS)
        while not stop.is_set():
            data = rec.record(numframes=frames)
            mono = data.mean(axis=1) if data.ndim > 1 else data
            rms = float(np.sqrt(np.mean(np.square(mono)))) if mono.size else 0.0
            if last_rms is not None:
                last_rms[label] = rms
            if rms > SILENCE_RMS:
                last_signal[label] = time.time()
            q.put((np.clip(mono, -1.0, 1.0) * 32767).astype("<i2").tobytes())
    except Exception as e:
        errs.append(f"{label}: {e}")
    finally:
        if rec is not None:
            try:
                rec.__exit__(None, None, None)
            except Exception:
                pass
        q.put(None)  # tell the writer this stream is over


def write_loop(path, q):
    """The only thread that touches the disk for this stream."""
    with open(path, "wb", buffering=1 << 20) as f:
        while True:
            item = q.get()
            if item is None:
                break
            f.write(item)
        f.flush()
        try:
            os.fsync(f.fileno())
        except OSError:
            pass


def silence_loop(out, stop, last_signal):
    """Publish seconds of continuous silence on BOTH channels, atomically."""
    path = out + ".silence"
    tmp = path + ".tmp"
    while not stop.wait(SILENCE_TICK):
        quiet_for = max(0, int(time.time() - max(last_signal.values())))
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(str(quiet_for))
            os.replace(tmp, path)
        except OSError:
            pass  # the contract is best-effort; recording matters more


def levels_loop(out, stop, last_signal, last_rms, errs):
    """Publish each channel's loudness and quiet time, atomically, for the UI."""
    import json

    path = out + ".levels"
    tmp = path + ".tmp"
    while not stop.wait(LEVELS_TICK):
        now = time.time()
        data = {
            "mic": round(last_rms.get("mic", 0.0), 4),
            "sys": round(last_rms.get("sys", 0.0), 4),
            "mic_quiet": int(now - last_signal["mic"]),
            "sys_quiet": int(now - last_signal["sys"]),
            "errs": list(errs),
        }
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(tmp, path)
        except OSError:
            pass  # best-effort: recording matters more


def read_pcm(path):
    try:
        with open(path, "rb") as f:
            return np.frombuffer(f.read(), dtype="<i2").astype("float32") / 32767.0
    except Exception:
        return np.zeros(0, dtype="float32")


def write_wav(path, arr):
    pcm = (np.clip(arr, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main() -> int:
    out, stopfile = sys.argv[1], sys.argv[2]
    maxsecs = int(sys.argv[3]) if len(sys.argv) > 3 else 14400  # 4h cap
    errs = []
    mic_pcm, sys_pcm = out + ".mic.pcm", out + ".sys.pcm"

    boost_process()

    def get_mic():
        return sc.default_microphone()

    def get_loopback():
        spk = sc.default_speaker()
        return sc.get_microphone(id=str(spk.name), include_loopback=True)

    stop = threading.Event()
    t0 = time.time()
    last_signal = {"mic": t0, "sys": t0}
    last_rms = {"mic": 0.0, "sys": 0.0}
    mic_q, sys_q = queue.Queue(), queue.Queue()  # unbounded: capture never waits

    threads = [
        threading.Thread(target=write_loop, args=(mic_pcm, mic_q), daemon=True),
        threading.Thread(target=write_loop, args=(sys_pcm, sys_q), daemon=True),
        threading.Thread(target=rec_loop, args=(get_mic, mic_q, stop, "mic", errs, last_signal, last_rms), daemon=True),
        threading.Thread(target=rec_loop, args=(get_loopback, sys_q, stop, "sys", errs, last_signal, last_rms), daemon=True),
        threading.Thread(target=silence_loop, args=(out, stop, last_signal), daemon=True),
        threading.Thread(target=levels_loop, args=(out, stop, last_signal, last_rms, errs), daemon=True),
    ]
    for t in threads:
        t.start()

    open(out + ".started", "w").close()

    start = time.time()
    while not os.path.exists(stopfile) and time.time() - start < maxsecs:
        time.sleep(0.2)
    stop.set()
    for t in threads:
        t.join(timeout=10)

    for p in (out + ".silence", out + ".silence.tmp", out + ".levels", out + ".levels.tmp"):
        try:
            os.remove(p)
        except OSError:
            pass

    m, l = read_pcm(mic_pcm), read_pcm(sys_pcm)
    n = max(len(m), len(l), 1)
    m = np.pad(m, (0, n - len(m)))
    l = np.pad(l, (0, n - len(l)))

    # Two separate channel WAVs for speaker separation (you vs the others),
    # plus a mixed WAV for playback / fallback.
    write_wav(out + ".mic.wav", m)
    write_wav(out + ".sys.wav", l)
    write_wav(out, np.clip(m * 0.92 + l * 0.92, -1.0, 1.0))

    open(out + ".done", "w").close()
    for p in (mic_pcm, sys_pcm):
        try:
            os.remove(p)
        except OSError:
            pass

    if errs:
        sys.stderr.write("; ".join(errs) + "\n")
    print(f"saved {out} ({round(n / SR, 1)}s) mic_ok={len(m) > 1} loopback_ok={len(l) > 1}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        tb = traceback.format_exc()
        sys.stderr.write(tb)
        try:
            open(sys.argv[1] + ".error", "w").write(tb)
        except Exception:
            pass
        raise SystemExit(1)
