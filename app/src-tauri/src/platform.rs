//! The few things that differ between Windows and everything else.
//!
//! Mori is built and used on Windows, but the backend must also compile on
//! macOS/Linux: that is where CI runs and where open-source contributors work.
//! Everything OS-specific lives here, so the rest of the code never needs a
//! `#[cfg]` of its own.

use std::path::PathBuf;
use std::process::Command;

/// Process flags for the child processes Mori spawns (Python sidecars).
pub(crate) trait ChildFlags {
    /// No console window. The release exe has no console, so without this every
    /// script (record.py first of all) opened a visible terminal window.
    fn no_window(&mut self) -> &mut Self;
    /// No window AND idle priority: the work runs only on spare CPU/IO cycles
    /// and yields to everything else, so it can never freeze the UI.
    fn idle_no_window(&mut self) -> &mut Self;
}

#[cfg(windows)]
impl ChildFlags for Command {
    fn no_window(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(0x0800_0000) // CREATE_NO_WINDOW
    }
    fn idle_no_window(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(0x0000_0040 | 0x0800_0000) // IDLE_PRIORITY_CLASS | CREATE_NO_WINDOW
    }
}

#[cfg(not(windows))]
impl ChildFlags for Command {
    fn no_window(&mut self) -> &mut Self {
        self
    }
    fn idle_no_window(&mut self) -> &mut Self {
        self
    }
}

/// The user's home: `%USERPROFILE%` on Windows, `$HOME` elsewhere.
pub(crate) fn home_dir() -> PathBuf {
    let base = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(base)
}

/// `~/.mori`, the one place Mori keeps its data.
pub(crate) fn mori_dir() -> PathBuf {
    home_dir().join(".mori")
}

/// `canonicalize` on Windows returns a "verbatim" path (`\\?\C:\…`) that
/// Explorer does not understand: handed one, it opens some other folder. This
/// gives back the everyday form; any other path is returned unchanged.
pub(crate) fn plain_path(p: &std::path::Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    p.to_path_buf()
}

/// The Python interpreter inside a virtualenv rooted at `venv`.
pub(crate) fn venv_python(venv: &std::path::Path) -> PathBuf {
    if cfg!(windows) {
        venv.join("Scripts").join("python.exe")
    } else {
        venv.join("bin").join("python")
    }
}

/// System Python launchers to try after the dedicated venvs, in order.
pub(crate) fn system_pythons() -> Vec<Vec<String>> {
    if cfg!(windows) {
        vec![
            vec!["py".into(), "-3".into()],
            vec!["python".into()],
            vec!["python3".into()],
        ]
    } else {
        vec![vec!["python3".into()], vec!["python".into()]]
    }
}

/// Title of the current foreground window — used to gently suggest recording
/// when a call app (Meet/Zoom/Teams/Webex) is in front. Empty when there is no
/// foreground window, it has no title, or the OS is not supported (yet).
#[cfg(windows)]
pub(crate) fn foreground_window_title() -> String {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
    };
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return String::new();
        }
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; (len + 1) as usize];
        let read = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if read <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..read as usize])
    }
}

#[cfg(not(windows))]
pub(crate) fn foreground_window_title() -> String {
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verbatim_paths_become_plain() {
        assert_eq!(
            plain_path(std::path::Path::new(r"\\?\C:\Users\a\.mori\export")),
            PathBuf::from(r"C:\Users\a\.mori\export")
        );
        assert_eq!(
            plain_path(std::path::Path::new(r"\\?\UNC\server\share\x")),
            PathBuf::from(r"\\server\share\x")
        );
        assert_eq!(plain_path(std::path::Path::new("/home/a/.mori")), PathBuf::from("/home/a/.mori"));
    }
}
