use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, State,
};

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
    // Inner size matches what `set_size` applies, so pinning does not drift.
    let size = hud.inner_size().ok()?.to_logical::<f64>(scale);
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

/// Whether the window still carries the topmost bit.
///
/// A HUD pushed to the back (hands-free idle) stays visible, so a plain
/// visibility check would make the toggle hide it instead of bringing it
/// forward again.
#[cfg(windows)]
fn hud_is_topmost(hud: &tauri::WebviewWindow) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowLongPtrW, WS_EX_TOPMOST,
    };

    let Ok(hwnd) = hud.hwnd() else {
        return true;
    };
    let style = unsafe { GetWindowLongPtrW(hwnd.0, GWL_EXSTYLE) };
    (style as u32 & WS_EX_TOPMOST) != 0
}

#[cfg(not(windows))]
fn hud_is_topmost(_hud: &tauri::WebviewWindow) -> bool {
    true
}

/// Force the window above other windows at the Win32 level as well, so a HUD
/// that was dropped to the bottom is reliably raised even if Tauri's cached
/// always-on-top flag is out of sync.
#[cfg(windows)]
fn raise_hud_window(hud: &tauri::WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowPos,
    };

    let hwnd = hud
        .hwnd()
        .map_err(|error| format!("HUDのウィンドウハンドルを取得できません: {error}"))?;
    let result = unsafe {
        SetWindowPos(
            hwnd.0,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
        )
    };
    if result == 0 {
        return Err("HUDを前面に移動できません".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn raise_hud_window(_hud: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
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

    if visible && !hud_is_topmost(&hud) {
        // It was sent to the back while idle: raising it is what the user
        // means by "show the HUD".
        if let Err(error) = hud.set_always_on_top(true) {
            crate::log_message("ERROR", "window", &format!("raise HUD: {error}"));
        }
        if let Err(error) = raise_hud_window(&hud) {
            crate::log_message("ERROR", "window", &format!("raise HUD: {error}"));
        }
        if let Err(error) = hud.set_focus() {
            crate::log_message("ERROR", "window", &format!("focus HUD: {error}"));
        }
        return true;
    }

    if visible {
        // Persist where it is before hiding so a restart restores it.
        flush_hud_geometry(app);
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
        if let Err(error) = hud.unminimize() {
            crate::log_message("ERROR", "window", &format!("unminimize HUD: {error}"));
        }
        // A previous idle transition may have dropped the always-on-top flag,
        // leaving the HUD rendered behind the main window. Re-raise it here so
        // an explicit toggle always brings it to the front.
        if let Err(error) = hud.set_always_on_top(true) {
            crate::log_message("ERROR", "window", &format!("raise HUD: {error}"));
        }
        if let Err(error) = raise_hud_window(&hud) {
            crate::log_message("ERROR", "window", &format!("raise HUD: {error}"));
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

/// Resolve the saved (logical) HUD position into physical pixels.
///
/// Tauri converts logical coordinates with the *current* monitor's scale, so
/// restoring a position that was saved on a monitor with a different DPI used
/// to land on the wrong screen (and could fall back to the default corner).
/// Trying every monitor's scale finds the display the value was captured on.
fn resolve_hud_position(
    hud: &tauri::WebviewWindow,
    desired: LogicalPosition<f64>,
    size: LogicalSize<f64>,
) -> PhysicalPosition<i32> {
    let monitors = hud.available_monitors().unwrap_or_default();
    if monitors.is_empty() {
        let scale = hud.scale_factor().unwrap_or(1.0);
        return PhysicalPosition::new(
            (desired.x * scale).round() as i32,
            (desired.y * scale).round() as i32,
        );
    }

    let mut best: Option<(f64, PhysicalPosition<i32>)> = None;
    for monitor in &monitors {
        let scale = monitor.scale_factor();
        let origin = monitor.position();
        let monitor_size = monitor.size();

        let left = desired.x * scale;
        let top = desired.y * scale;
        let right = left + size.width * scale;
        let bottom = top + size.height * scale;
        let monitor_right = origin.x as f64 + monitor_size.width as f64;
        let monitor_bottom = origin.y as f64 + monitor_size.height as f64;

        let overlap_x = right.min(monitor_right) - left.max(origin.x as f64);
        let overlap_y = bottom.min(monitor_bottom) - top.max(origin.y as f64);
        if overlap_x < 16.0 || overlap_y < 16.0 {
            continue;
        }

        let score = overlap_x.min(overlap_y);
        if best.is_none_or(|(best_score, _)| score > best_score) {
            best = Some((
                score,
                PhysicalPosition::new(left.round() as i32, top.round() as i32),
            ));
        }
    }
    if let Some((_, position)) = best {
        return position;
    }

    // The saved display is gone: park it near the primary monitor's corner.
    let primary = hud
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.first().cloned());
    match primary {
        Some(monitor) => {
            let scale = monitor.scale_factor();
            let origin = monitor.position();
            PhysicalPosition::new(
                origin.x + (50.0 * scale).round() as i32,
                origin.y + (50.0 * scale).round() as i32,
            )
        }
        None => {
            let scale = hud.scale_factor().unwrap_or(1.0);
            PhysicalPosition::new(
                (desired.x * scale).round() as i32,
                (desired.y * scale).round() as i32,
            )
        }
    }
}

/// Note that the HUD moved/resized so the background flusher persists it.
pub fn note_hud_geometry_change(app: &AppHandle) {
    let state = app.state::<AppState>();
    if let Ok(mut slot) = state.hud_dirty.lock() {
        *slot = Some(std::time::Instant::now());
    }
}

/// Persist the current HUD geometry if it differs from the saved one.
///
/// The webview's `onMoved` can miss events while the OS drag loop is running,
/// which made the position reset on the next launch. Tracking it natively
/// keeps the saved value accurate.
pub fn flush_hud_geometry(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Some((x, y, width, height)) = hud_geometry(app) else {
        return;
    };

    let mut settings = crate::commands::read_settings(&state);
    if settings.hud.position_x == x
        && settings.hud.position_y == y
        && settings.hud.width == width
        && settings.hud.height == height
    {
        return;
    }

    settings.hud.position_x = x;
    settings.hud.position_y = y;
    settings.hud.width = width;
    settings.hud.height = height;
    {
        let Ok(conn) = state.db.lock() else {
            return;
        };
        if let Err(error) = db::save_settings(&conn, &settings) {
            crate::log_message("ERROR", "hud", &format!("save geometry: {error}"));
            return;
        }
    }
    crate::log_message(
        "DEBUG",
        "hud",
        &format!("geometry saved x={x} y={y} w={width} h={height}"),
    );
    events::emit(app, events::SETTINGS_CHANGED, settings);
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
        // Pinned HUDs keep a fixed size; unpinned ones can be dragged larger.
        if let Err(error) = hud.set_resizable(!settings.hud.pinned) {
            crate::log_message(
                "ERROR",
                "window",
                &format!("apply HUD resizable: {error}"),
            );
        }
        let size = LogicalSize::new(
            settings.hud.width as f64,
            settings.hud.height as f64,
        );
        let desired = LogicalPosition::new(
            settings.hud.position_x as f64,
            settings.hud.position_y as f64,
        );
        let target = resolve_hud_position(&hud, desired, size);
        crate::log_message(
            "DEBUG",
            "hud",
            &format!(
                "apply geometry x={} y={} w={} h={} pinned={} -> physical {},{}",
                settings.hud.position_x,
                settings.hud.position_y,
                settings.hud.width,
                settings.hud.height,
                settings.hud.pinned,
                target.x,
                target.y
            ),
        );
        // Position first: moving to a monitor with a different DPI rescales
        // the window, so the size has to be applied afterwards.
        if let Err(error) = hud.set_position(target) {
            crate::log_message("ERROR", "window", &format!("position HUD: {error}"));
        }
        if let Err(error) = hud.set_size(size) {
            crate::log_message("ERROR", "window", &format!("resize HUD: {error}"));
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
        let result = if visible {
            hud.set_always_on_top(true)
                .and_then(|_| hud.show())
                .and_then(|_| hud.unminimize())
        } else {
            flush_hud_geometry(&app);
            hud.hide()
        };
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
    crate::status::apply(&app, &state_name);
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

/// Persist the HUD position/size after the user drags it.
#[tauri::command]
pub fn save_hud_geometry(
    app: AppHandle,
    state: State<'_, AppState>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let mut settings = crate::commands::read_settings(&state);
    if settings.hud.position_x == x
        && settings.hud.position_y == y
        && settings.hud.width == width
        && settings.hud.height == height
    {
        return Ok(());
    }

    settings.hud.position_x = x;
    settings.hud.position_y = y;
    settings.hud.width = width;
    settings.hud.height = height;
    {
        let conn = crate::commands::lock_db(&state)?;
        db::save_settings(&conn, &settings)?;
    }
    events::emit(&app, events::SETTINGS_CHANGED, settings);
    Ok(())
}

/// Toggle hands-free from the HUD without re-applying window geometry.
#[tauri::command]
pub fn set_hands_free(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = crate::commands::read_settings(&state);
    if settings.stt.hands_free == enabled {
        return Ok(());
    }
    settings.stt.hands_free = enabled;
    {
        let conn = crate::commands::lock_db(&state)?;
        db::save_settings(&conn, &settings)?;
    }
    events::emit(&app, events::SETTINGS_CHANGED, settings);
    Ok(())
}

/// Pin or unpin the HUD from the HUD itself.
#[tauri::command]
pub fn set_hud_pinned(
    app: AppHandle,
    state: State<'_, AppState>,
    pinned: bool,
) -> Result<(), String> {
    let mut settings = crate::commands::read_settings(&state);
    if settings.hud.pinned == pinned {
        return Ok(());
    }
    // Pinning freezes the current spot/size.
    if pinned {
        if let Some((x, y, width, height)) = hud_geometry(&app) {
            settings.hud.position_x = x;
            settings.hud.position_y = y;
            settings.hud.width = width;
            settings.hud.height = height;
        }
    }
    settings.hud.pinned = pinned;
    {
        let conn = crate::commands::lock_db(&state)?;
        db::save_settings(&conn, &settings)?;
    }
    apply_hud_options(&app, &settings);
    events::emit(&app, events::SETTINGS_CHANGED, settings);
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    show_main(&app);
}

/// Show the main window if it is hidden or minimized, otherwise hide it.
#[tauri::command]
pub fn toggle_main_window(app: AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    if visible && !minimized {
        if let Err(error) = window.hide() {
            crate::log_message("ERROR", "window", &format!("hide main: {error}"));
        }
        return;
    }
    show_main(&app);
}
