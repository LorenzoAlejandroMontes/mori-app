//! Housekeeping that must never be felt: compressing kept recordings and
//! rotating database snapshots.
//!
//! Every command here is `async` and does its real work inside
//! `spawn_blocking`. A SYNCHRONOUS Tauri command runs on the MAIN thread and
//! freezes the whole window — that bug already cost this project a day.

use std::fs;
use std::path::{Path, PathBuf};

use crate::platform::mori_dir;
use crate::ChildFlags;

fn backups_path() -> PathBuf {
    let dir = mori_dir().join("backups");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// WAV → FLAC (lossless, 16 kHz mono), verified before the WAV is removed.
/// Returns the path of the FLAC, which the caller stores on the session.
fn compress_audio_impl(wav: String) -> Result<String, String> {
    let src = PathBuf::from(&wav);
    if src.extension().map(|e| e.eq_ignore_ascii_case("flac")).unwrap_or(false) {
        return Ok(wav); // already compressed, nothing to do
    }
    let dest = src.with_extension("flac");
    if !src.exists() {
        // Already converted on an earlier attempt, and the caller lost the update
        // (app closed between the delete and the DB write). Hand back the FLAC
        // instead of failing forever on a WAV that is gone on purpose.
        if dest.exists() && dest.metadata().map(|m| m.len()).unwrap_or(0) > 0 {
            return Ok(dest.to_string_lossy().into_owned());
        }
        return Err(format!("audio non trovato: {wav}"));
    }

    let mut cmd = crate::py_command("toflac.py");
    cmd.arg(&src).arg(&dest);
    // Housekeeping only ever uses spare cycles.
    cmd.idle_no_window();
    let out = cmd
        .output()
        .map_err(|e| format!("compressione non avviata: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() {
        return Err(format!(
            "compressione fallita (l'audio resta com'è): {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    // toflac.py already decoded the FLAC back and compared the sample count; we
    // only trust it when it says so explicitly.
    let v: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("risposta non leggibile: {e}"))?;
    if v.get("ok").and_then(|x| x.as_bool()) != Some(true) {
        return Err(format!(
            "verifica fallita: {}",
            v.get("error").and_then(|x| x.as_str()).unwrap_or("motivo sconosciuto")
        ));
    }
    if !dest.exists() || dest.metadata().map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("il file compresso non è stato scritto".into());
    }

    // Only now is the original removed.
    fs::remove_file(&src).map_err(|e| format!("non riesco a rimuovere il WAV originale: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Keep the newest `keep` snapshots (never fewer than one). Returns what it removed.
fn rotate_backups_impl(keep: usize) -> Result<Vec<String>, String> {
    let dir = backups_path();
    let mut files: Vec<(String, PathBuf)> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "db").unwrap_or(false))
        .map(|p| (p.file_name().unwrap_or_default().to_string_lossy().into_owned(), p))
        .collect();
    // The names carry a sortable timestamp (mori-YYYYMMDD-HHMMSS.db).
    files.sort_by(|a, b| a.0.cmp(&b.0));

    let keep = keep.max(1);
    if files.len() <= keep {
        return Ok(vec![]);
    }
    let mut removed = vec![];
    for (name, path) in files.iter().take(files.len() - keep) {
        if fs::remove_file(path).is_ok() {
            removed.push(name.clone());
        }
    }
    Ok(removed)
}

/// Copy a snapshot into a second folder the user chose (e.g. a synced one).
fn copy_into_impl(src: String, dir: String) -> Result<String, String> {
    let from = PathBuf::from(&src);
    let name = from
        .file_name()
        .ok_or_else(|| "percorso di origine non valido".to_string())?;
    let to_dir = PathBuf::from(&dir);
    fs::create_dir_all(&to_dir).map_err(|e| format!("cartella non utilizzabile: {e}"))?;
    let to = to_dir.join(name);
    fs::copy(&from, &to).map_err(|e| format!("copia non riuscita: {e}"))?;
    Ok(to.to_string_lossy().into_owned())
}

/// Only Mori's own files may be deleted from the frontend: anything under
/// `~/.mori` (kept audio, snapshots), or a recording still sitting in the temp
/// folder (`mori_rec_*`). The command used to accept any path at all.
fn deletable(path: &Path) -> bool {
    // The folder decides (the file itself is about to go); canonicalize resolves
    // `..` and links so a crafted path cannot climb out.
    let Some(parent) = path.parent().and_then(|p| p.canonicalize().ok()) else {
        return false;
    };
    if let Ok(root) = mori_dir().canonicalize() {
        if parent.starts_with(&root) {
            return true;
        }
    }
    let in_temp = std::env::temp_dir()
        .canonicalize()
        .map(|t| parent == t)
        .unwrap_or(false);
    let ours = path
        .file_name()
        .map(|n| n.to_string_lossy().starts_with("mori_rec_"))
        .unwrap_or(false);
    in_temp && ours
}

/// Move a kept recording out of `~/.mori/audio` into the folder the user chose
/// (e.g. one synced by OneDrive with "files on demand": it stops weighing on
/// the PC). Copy, check the copy is whole, and only then remove the original.
/// Returns the new path, which the caller stores on the session.
fn move_audio_impl(src: String, dir: String) -> Result<String, String> {
    let from = PathBuf::from(&src);
    if !from.is_file() {
        return Err(format!("audio non trovato: {src}"));
    }
    if !deletable(&from) {
        return Err(format!("sposto solo l'audio di Mori: {src}"));
    }
    let name = from
        .file_name()
        .ok_or_else(|| "percorso di origine non valido".to_string())?;
    let to_dir = PathBuf::from(dir.trim());
    if to_dir.as_os_str().is_empty() || !to_dir.is_absolute() {
        return Err("indica una cartella completa (es. C:\\Users\\…\\OneDrive\\Mori)".into());
    }
    fs::create_dir_all(&to_dir).map_err(|e| format!("cartella non utilizzabile: {e}"))?;
    let to = to_dir.join(name);
    let part = to.with_extension("part");
    fs::copy(&from, &part).map_err(|e| format!("copia non riuscita: {e}"))?;
    let want = fs::metadata(&from).map(|m| m.len()).unwrap_or(0);
    let got = fs::metadata(&part).map(|m| m.len()).unwrap_or(u64::MAX);
    if want == 0 || want != got {
        let _ = fs::remove_file(&part);
        return Err("la copia non è completa: l'audio resta dov'era".into());
    }
    fs::rename(&part, &to).map_err(|e| format!("copia non riuscita: {e}"))?;
    let _ = fs::remove_file(&from);
    Ok(to.to_string_lossy().into_owned())
}

fn delete_file_impl(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Ok(()); // already gone: nothing to do, nothing to refuse
    }
    if !deletable(&p) {
        return Err(format!("non cancello file fuori dalla cartella di Mori: {path}"));
    }
    match fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(serde::Deserialize)]
pub struct ExportFile {
    name: String,
    content: String,
}

/// Keep a name a plain file/folder name: no separators, no reserved characters,
/// no `..`, never empty.
fn safe_name(raw: &str, fallback: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { ' ' } else { c })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned = cleaned.trim_matches(|c: char| c == '.' || c == ' ').to_string();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned.chars().take(120).collect()
    }
}

/// Write the calls as Markdown files into `~/.mori/export/<folder>/` and return
/// that folder. Nothing outside `~/.mori` can be written: names are flattened.
fn export_markdown_impl(folder: String, files: Vec<ExportFile>) -> Result<String, String> {
    let dir = mori_dir().join("export").join(safe_name(&folder, "export"));
    fs::create_dir_all(&dir).map_err(|e| format!("cartella di export non creata: {e}"))?;
    for f in files {
        let mut name = safe_name(&f.name, "call.md");
        if !name.to_lowercase().ends_with(".md") {
            name.push_str(".md");
        }
        fs::write(dir.join(&name), f.content.as_bytes()).map_err(|e| format!("{name}: {e}"))?;
    }
    Ok(dir.to_string_lossy().into_owned())
}

/// Show one of Mori's folders in the system file manager.
fn reveal_path_impl(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("percorso non trovato: {e}"))?;
    let root = mori_dir().canonicalize().map_err(|e| e.to_string())?;
    if !p.starts_with(&root) {
        return Err("apro solo le cartelle di Mori".into());
    }
    let program = if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    // The canonical form was only for the check above: the file manager gets
    // the everyday path (Explorer ignores `\\?\` paths).
    let mut child = std::process::Command::new(program)
        .arg(crate::platform::plain_path(&p))
        .spawn()
        .map_err(|e| format!("non riesco ad aprire la cartella: {e}"))?;
    // Reap it, so no zombie is left behind until Mori quits (Linux).
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[derive(serde::Serialize)]
pub struct AudioStats {
    wav_count: u32,
    wav_bytes: u64,
    flac_count: u32,
    flac_bytes: u64,
}

fn audio_stats_impl() -> AudioStats {
    let mut s = AudioStats { wav_count: 0, wav_bytes: 0, flac_count: 0, flac_bytes: 0 };
    let dir = mori_dir().join("audio");
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.filter_map(|e| e.ok()) {
            let p = e.path();
            let len = e.metadata().map(|m| m.len()).unwrap_or(0);
            match p.extension().and_then(|x| x.to_str()) {
                Some("wav") => {
                    s.wav_count += 1;
                    s.wav_bytes += len;
                }
                Some("flac") => {
                    s.flac_count += 1;
                    s.flac_bytes += len;
                }
                _ => {}
            }
        }
    }
    s
}

// --- commands (thin: everything blocking goes to the pool) -------------------

#[tauri::command]
pub async fn move_audio(src: String, dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || move_audio_impl(src, dir))
        .await
        .map_err(|e| format!("task fallita: {e}"))?
}

/// Let the player read recordings kept in the user's folder: the asset
/// protocol only opens `~/.mori/audio` by default (tauri.conf.json).
#[tauri::command]
pub async fn allow_audio_dir(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    use tauri::Manager;
    let p = PathBuf::from(dir.trim());
    if p.as_os_str().is_empty() || !p.is_absolute() {
        return Ok(());
    }
    app.asset_protocol_scope()
        .allow_directory(&p, true)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compress_audio(wav: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || compress_audio_impl(wav))
        .await
        .map_err(|e| format!("task fallita: {e}"))?
}

#[tauri::command]
pub async fn backups_dir() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| Ok(backups_path().to_string_lossy().into_owned()))
        .await
        .map_err(|e| format!("task fallita: {e}"))?
}

#[tauri::command]
pub async fn rotate_backups(keep: usize) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || rotate_backups_impl(keep))
        .await
        .map_err(|e| format!("task fallita: {e}"))?
}

#[tauri::command]
pub async fn copy_into(src: String, dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || copy_into_impl(src, dir))
        .await
        .map_err(|e| format!("task fallita: {e}"))?
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_file_impl(path))
        .await
        .map_err(|e| format!("task fallita: {e}"))?
}

#[tauri::command]
pub async fn export_markdown(folder: String, files: Vec<ExportFile>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || export_markdown_impl(folder, files))
        .await
        .map_err(|e| format!("task fallita: {e}"))?
}

#[tauri::command]
pub async fn reveal_path(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || reveal_path_impl(path))
        .await
        .map_err(|e| format!("task fallita: {e}"))?
}

#[tauri::command]
pub async fn audio_stats() -> Result<AudioStats, String> {
    tauri::async_runtime::spawn_blocking(audio_stats_impl)
        .await
        .map_err(|e| format!("task fallita: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deletes_only_mori_files() {
        let tmp = std::env::temp_dir();
        let ours = tmp.join(format!("mori_rec_test_{}.wav", std::process::id()));
        let other = tmp.join(format!("not_mori_{}.txt", std::process::id()));
        fs::write(&ours, b"x").unwrap();
        fs::write(&other, b"x").unwrap();

        assert!(deletable(&ours), "a temp recording is Mori's");
        assert!(!deletable(&other), "a random temp file is not");
        assert!(!deletable(Path::new("/etc/passwd")), "system files are not");
        assert!(!deletable(&tmp.join("..").join(other.file_name().unwrap())), "no climbing out with ..");

        assert!(delete_file_impl(other.to_string_lossy().into_owned()).is_err());
        assert!(other.exists(), "refused means untouched");
        assert!(delete_file_impl(ours.to_string_lossy().into_owned()).is_ok());
        assert!(!ours.exists());
        // Gone already: fine, nothing to refuse.
        assert!(delete_file_impl(ours.to_string_lossy().into_owned()).is_ok());
        let _ = fs::remove_file(&other);
    }

    #[test]
    fn export_names_cannot_escape() {
        assert_eq!(safe_name("../../etc/passwd", "x"), "etc passwd");
        assert_eq!(safe_name("C:\\Windows\\system32", "x"), "C Windows system32");
        assert_eq!(safe_name("  ..  ", "fallback"), "fallback");
        assert_eq!(safe_name("2026-09-15 Allineamento: backlog?.md", "x"), "2026-09-15 Allineamento backlog .md");
        assert_eq!(safe_name("Caffè con Zoë", "x"), "Caffè con Zoë");
    }
}
