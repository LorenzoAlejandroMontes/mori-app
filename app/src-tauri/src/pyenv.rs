//! No Python to install (docs/MACOS.md, M5).
//!
//! Mori's recorder, Whisper and the embeddings are Python scripts. A packaged
//! Mori carries `uv` next to its executable (Apache-2.0, see THIRD_PARTY.md):
//! when no usable Python is found, the first launch asks `uv` for a Python of
//! its own and installs `requirements.txt` into `~/.mori/venv`, the place
//! `python_cmd()` in lib.rs already looks at. Nothing else on the computer is
//! touched: the Python lives in `~/.mori/python`, and deleting `~/.mori/venv`
//! makes the next launch prepare it again.
//!
//! A Mori built from source has no `uv` next to it and keeps working as
//! before, with the venv the developer made.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};

use crate::platform::{self, ChildFlags};

/// What the frontend listens to while the environment is being prepared:
/// `{"stage": "python" | "packages" | "check"}`.
pub const EV_PROGRESS: &str = "setup://progress";

/// The Python `uv` downloads. One version, so every install runs the same
/// wheels the CI run proved.
const PYTHON_VERSION: &str = "3.12";

static RUNNING: AtomicBool = AtomicBool::new(false);

/// The `uv` that travels with a packaged Mori, next to the executable.
pub(crate) fn bundled_uv() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let uv = exe.parent()?.join(if cfg!(windows) { "uv.exe" } else { "uv" });
    uv.is_file().then_some(uv)
}

pub(crate) fn venv_dir() -> PathBuf {
    platform::mori_dir().join("venv")
}

/// Everything `uv` printed during the last preparation, for whoever has to
/// understand a failure.
fn log_path() -> PathBuf {
    platform::mori_dir().join("setup.log")
}

fn run(step: &str, cmd: &mut Command) -> Result<(), String> {
    use std::io::Write;
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())
        .map_err(|e| format!("setup log: {e}"))?;
    let mut head = log.try_clone().map_err(|e| format!("setup log: {e}"))?;
    let _ = writeln!(head, "\n## {step}: {cmd:?}");
    let err = log.try_clone().map_err(|e| format!("setup log: {e}"))?;
    let status = cmd
        .no_window()
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(err)
        .status()
        .map_err(|e| format!("{step}: did not start: {e}"))?;
    if status.success() {
        return Ok(());
    }
    Err(format!("{step}: {status}. {}", last_lines(&log_path(), 6)))
}

fn last_lines(path: &Path, n: usize) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join(" · ")
}

/// Creates `~/.mori/venv` and fills it. Long (a download of a few hundred MB
/// the first time): always called from `spawn_blocking`.
pub(crate) fn prepare(app: &AppHandle, requirements: &Path) -> Result<(), String> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("Setup is already running".into());
    }
    let result = prepare_inner(app, requirements);
    RUNNING.store(false, Ordering::SeqCst);
    result
}

fn prepare_inner(app: &AppHandle, requirements: &Path) -> Result<(), String> {
    let uv = bundled_uv().ok_or("uv is not part of this build")?;
    if !requirements.is_file() {
        return Err(format!("requirements.txt not found: {}", requirements.display()));
    }
    let home = platform::mori_dir();
    std::fs::create_dir_all(&home).map_err(|e| format!("{}: {e}", home.display()))?;
    let _ = std::fs::remove_file(log_path());
    let venv = venv_dir();
    let stage = |s: &str| {
        let _ = app.emit(EV_PROGRESS, serde_json::json!({ "stage": s }));
    };
    // uv's own Python, kept with the rest of Mori's files: a Mac's
    // /usr/bin/python3 can be a stub that opens an install dialog.
    let uv_cmd = || {
        let mut c = Command::new(&uv);
        c.env("UV_PYTHON_INSTALL_DIR", home.join("python"));
        c.env("UV_PYTHON_PREFERENCE", "only-managed");
        c.env("UV_NO_PROGRESS", "1");
        c
    };

    stage("python");
    run(
        "python",
        uv_cmd().arg("venv").arg("--clear").arg("--python").arg(PYTHON_VERSION).arg(&venv),
    )?;

    stage("packages");
    let py = platform::venv_python(&venv);
    run(
        "packages",
        uv_cmd().arg("pip").arg("install").arg("--python").arg(&py).arg("-r").arg(requirements),
    )?;

    stage("check");
    run("check", Command::new(&py).arg("-c").arg("import soundcard, numpy, faster_whisper"))?;
    Ok(())
}
