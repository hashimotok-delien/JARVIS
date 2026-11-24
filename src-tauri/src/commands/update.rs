//! Local update manifest handling.
//!
//! The manifest (`latest.json`) lives in the repository's `updates/` folder
//! (or next to the installed executable) and describes the newest build.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

use crate::paths;
use crate::state::AppState;

const MANIFEST_NAME: &str = "latest.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateManifest {
    pub version: String,
    pub released_at: Option<String>,
    pub notes: Option<String>,
    /// Installer file name relative to the manifest folder.
    pub installer: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub has_update: bool,
    pub notes: Option<String>,
    pub released_at: Option<String>,
    pub installer_path: Option<String>,
    pub url: Option<String>,
    pub update_dir: Option<String>,
    pub manifest_path: Option<String>,
    pub error: Option<String>,
}

fn parse_version(value: &str) -> Vec<u64> {
    value
        .trim()
        .trim_start_matches(['v', 'V'])
        .split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .take(4)
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    let latest_parts = parse_version(latest);
    let current_parts = parse_version(current);
    let length = latest_parts.len().max(current_parts.len());

    for index in 0..length {
        let a = latest_parts.get(index).copied().unwrap_or(0);
        let b = current_parts.get(index).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }
    false
}

fn find_manifest(data_dir: &Path, custom: Option<&Path>) -> Option<PathBuf> {
    paths::update_dir_candidates(data_dir, custom)
        .into_iter()
        .map(|dir| dir.join(MANIFEST_NAME))
        .find(|candidate| candidate.is_file())
}

fn load_manifest(path: &Path) -> Result<UpdateManifest, String> {
    let raw =
        std::fs::read_to_string(path).map_err(|e| format!("マニフェストを読めません: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("マニフェストの解析に失敗: {e}"))
}

fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn resolve_installer(manifest_path: &Path, manifest: &UpdateManifest) -> Option<PathBuf> {
    let name = manifest.installer.as_deref()?.trim();
    if name.is_empty() {
        return None;
    }
    let base = manifest_path.parent()?;
    let candidate = if Path::new(name).is_absolute() {
        PathBuf::from(name)
    } else {
        base.join(name)
    };
    candidate.is_file().then_some(candidate)
}

#[tauri::command]
pub fn check_update(state: State<'_, AppState>) -> UpdateStatus {
    let current = current_version();
    let settings = crate::commands::read_settings(&state);
    let custom = PathBuf::from(settings.updates.folder.trim());
    let manifest_path = find_manifest(&state.data_dir, Some(custom.as_path()));

    let Some(manifest_path) = manifest_path else {
        return UpdateStatus {
            current_version: current,
            latest_version: None,
            has_update: false,
            notes: None,
            released_at: None,
            installer_path: None,
            url: None,
            update_dir: None,
            manifest_path: None,
            error: None,
        };
    };

    match load_manifest(&manifest_path) {
        Ok(manifest) => {
            let latest = manifest.version.clone();
            let has_update = !latest.is_empty() && is_newer(&latest, &current);
            let installer = resolve_installer(&manifest_path, &manifest);
            UpdateStatus {
                current_version: current,
                latest_version: Some(latest),
                has_update,
                notes: manifest.notes,
                released_at: manifest.released_at,
                installer_path: installer.map(|path| path.to_string_lossy().to_string()),
                url: manifest.url,
                update_dir: manifest_path
                    .parent()
                    .map(|path| path.to_string_lossy().to_string()),
                manifest_path: Some(manifest_path.to_string_lossy().to_string()),
                error: None,
            }
        }
        Err(error) => UpdateStatus {
            current_version: current,
            latest_version: None,
            has_update: false,
            notes: None,
            released_at: None,
            installer_path: None,
            url: None,
            update_dir: manifest_path
                .parent()
                .map(|path| path.to_string_lossy().to_string()),
            manifest_path: Some(manifest_path.to_string_lossy().to_string()),
            error: Some(error),
        },
    }
}

#[tauri::command]
pub fn launch_update_installer(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let status = check_update(state);
    let installer = status
        .installer_path
        .as_deref()
        .ok_or_else(|| "インストーラが見つかりません".to_string())?;

    let escaped = installer.replace('\'', "''");
    let script = format!("Start-Sleep -Milliseconds 1500; Start-Process -FilePath '{escaped}'");

    std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .spawn()
        .map_err(|e| format!("インストーラを起動できません: {e}"))?;

    if let Some(state) = app.try_state::<AppState>() {
        state
            .quitting
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn open_update_dir(state: State<'_, AppState>) -> Result<(), String> {
    let status = check_update(state);
    let dir = status
        .update_dir
        .ok_or_else(|| "アップデート情報フォルダが見つかりません".to_string())?;

    std::process::Command::new("explorer.exe")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("フォルダを開けません: {e}"))?;
    Ok(())
}
