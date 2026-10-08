mod companion;
mod maintenance;
mod platform;
mod pyenv;

use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

pub(crate) use platform::ChildFlags;

#[derive(serde::Serialize)]
struct RecPaths {
    wav: String,
    stop: String,
}

/// Tauri's resource dir, set once at startup. An installed Mori ships its
/// Python scripts there (`bundle.resources` in tauri.conf.json).
static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Every directory that may hold Mori's `scripts/` (and its `.venv`), most
/// specific first.
///
/// The old answer was only `CARGO_MANIFEST_DIR/..`: an absolute path pinned at
/// COMPILE time. A release exe therefore stopped recording as soon as the
/// folder it was built in moved or was deleted (a worktree, a copy on another
/// PC). The compile-time folder stays first so development keeps using the
/// live scripts, but it is no longer the only place looked at.
fn app_dir_candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    // 1. Explicit override, for unusual installs.
    if let Ok(p) = std::env::var("MORI_APP_DIR") {
        if !p.trim().is_empty() {
            out.push(PathBuf::from(p.trim()));
        }
    }
    // 2. The checkout this binary was built from (development).
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(parent) = manifest.parent() {
        out.push(parent.to_path_buf());
    }
    // 3. An installed bundle: the scripts travel as resources.
    if let Some(res) = RESOURCE_DIR.get() {
        out.push(res.clone());
    }
    // 4. A copied exe: next to it, or a few folders above it.
    if let Ok(exe) = std::env::current_exe() {
        for dir in exe.ancestors().skip(1).take(4) {
            out.push(dir.to_path_buf());
        }
    }
    out
}

/// The first candidate that really contains the recorder script.
fn app_dir() -> PathBuf {
    let candidates = app_dir_candidates();
    candidates
        .iter()
        .find(|d| d.join("scripts").join("record.py").is_file())
        .cloned()
        .or_else(|| candidates.into_iter().next())
        .unwrap_or_else(|| PathBuf::from("."))
}

/// The ONE stable database URL, fixed regardless of how the app is launched.
/// Tauri's default app-data dir varies by launch context (normal vs sandboxed),
/// which scattered data across DBs and lost recordings. Pinning it under the
/// user profile (`~/.mori/mori.db`) guarantees a single source of truth.
fn db_url() -> String {
    let dir = platform::mori_dir();
    let _ = std::fs::create_dir_all(&dir);
    format!("sqlite:{}", dir.join("mori.db").to_string_lossy())
}

#[tauri::command]
fn get_db_url() -> String {
    db_url()
}

fn scripts_dir() -> PathBuf {
    app_dir().join("scripts")
}

/// Resolve a Python interpreter that can actually `import soundcard, numpy`.
/// Windows ships a Store stub `python.exe` with no packages; picking whatever is
/// first on PATH silently breaks recording. So we probe candidates and cache the
/// first that works. Returns the argv prefix (program + leading args).
fn python_cmd() -> Vec<String> {
    // Only a Python that works is remembered: after the first-run setup
    // (pyenv.rs) has made `~/.mori/venv`, the next call finds it.
    let mut cache = PYTHON.lock().unwrap();
    if let Some(found) = cache.as_ref() {
        return found.clone();
    }
    match find_python() {
        Some(found) => {
            *cache = Some(found.clone());
            found
        }
        None => platform::system_pythons().into_iter().next().unwrap_or_else(|| vec!["python".into()]),
    }
}

static PYTHON: Mutex<Option<Vec<String>>> = Mutex::new(None);

/// The first interpreter that can import the recorder's modules, or None.
fn find_python() -> Option<Vec<String>> {
    // Prefer a dedicated venv (self-contained, doesn't depend on
    // user-site or which python is first on PATH): the one next to the
    // scripts, then `~/.mori/venv`. Fall back to the system Python.
    let mut candidates: Vec<Vec<String>> = Vec::new();
    let mut venvs: Vec<PathBuf> = app_dir_candidates().iter().map(|d| d.join(".venv")).collect();
    venvs.push(pyenv::venv_dir());
    for v in venvs {
        let py = platform::venv_python(&v);
        if py.is_file() {
            candidates.push(vec![py.to_string_lossy().into_owned()]);
        }
    }
    // A packaged Mac app makes its own environment instead of trying
    // `python3`: on a Mac without the developer tools that name is a stub
    // that opens an "install the command line tools" dialog.
    if !(cfg!(target_os = "macos") && pyenv::bundled_uv().is_some()) {
        candidates.extend(platform::system_pythons());
    }
    candidates.into_iter().find(|c| {
        Command::new(&c[0])
            .no_window()
            .args(&c[1..])
            .arg("-c")
            .arg("import soundcard, numpy")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
}

/// Whether the Python side is usable, and whether Mori can prepare it itself.
#[derive(serde::Serialize)]
struct EnvStatus {
    ready: bool,
    can_prepare: bool,
}

#[tauri::command]
async fn python_env_status() -> Result<EnvStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let ready = PYTHON.lock().unwrap().is_some() || find_python().is_some();
        EnvStatus { ready, can_prepare: pyenv::bundled_uv().is_some() }
    })
    .await
    .map_err(|e| format!("task failed: {e}"))
}

/// First launch of a packaged Mori: make `~/.mori/venv` with the bundled uv.
/// Progress goes out as `setup://progress` events.
#[tauri::command]
async fn prepare_python_env(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        pyenv::prepare(&app, &app_dir().join("requirements.txt"))?;
        *PYTHON.lock().unwrap() = None;
        match find_python() {
            Some(_) => Ok(()),
            None => Err("The environment was prepared but Python still does not start".to_string()),
        }
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

pub(crate) fn py_command(script: &str) -> Command {
    let prefix = python_cmd();
    let mut cmd = Command::new(&prefix[0]);
    cmd.args(&prefix[1..]);
    cmd.arg(scripts_dir().join(script));
    // Force UTF-8 I/O so Whisper's Unicode output never crashes on Windows cp1252.
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.env("PYTHONUTF8", "1");
    // L'exe release non ha console: senza questo ogni script (record.py per
    // primo) apriva una finestra del terminale visibile. Chi vuole anche la
    // priorità bassa chiama `idle_no_window()` sopra.
    cmd.no_window();
    cmd
}

/// Start recording mic + system audio to a temp WAV. Returns the paths the
/// frontend passes back to stop_recording. Non-blocking (spawns record.py).
fn start_recording_impl() -> Result<RecPaths, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let tmp = std::env::temp_dir();
    let wav = tmp.join(format!("mori_rec_{stamp}.wav"));
    let stop = tmp.join(format!("mori_rec_{stamp}.stop"));
    let wav_s = wav.to_string_lossy().into_owned();

    // Clear any stale markers from a previous attempt.
    for ext in ["stop", "wav.done", "wav.started", "wav.error"] {
        let _ = std::fs::remove_file(tmp.join(format!("mori_rec_{stamp}.{ext}")));
    }

    // Capture the recorder's stdout/stderr so a crash is diagnosable, not silent.
    let log = tmp.join(format!("mori_rec_{stamp}.log"));
    let out_log = std::fs::File::create(&log).map_err(|e| e.to_string())?;
    let err_log = out_log.try_clone().map_err(|e| e.to_string())?;

    let mut child = py_command("record.py")
        .arg(&wav)
        .arg(&stop)
        .arg("14400")
        .stdout(out_log)
        .stderr(err_log)
        .spawn()
        .map_err(|e| format!("The recording could not start: {e}"))?;

    // Wait for the recorder to actually come up (imports OK, threads live).
    // If it never signals, recording did NOT start — surface it NOW, not after the call.
    let started = PathBuf::from(format!("{wav_s}.started"));
    let error = PathBuf::from(format!("{wav_s}.error"));
    let mut waited = 0;
    while !started.exists() && !error.exists() && waited < 100 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        waited += 1;
    }
    if !started.exists() {
        // Si sta per dire all'utente "non è partita": che sia vero. Un record.py
        // solo lento partirebbe dopo e registrerebbe fino a 4 ore senza che
        // nessuno abbia i percorsi per fermarlo. Il file di stop lo chiude se
        // arriva al suo ciclo; kill chiude il processo lanciato.
        let _ = std::fs::write(&stop, b"");
        let _ = child.kill();
        let detail = std::fs::read_to_string(&log).unwrap_or_default();
        let detail = detail.trim();
        let detail = if detail.is_empty() { "no output" } else { detail };
        return Err(format!(
            "The recording did not start (the audio engine did not come up). Details: {detail}"
        ));
    }

    Ok(RecPaths {
        wav: wav_s,
        stop: stop.to_string_lossy().into_owned(),
    })
}

/// Stop recording (signal record.py), wait for the WAV, transcribe it locally
/// with Whisper, and return the transcript text.
/// Stop the recorder and wait ONLY until the WAV is fully written to disk, then
/// return its path. Transcription is NOT done here — it runs separately via
/// transcribe_file so a long call never blocks the app.
fn stop_recording_impl(wav: String, stop: String) -> Result<String, String> {
    std::fs::write(&stop, b"").map_err(|e| format!("Could not stop the recording: {e}"))?;

    let done = PathBuf::from(format!("{wav}.done"));
    let error = PathBuf::from(format!("{wav}.error"));
    let mut waited = 0;
    // A long call's final mix write can take a while; wait up to 180s.
    while !done.exists() && !error.exists() && waited < 1800 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        waited += 1;
    }
    let _ = std::fs::remove_file(&stop);

    if error.exists() {
        let detail = std::fs::read_to_string(&error).unwrap_or_default();
        return Err(format!("The recording was cut short by an error: {}", detail.trim()));
    }
    if !done.exists() {
        if PathBuf::from(&wav).exists() {
            return Ok(wav); // WAV exists though the marker is late — proceed, don't lose it.
        }
        return Err("The recording did not close in time".into());
    }
    Ok(wav)
}

/// Where kept recordings live, so they can be played back later. One dir under
/// the user profile, next to the DB (`~/.mori/audio/`), created on demand.
fn audio_dir() -> PathBuf {
    let dir = platform::mori_dir().join("audio");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Escape a Windows path for safe embedding inside a JSON string literal we build
/// by hand (Rust must not parse the Python JSON, so we concat the wrapper).
fn json_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Move the finished mix WAV into `~/.mori/audio/<stamp>.wav` so it survives for
/// playback. `stamp` comes from the temp filename `mori_rec_<stamp>.wav`. Falls
/// back to copy+delete if a plain rename fails (e.g. across volumes). Returns the
/// kept path, or the original path if the move could not be done.
fn keep_audio(wav: &str) -> String {
    let src = PathBuf::from(wav);
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let stamp = stem.strip_prefix("mori_rec_").unwrap_or(&stem);
    let dest = audio_dir().join(format!("{stamp}.wav"));
    if std::fs::rename(&src, &dest).is_ok() {
        return dest.to_string_lossy().into_owned();
    }
    if std::fs::copy(&src, &dest).is_ok() {
        let _ = std::fs::remove_file(&src);
        return dest.to_string_lossy().into_owned();
    }
    wav.to_string() // could not move — leave it where it is, still return a path
}

/// A cloud Whisper to try first (opt-in, never for private calls: the app
/// decides and passes it only then). The key travels in the child's
/// environment, not on its command line.
#[derive(serde::Deserialize, Clone)]
pub struct SttCloud {
    url: String,
    key: String,
    #[serde(default)]
    model: String,
}

/// Transcribe a saved WAV with local Whisper. Long — called in the background by
/// the frontend so the UI stays responsive.
///
/// The Python scripts print ONE JSON object (`{text, language, segments}`). We do
/// NOT parse it; we wrap it as `{"audio_path": "...", "result": <python stdout>}`
/// (built by string concat) and let the frontend parse. On success the mix WAV is
/// MOVED to `~/.mori/audio/` (kept for playback) and the channel WAVs + markers
/// are deleted. `vocab` biases Whisper toward the user's people/projects.
fn transcribe_file_impl(
    wav: String,
    model: String,
    vocab: Option<String>,
    context: Option<String>,
    cloud: Option<SttCloud>,
) -> Result<String, String> {
    if !PathBuf::from(&wav).exists() {
        return Err(format!("audio not found: {wav}"));
    }

    // Skip empty/accidental recordings (< ~1s): don't even load the model, and
    // don't bother keeping the audio — there is nothing on it.
    if let Ok(meta) = std::fs::metadata(&wav) {
        if meta.len() < 32000 {
            for f in [
                wav.clone(),
                format!("{wav}.mic.wav"),
                format!("{wav}.sys.wav"),
                format!("{wav}.done"),
                format!("{wav}.started"),
            ] {
                let _ = std::fs::remove_file(f);
            }
            return Ok(String::new());
        }
    }

    // Dedup: atomically claim this recording; a concurrent call fails create_new.
    let lock = PathBuf::from(format!("{wav}.transcribing"));
    if std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)
        .is_err()
    {
        return Err("This recording is already being transcribed".into());
    }

    let model = if model.trim().is_empty() { "medium".to_string() } else { model };
    let mic = format!("{wav}.mic.wav");
    let sys = format!("{wav}.sys.wav");
    let diarized = PathBuf::from(&mic).exists() && PathBuf::from(&sys).exists();

    // Where Whisper says how far it got: the app reads it for the live line
    // and the time left (`transcribe_progress`). Gone once Whisper is done.
    let progress = format!("{wav}.progress");
    let common = |cmd: &mut Command| {
        // Bias Whisper toward the user's recurring people/projects when we have them.
        if let Some(v) = vocab.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            cmd.arg("--vocab").arg(v);
        }
        // ...and toward what they usually talk about (a sentence from Settings).
        if let Some(c) = context.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            cmd.arg("--context").arg(c);
        }
        cmd.arg("--progress").arg(&progress);
    };

    // The cloud first, when asked: seconds instead of minutes. Any failure
    // (network, the free allowance used up, a bad key) falls through to the
    // local Whisper below, so the call is transcribed either way.
    let mut cloud_out: Option<std::process::Output> = None;
    // Why the cloud did not do it, for the app to say once ("bad key", "free
    // hour used up") instead of a transcription that is just mysteriously slow.
    let mut cloud_err: Option<String> = None;
    if let Some(c) = cloud.as_ref().filter(|c| !c.url.trim().is_empty() && !c.key.trim().is_empty()) {
        let mut cmd = py_command("transcribe_cloud.py");
        if diarized {
            cmd.arg(&mic).arg(&sys);
        } else {
            cmd.arg(&wav);
        }
        common(&mut cmd);
        cmd.env("MORI_STT_URL", c.url.trim())
            .env("MORI_STT_KEY", c.key.trim())
            .env("MORI_STT_MODEL", c.model.trim());
        cmd.idle_no_window();
        match cmd.output() {
            Ok(o) if o.status.success() && !o.stdout.is_empty() => cloud_out = Some(o),
            Ok(o) => {
                let why = String::from_utf8_lossy(&o.stderr);
                let last = why.trim().lines().last().unwrap_or("").chars().take(300).collect::<String>();
                cloud_err = Some(if last.is_empty() { "cloud: no answer".into() } else { last });
            }
            Err(e) => cloud_err = Some(format!("cloud: did not start: {e}")),
        }
    }

    // Two channels present → speaker-separated (Tu vs Interlocutore); else single pass.
    let result = match cloud_out {
        Some(o) => Ok(o),
        None => {
            let mut cmd = if diarized {
                let mut c = py_command("transcribe_diarized.py");
                c.arg(&mic).arg(&sys).arg(&model).arg("auto");
                c
            } else {
                let mut c = py_command("transcribe.py");
                c.arg(&wav).arg(&model).arg("auto");
                c
            };
            common(&mut cmd);
            // Idle priority, no window: transcription runs only on spare CPU/IO
            // cycles and yields to everything else, so it can never freeze the UI.
            cmd.idle_no_window();
            cmd.output()
        }
    };
    let _ = std::fs::remove_file(&lock);
    let _ = std::fs::remove_file(&progress);
    let _ = std::fs::remove_file(format!("{progress}.tmp"));
    let output = result.map_err(|e| format!("The transcription did not start: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "The transcription failed (the audio is saved in {wav}): {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        // Nothing recognizable — clean up like an empty recording.
        let done = format!("{wav}.done");
        let started = format!("{wav}.started");
        for f in [wav.as_str(), mic.as_str(), sys.as_str(), done.as_str(), started.as_str()] {
            let _ = std::fs::remove_file(f);
        }
        return Ok(String::new());
    }

    // Keep the mix audio for playback; drop the per-channel WAVs and markers.
    let audio_path = keep_audio(&wav);
    for f in [
        mic.as_str(),
        sys.as_str(),
        format!("{wav}.done").as_str(),
        format!("{wav}.started").as_str(),
    ] {
        let _ = std::fs::remove_file(f);
    }

    // Wrap without parsing: audio path (escaped) + the raw Python JSON object.
    let cloud_field = cloud_err
        .map(|e| format!("\"cloud_error\":\"{}\",", json_escape(&e)))
        .unwrap_or_default();
    Ok(format!(
        "{{\"audio_path\":\"{}\",{}\"result\":{}}}",
        json_escape(&audio_path),
        cloud_field,
        stdout
    ))
}

// --- Embeddings ---------------------------------------------------------------
// Every chat question embeds the question. Spawning Python and loading the ONNX
// model each time cost seconds before the model was even asked anything, so one
// `embed.py --serve` stays alive and answers line by line. It exits on its own
// when Mori quits (its stdin closes) or after 10 idle minutes; the next request
// starts it again. If the server misbehaves we fall back to the one-shot run.

struct EmbedServer {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    lines: std::sync::mpsc::Receiver<String>,
    /// The first answer includes loading (or downloading) the model.
    warm: bool,
}

static EMBED_SERVER: std::sync::Mutex<Option<EmbedServer>> = std::sync::Mutex::new(None);

impl EmbedServer {
    fn spawn() -> Result<Self, String> {
        use std::io::{BufRead, BufReader};
        use std::process::Stdio;
        let mut cmd = py_command("embed.py");
        cmd.arg("--serve");
        cmd.idle_no_window();
        // stderr is not read: a full, unread pipe would block the server.
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = cmd.spawn().map_err(|e| format!("embedding did not start: {e}"))?;
        let stdin = child.stdin.take().ok_or("stdin not available")?;
        let stdout = child.stdout.take().ok_or("stdout not available")?;
        // A reader thread, so a hung sidecar becomes a timeout instead of a
        // request that never returns.
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(l) => {
                        if tx.send(l).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(EmbedServer { child, stdin, lines: rx, warm: false })
    }

    /// Ok(vectors JSON) | Err((is_model_error, message)).
    fn request(&mut self, texts: &[String], mode: &str) -> Result<String, (bool, String)> {
        use std::io::Write;
        let line = serde_json::json!({ "texts": texts, "mode": mode }).to_string();
        self.stdin
            .write_all(line.as_bytes())
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|e| (false, format!("embedding: write failed: {e}")))?;
        // First answer: the model may be downloading (~120 MB). Then: seconds.
        let wait = std::time::Duration::from_secs(if self.warm { 120 } else { 900 });
        let answer = self
            .lines
            .recv_timeout(wait)
            .map_err(|e| (false, format!("embedding: no answer ({e})")))?;
        let v: serde_json::Value =
            serde_json::from_str(&answer).map_err(|e| (false, format!("embedding: unreadable answer: {e}")))?;
        if v.get("ok").and_then(|x| x.as_bool()) == Some(true) {
            // Only a real answer proves the model is loaded: after an error a
            // later first load (or download) still gets the long wait.
            self.warm = true;
            Ok(v.get("vectors").cloned().unwrap_or_else(|| serde_json::json!([])).to_string())
        } else {
            let msg = v.get("error").and_then(|x| x.as_str()).unwrap_or("unknown error");
            Err((true, format!("embedding failed: {msg}")))
        }
    }
}

impl Drop for EmbedServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Embed a batch of texts with the local ONNX model, through the warm server.
/// Returns a JSON array of 384-dim vectors (the frontend parses).
fn embed_texts_impl(texts: Vec<String>, mode: String) -> Result<String, String> {
    if texts.is_empty() {
        return Ok("[]".to_string());
    }
    let mode = if mode.trim().is_empty() { "passage".to_string() } else { mode };
    let mut guard = EMBED_SERVER.lock().unwrap_or_else(|p| p.into_inner());
    for _attempt in 0..2 {
        if guard.is_none() {
            match EmbedServer::spawn() {
                Ok(s) => *guard = Some(s),
                Err(_) => break,
            }
        }
        let Some(server) = guard.as_mut() else { break };
        match server.request(&texts, &mode) {
            Ok(vectors) => return Ok(vectors),
            // The model itself failed (not installed, broken cache): a new
            // process would fail the same way. Say so.
            Err((true, msg)) => return Err(msg),
            // The process died, idled out or hung: drop it and try once more.
            Err((false, _)) => *guard = None,
        }
    }
    drop(guard);
    embed_texts_once(texts, mode)
}

/// The old path: one Python process per batch. Kept as the fallback.
fn embed_texts_once(texts: Vec<String>, mode: String) -> Result<String, String> {
    use std::io::Write;
    use std::process::Stdio;

    let payload = serde_json::to_string(&texts).map_err(|e| e.to_string())?;
    let mode = if mode.trim().is_empty() { "passage".to_string() } else { mode };

    let mut cmd = py_command("embed.py");
    cmd.arg("--mode").arg(&mode);
    cmd.idle_no_window();
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("embedding did not start: {e}"))?;
    {
        let mut stdin = child.stdin.take().ok_or("stdin not available")?;
        stdin
            .write_all(payload.as_bytes())
            .map_err(|e| format!("embedding: could not write the input: {e}"))?;
        // stdin dropped here → EOF, so the sidecar starts computing.
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("embedding failed: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "embedding failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// --- Async command wrappers -------------------------------------------------
// Tauri runs SYNCHRONOUS commands on the MAIN (UI) thread. The recording and
// transcription work blocks for seconds-to-minutes (model load + inference),
// which froze the whole app. These async wrappers push the blocking work onto a
// background pool via spawn_blocking, so the UI thread is never held.

#[tauri::command]
async fn start_recording(app: tauri::AppHandle) -> Result<RecPaths, String> {
    // Alzato PRIMA di lanciare record.py: "Esci" nei secondi in cui si aspetta
    // che il registratore parta non deve lasciarlo orfano (vedi companion.rs).
    companion::set_unsaved(&app, true);
    let res = tauri::async_runtime::spawn_blocking(start_recording_impl)
        .await
        .map_err(|e| format!("task failed: {e}"))
        .and_then(|r| r);
    if res.is_err() {
        companion::set_unsaved(&app, false);
    }
    res
}

#[tauri::command]
async fn stop_recording(wav: String, stop: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || stop_recording_impl(wav, stop))
        .await
        .map_err(|e| format!("task failed: {e}"))?
}

/// How far the transcription of `wav` has got: the JSON that the Python script
/// rewrites twice a second (`scripts/progress_file.py`), or None when there is
/// none (not started yet, already finished, or an older script).
#[tauri::command]
async fn transcribe_progress(wav: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || std::fs::read_to_string(format!("{wav}.progress")).ok())
        .await
        .map_err(|e| format!("task failed: {e}"))
}

#[tauri::command]
async fn transcribe_file(
    wav: String,
    model: String,
    vocab: Option<String>,
    context: Option<String>,
    cloud: Option<SttCloud>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || transcribe_file_impl(wav, model, vocab, context, cloud))
        .await
        .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn embed_texts(texts: Vec<String>, mode: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || embed_texts_impl(texts, mode))
        .await
        .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn foreground_window_title() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(platform::foreground_window_title)
        .await
        .map_err(|e| format!("task failed: {e}"))
}

/// Every migration, in order. sqlx stores the SHA-384 of each file's bytes in
/// `_sqlx_migrations` and refuses a database whose applied migration changed,
/// line endings included: `.gitattributes` keeps these files byte-exact and
/// `applied_migrations_keep_their_bytes` pins the fingerprints.
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "base_schema",
            sql: include_str!("../migrations/0001_base.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "seed_notes",
            sql: include_str!("../migrations/0002_seed.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "seed_raw_call",
            sql: include_str!("../migrations/0003_seed_raw.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "app_setting",
            sql: include_str!("../migrations/0004_app_setting.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "transcript_segments",
            sql: include_str!("../migrations/0005_transcript_segments.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "recall",
            sql: include_str!("../migrations/0006_recall.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "reliability",
            sql: include_str!("../migrations/0007_reliability.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "companion",
            sql: include_str!("../migrations/0008_companion.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "chat_used_sessions",
            sql: include_str!("../migrations/0009_chat_used_sessions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "null_text",
            sql: include_str!("../migrations/0010_null_text.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = migrations();

    let url = db_url();

    tauri::Builder::default()
        // Per primo: due istanze di Mori vorrebbero dire due trascrizioni della
        // stessa call. Chi arriva secondo riporta su la finestra e muore.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(&url, migrations)
                .build(),
        )
        .manage(companion::Companion::default())
        .setup(|app| {
            if let Ok(dir) = app.path().resource_dir() {
                let _ = RESOURCE_DIR.set(dir);
            }
            companion::setup(app.handle());
            companion::setup_app_menu(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            transcribe_file,
            transcribe_progress,
            embed_texts,
            foreground_window_title,
            get_db_url,
            python_env_status,
            prepare_python_env,
            maintenance::compress_audio,
            maintenance::move_audio,
            maintenance::allow_audio_dir,
            maintenance::backups_dir,
            maintenance::rotate_backups,
            maintenance::copy_into,
            maintenance::delete_file,
            maintenance::audio_stats,
            maintenance::export_markdown,
            maintenance::reveal_path,
            maintenance::open_groq_keys,
            companion::companion_pill,
            companion::companion_pill_ready,
            companion::companion_pill_hide,
            companion::companion_pill_action,
            companion::companion_set_recording,
            companion::companion_set_labels,
            companion::companion_recording_settled,
            companion::companion_set_hotkey,
            companion::companion_set_close_to_tray,
            companion::companion_tray_ready,
            companion::companion_show_main,
            companion::companion_quit,
            companion::recording_silence_secs,
            companion::recording_levels
        ])
        .build(tauri::generate_context!())
        .expect("error while running Mori")
        .run(|app, event| match event {
            // `code` is None when the system asks (Cmd+Q, the Dock's Quit, the
            // last window closing) and Some when Mori itself calls `exit`.
            // During a call the first kind waits for the recording to be saved.
            tauri::RunEvent::ExitRequested { code: None, api, .. } => {
                if companion::hold_exit(app) {
                    api.prevent_exit();
                }
            }
            // A click on the Dock icon brings back the window that "close" hid.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => companion::show_main(app),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// SHA-384 of each migration file, as existing databases remember it
    /// (`select version, hex(checksum) from _sqlx_migrations`).
    /// Never edit a line here: a released migration is frozen, a fix goes in a
    /// new file. A new migration adds its line once its bytes are final.
    /// (2 and 3, the sample calls, were rewritten in English on 2026-10-07 and
    /// lost their long dashes on 2026-10-08,
    /// before the first public build: no released database had seen them.)
    const MIGRATION_CHECKSUMS: &[(i64, &str)] = &[
        (1, "ff5f4232de041570122b7823c29078fe03be0851fb482d200027e0c86046978ca85874ca9f897416e165fd203e5134a3"),
        (2, "5878f383e705d83604790ec56a67dc754d723a1731c92fd1f062caaa0b2f4c1239d9867bd9f0c3c1c6b87a93641d374a"),
        (3, "f6763f8e3fac228dbf06b8475b2a15a115a0da3243a605f04208ba1e0134356f0ee85ae3bf3a16abc447ac966f81e3c2"),
        (4, "c461985e308f5956511e85e14c7ced472f67d6b95036b5a9cc8f7c3d9db184bf6b28bc1bd278d76d2e5d75390e9814fd"),
        (5, "fb3b039f9f2b0560b33efeafa2bdce5472e342c53716330945fd9db030516ae056a3cef50289a3e350f98958603fd7d3"),
        (6, "2710477e9d2d6ea768d14a9310cba8a84800402a1b3b4c8a079bda33c89a1eb80715db9cd44bd01241df4871eb6875b6"),
        (7, "7d8340ad70be43986df5c86fd0008cf30d9ac89a66cb2be8b88d3dcc9154500da32ba9fe60e1fb00ab3e02d3b49d1844"),
        (8, "f06f04abbe9a6c21bcba1078d1ef07a49cfc062f6e044943c3e9485e2c447aa1f880070c82e68223e8c298bb0a0840ce"),
        (9, "22f56c57939e386ee270bbd11aac21e6e0e8888d3a08d754ed85be00506db2e317f6dcff3a878c2d69a938b24b0d7cdf"),
        (10, "3f4b170e8e99aa69b898c42fc03938c8855f36e6418fc1e5af517400dcf2adfac76f4d3bca96a96a28ba89f813a54942"),
    ];

    /// The bytes compiled into the exe are the bytes the user's database has
    /// already seen. A changed file, or a checkout that rewrote its line
    /// endings, fails here instead of at startup on the user's machine.
    #[test]
    fn applied_migrations_keep_their_bytes() {
        use sha2::{Digest, Sha384};

        let migrations = migrations();
        for m in &migrations {
            let actual: String = Sha384::digest(m.sql.as_bytes())
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            let pinned = MIGRATION_CHECKSUMS
                .iter()
                .find(|(v, _)| *v == m.version)
                .unwrap_or_else(|| {
                    panic!(
                        "migration {} ({}) has no fingerprint: add ({}, \"{actual}\") to MIGRATION_CHECKSUMS",
                        m.version, m.description, m.version
                    )
                });
            assert_eq!(
                actual, pinned.1,
                "migration {} ({}) changed its bytes: the databases that already applied it would no longer open",
                m.version, m.description
            );
        }
        assert_eq!(migrations.len(), MIGRATION_CHECKSUMS.len(), "a fingerprint without its migration");
    }

    /// The warm embedding server, end to end with the real embed.py (in its
    /// fake-model mode, so no download): one process serves many requests, a
    /// dead one is replaced, a model error is reported instead of retried.
    #[test]
    fn embedding_server_stays_warm_and_recovers() {
        if Command::new("python3").arg("--version").output().is_err()
            && Command::new("python").arg("--version").output().is_err()
        {
            eprintln!("python not available: skipping");
            return;
        }
        std::env::set_var("MORI_EMBED_FAKE", "1");

        let parse = |s: &str| -> Vec<Vec<f64>> { serde_json::from_str(s).expect("json di vettori") };
        let a = embed_texts_impl(vec!["ciao".into(), "mondo".into()], "query".into()).expect("prima richiesta");
        let va = parse(&a);
        assert_eq!(va.len(), 2);
        assert_eq!(va[0].len(), 384);
        let pid = EMBED_SERVER.lock().unwrap().as_ref().map(|s| s.child.id()).expect("server vivo");

        let b = embed_texts_impl(vec!["ciao".into()], "query".into()).expect("seconda richiesta");
        assert_eq!(parse(&b)[0], va[0], "stesso testo, stesso vettore");
        let pid2 = EMBED_SERVER.lock().unwrap().as_ref().map(|s| s.child.id()).unwrap();
        assert_eq!(pid, pid2, "lo stesso processo risponde ancora: il modello resta caldo");

        // The process dies (idle exit, crash): the next request starts a new one.
        if let Some(s) = EMBED_SERVER.lock().unwrap().as_mut() {
            let _ = s.child.kill();
            let _ = s.child.wait();
        }
        let c = embed_texts_impl(vec!["dopo".into()], "passage".into()).expect("si riprende da solo");
        assert_eq!(parse(&c).len(), 1);
        let pid3 = EMBED_SERVER.lock().unwrap().as_ref().map(|s| s.child.id()).unwrap();
        assert_ne!(pid, pid3);

        assert_eq!(embed_texts_impl(vec![], "query".into()).unwrap(), "[]");
        *EMBED_SERVER.lock().unwrap() = None; // Drop kills it
    }
}
