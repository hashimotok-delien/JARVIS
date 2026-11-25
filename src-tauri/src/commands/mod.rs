use tauri::AppHandle;
use tauri::{Manager, State};

use crate::db;
use crate::models::Settings;
use crate::state::AppState;

pub mod app;
pub mod chat;
pub mod data;
pub mod dialog;
pub mod memory;
pub mod services;
pub mod settings;
pub mod speech;
pub mod threads;
pub mod tools;
pub mod update;
pub mod voice;
pub mod voice_lab;

pub fn read_settings(state: &AppState) -> Settings {
    let conn = state
        .db
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    db::load_settings(&conn)
}

pub fn read_settings_from(app: &AppHandle) -> Settings {
    let state = app.state::<AppState>();
    read_settings(&state)
}

pub fn settings_payload(app: &AppHandle) -> crate::models::SettingsPayload {
    let state = app.state::<AppState>();
    let settings = read_settings(&state);

    let (has_key, has_opencode_key, previous_version) = {
        let conn = state
            .db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let has_key = db::get_secret(&conn, "gemini_api_key").is_some();
        let has_opencode_key = db::get_secret(&conn, "opencode_api_key").is_some();
        let previous_version = state
            .previous_version
            .lock()
            .ok()
            .and_then(|value| value.clone());
        (has_key, has_opencode_key, previous_version)
    };

    let (stt_available, stt_detail) = crate::speech::stt::availability(app, &settings);

    crate::models::SettingsPayload {
        settings,
        has_gemini_key: has_key,
        has_opencode_key,
        stt_available,
        stt_detail,
        db_path: state
            .data_dir
            .join("jarvis.db")
            .to_string_lossy()
            .to_string(),
        data_dir: state.data_dir.to_string_lossy().to_string(),
        previous_version,
    }
}

pub fn lock_db<'a>(
    state: &'a State<'_, AppState>,
) -> Result<std::sync::MutexGuard<'a, rusqlite::Connection>, String> {
    state
        .db
        .lock()
        .map_err(|_| "データベースのロックを取得できません".to_string())
}
