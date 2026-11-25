//! Portable directory layout.
//!
//! Program files live next to the executable; mutable data lives in `usr`
//! so the install folder stays predictable and uninstalling can keep data.

use std::path::{Path, PathBuf};

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
///
/// Resolved without an `AppHandle` so the database can be opened and
/// managed on the builder, before any window script can invoke commands.
pub fn resolve_data_dir_headless() -> PathBuf {
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

    let fallback = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("com.monster2408.jarvis");
    let _ = std::fs::create_dir_all(&fallback);
    fallback
}

/// Log directory, resolved before the Tauri app exists (panic hook).
pub fn log_dir() -> PathBuf {
    if let Some(custom) = std::env::var_os("JARVIS_DATA_DIR") {
        let path = PathBuf::from(custom);
        if is_writable(&path) {
            return path.join("logs");
        }
    }

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

/// Directory that holds downloadable models such as the Haas-ja GGUF.
pub fn models_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("models")
}

/// Candidate folders that may contain `latest.json` (update manifest).
///
/// `custom` is the folder configured in settings and always wins so the user
/// can point the app at any repository/build output folder.
pub fn update_dir_candidates(data_dir: &Path, custom: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(folder) = custom.filter(|dir| !dir.as_os_str().is_empty()) {
        dirs.push(folder.to_path_buf());
    }

    if let Some(custom) = std::env::var_os("JARVIS_UPDATE_DIR") {
        dirs.push(PathBuf::from(custom));
    }

    dirs.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("updates"),
    );

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_candidates_include_the_source_repository() {
        let expected = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("updates");
        let candidates = update_dir_candidates(Path::new("data"), None);

        assert!(candidates.contains(&expected));
    }

    #[test]
    fn configured_update_folder_is_searched_first() {
        let custom = PathBuf::from("D:\\repo\\updates");
        let candidates = update_dir_candidates(Path::new("data"), Some(&custom));

        assert_eq!(candidates.first(), Some(&custom));
    }

    #[test]
    fn empty_update_folder_is_ignored() {
        let custom = PathBuf::from("");
        let candidates = update_dir_candidates(Path::new("data"), Some(&custom));

        assert_ne!(candidates.first(), Some(&custom));
    }
}
