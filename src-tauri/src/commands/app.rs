use tauri::{AppHandle, Manager, State};

use crate::db;
use crate::events::{self, VoiceState};
use crate::models::Settings;
use crate::state::AppState;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "J.A.R.V.I.S.".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn toggle_hud_window(app: &AppHandle) -> bool {
    let Some(hud) = app.get_webview_window("hud") else {
        return false;
    };

    if hud.is_visible().unwrap_or(false) {
        let _ = hud.hide();
        false
    } else {
        let _ = hud.show();
        let _ = hud.set_focus();
        true
    }
}

pub fn toggle_mute_impl(app: &AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let settings = {
        let conn = state
            .db
            .lock()
            .map_err(|_| "データベースのロックに失敗".to_string())?;
        let mut settings = db::load_settings(&conn);
        settings.tts.enabled = !settings.tts.enabled;
        db::save_settings(&conn, &settings)?;
        settings
    };

    events::emit(app, events::SETTINGS_CHANGED, settings.clone());
    Ok(settings.tts.enabled)
}

pub fn apply_hud_options(app: &AppHandle, settings: &Settings) {
    if let Some(hud) = app.get_webview_window("hud") {
        let _ = hud.set_ignore_cursor_events(settings.hud.click_through);
    }
}

#[tauri::command]
pub fn toggle_hud(app: AppHandle) -> bool {
    toggle_hud_window(&app)
}

#[tauri::command]
pub fn set_hud_visible(app: AppHandle, visible: bool) {
    if let Some(hud) = app.get_webview_window("hud") {
        if visible {
            let _ = hud.show();
        } else {
            let _ = hud.hide();
        }
    }
}

/// Ask the voice engine (living in the main window) to start/stop listening.
#[tauri::command]
pub fn request_voice_toggle(app: AppHandle) {
    events::emit(&app, events::VOICE_TOGGLE, "toggle".to_string());
}

#[tauri::command]
pub fn report_voice_state(
    app: AppHandle,
    state: State<'_, AppState>,
    state_name: String,
    detail: Option<String>,
) {
    if let Ok(mut voice) = state.voice.lock() {
        voice.state = state_name.clone();
        voice.detail = detail.clone();
    }
    events::emit(
        &app,
        events::VOICE_STATE,
        VoiceState {
            state: state_name,
            detail,
        },
    );
}

#[tauri::command]
pub fn toggle_mute(app: AppHandle) -> Result<bool, String> {
    toggle_mute_impl(&app)
}

#[tauri::command]
pub fn apply_hud_settings(
    app: AppHandle,
    settings: Settings,
) -> Result<(), String> {
    apply_hud_options(&app, &settings);
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    show_main(&app);
}
