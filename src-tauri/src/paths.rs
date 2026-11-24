//! Portable directory layout.
//!
//! Program files live next to the executable; mutable data lives in `usr`
//! so the install folder stays predictable and uninstalling can keep data.

use std::path::{Path, PathBuf};
use tauri::Manager;

fn is_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write-probe");
    match std::fs::write(&probe, b"probe") {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn exe_usr_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.parent()?.join("usr"))
}

/// Directory that stores the database, exports and logs.
pub fn resolve_data_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Some(custom) = std::env::var_os("JARVIS_DATA_DIR") {
        let path = PathBuf::from(custom);
        if is_writable(&path) {
            return path;
        }
    }

    if let Some(portable) = exe_usr_dir() {
        if is_writable(&portable) {
            return portable;
        }
    }

    let fallback = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("jarvis"));
    let _ = std::fs::create_dir_all(&fallback);
    fallback
}

/// Log directory, resolved before the Tauri app exists (panic hook).
pub fn log_dir() -> PathBuf {
    if let Some(portable) = exe_usr_dir() {
        if is_writable(&portable) {
            return portable.join("logs");
        }
    }
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("JARVIS")
        .join("logs")
}

/// Candidate folders that may contain `latest.json` (update manifest).
pub fn update_dir_candidates(data_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(custom) = std::env::var_os("JARVIS_UPDATE_DIR") {
        dirs.push(PathBuf::from(custom));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.join("updates"));
            if let Some(repo) = parent
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
            {
                dirs.push(repo.join("updates"));
            }
        }
    }

    if let Some(install_root) = data_dir.parent() {
        dirs.push(install_root.join("updates"));
    }
    dirs.push(data_dir.join("updates"));

    dirs
}
