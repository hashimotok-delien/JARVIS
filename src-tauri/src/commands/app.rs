use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, State};

use crate::db;
use crate::events::{self, QuickPrompt, VoiceState};
use crate::models::Settings;
use crate::state::AppState;

#[cfg(windows)]
fn send_hud_to_back(hud: &tauri::WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowPos,
    };

    let hwnd = hud
        .hwnd()
        .map_err(|error| format!("HUDのウィンドウハンドルを取得できません: {error}"))?;
    let result = unsafe {
        SetWindowPos(
            hwnd.0,
            HWND_BOTTOM,
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
        )
    };
    if result == 0 {
        return Err("HUDを最背面に移動できません".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn send_hud_to_back(_hud: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HudGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Current HUD position/size in logical pixels (None if the window is gone).
pub fn hud_geometry(app: &AppHandle) -> Option<(i32, i32, u32, u32)> {
    let hud = app.get_webview_window("hud")?;
    let scale = hud.scale_factor().ok()?;
    let position = hud.outer_position().ok()?.to_logical::<f64>(scale);
    let size = hud.outer_size().ok()?.to_logical::<f64>(scale);
    Some((
        position.x.round() as i32,
        position.y.round() as i32,
        size.width.round().max(1.0) as u32,
        size.height.round().max(1.0) as u32,
    ))
}

#[tauri::command]
pub fn get_hud_geometry(app: AppHandle) -> Result<HudGeometry, String> {
    let (x, y, width, height) =
        hud_geometry(&app).ok_or_else(|| "HUD ウィンドウが見つかりません".to_string())?;
    Ok(HudGeometry {
        x,
        y,
        width,
        height,
    })
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "J.A.R.V.I.S.".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

#[tauri::command]
pub fn write_log(level: String, source: String, message: String) {
    let level = match level.to_ascii_uppercase().as_str() {
        "ERROR" => "ERROR",
        "WARN" => "WARN",
        "INFO" => "INFO",
        _ => "DEBUG",
    };
    let source: String = source.chars().take(80).collect();
    let message: String = message.chars().take(12_000).collect();
    crate::log_message(level, &source, &message);
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.show() {
            crate::log_message("ERROR", "window", &format!("show main: {error}"));
        }
        if let Err(error) = window.unminimize() {
            crate::log_message("ERROR", "window", &format!("unminimize main: {error}"));
        }
        if let Err(error) = window.set_focus() {
            crate::log_message("ERROR", "window", &format!("focus main: {error}"));
        }
    }
}

pub fn toggle_hud_window(app: &AppHandle) -> bool {
    let Some(hud) = app.get_webview_window("hud") else {
        return false;
    };

    let visible = match hud.is_visible() {
        Ok(visible) => visible,
        Err(error) => {
            crate::log_message("ERROR", "window", &format!("check HUD visibility: {error}"));
            return false;
        }
    };

    if visible {
        if let Err(error) = hud.hide() {
            crate::log_message("ERROR", "window", &format!("hide HUD: {error}"));
            return false;
        }
        false
    } else {
        if let Err(error) = hud.show() {
            crate::log_message("ERROR", "window", &format!("show HUD: {error}"));
            return false;
        }
        if let Err(error) = hud.set_focus() {
            crate::log_message("ERROR", "window", &format!("focus HUD: {error}"));
        }
        true
    }
}

pub fn toggle_quick_window(app: &AppHandle) -> bool {
    let Some(quick) = app.get_webview_window("quick") else {
        return false;
    };
    match quick.is_visible() {
        Ok(true) => {
            let _ = quick.hide();
            false
        }
        _ => {
            let _ = quick.show();
            let _ = quick.set_focus();
            true
        }
    }
}

pub fn open_quick_window(app: &AppHandle, prompt: Option<String>) {
    if let Some(quick) = app.get_webview_window("quick") {
        let _ = quick.show();
        let _ = quick.set_focus();
    }
    if let Some(text) = prompt.filter(|text| !text.trim().is_empty()) {
        events::emit(app, events::QUICK_PROMPT, QuickPrompt { text });
    }
}

#[tauri::command]
pub fn show_quick_palette(app: AppHandle) {
    open_quick_window(&app, None);
}

#[tauri::command]
pub fn show_quick_window(app: AppHandle, prompt: Option<String>) {
    open_quick_window(&app, prompt);
}

#[tauri::command]
pub fn toggle_quick(app: AppHandle) -> bool {
    toggle_quick_window(&app)
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
        if let Err(error) = hud.set_ignore_cursor_events(settings.hud.click_through) {
            crate::log_message(
                "ERROR",
                "window",
                &format!("apply HUD click-through: {error}"),
            );
        }
        if let Err(error) = hud.set_size(LogicalSize::new(
            settings.hud.width as f64,
            settings.hud.height as f64,
        )) {
            crate::log_message("ERROR", "window", &format!("resize HUD: {error}"));
        }
        if let Err(error) = hud.set_position(LogicalPosition::new(
            settings.hud.position_x as f64,
            settings.hud.position_y as f64,
        )) {
            crate::log_message("ERROR", "window", &format!("position HUD: {error}"));
        }
        // Pinning keeps the HUD at the saved position and on top of
        // other windows instead of dropping it behind the desktop.
        if let Err(error) = hud.set_always_on_top(true) {
            crate::log_message("ERROR", "window", &format!("set HUD priority: {error}"));
        }
        if settings.hud.pinned {
            if let Err(error) = hud.show() {
                crate::log_message("ERROR", "window", &format!("show pinned HUD: {error}"));
            }
            if let Err(error) = hud.set_focus() {
                crate::log_message("ERROR", "window", &format!("focus pinned HUD: {error}"));
            }
        }
    }
}

#[tauri::command]
pub fn set_hud_priority(app: AppHandle, foreground: bool) -> Result<(), String> {
    let settings = crate::commands::read_settings_from(&app);
    if !settings.hud.pinned {
        return Ok(());
    }

    let hud = app
        .get_webview_window("hud")
        .ok_or_else(|| "HUD ウィンドウが見つかりません".to_string())?;

    if settings.hud.pinned {
        // Fixed HUD: stay visible at the pinned spot, never drop behind.
        hud.set_always_on_top(true)
            .map_err(|error| format!("HUDを前面にできません: {error}"))?;
        hud.show()
            .map_err(|error| format!("HUDを表示できません: {error}"))?;
        return Ok(());
    }

    if foreground {
        hud.set_always_on_top(true)
            .map_err(|error| format!("HUDを前面にできません: {error}"))?;
        hud.show()
            .map_err(|error| format!("HUDを表示できません: {error}"))?;
    } else {
        hud.set_always_on_top(false)
            .map_err(|error| format!("HUDを背面にできません: {error}"))?;
        send_hud_to_back(&hud)?;
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_hud(app: AppHandle) -> bool {
    toggle_hud_window(&app)
}

#[tauri::command]
pub fn set_hud_visible(app: AppHandle, visible: bool) {
    if let Some(hud) = app.get_webview_window("hud") {
        let result = if visible { hud.show() } else { hud.hide() };
        if let Err(error) = result {
            crate::log_message("ERROR", "window", &format!("set HUD visibility: {error}"));
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
    match state.voice.lock() {
        Ok(mut voice) => {
            voice.state = state_name.clone();
            voice.detail = detail.clone();
        }
        Err(error) => {
            crate::log_message(
                "ERROR",
                "voice",
                &format!("voice state lock failed: {error}"),
            );
        }
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
pub fn apply_hud_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    apply_hud_options(&app, &settings);
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    show_main(&app);
}
