//! Colored status icons for the tray and the taskbar button.

use tauri::image::Image;
use tauri::{AppHandle, Manager};

/// (RGBA, label) for each HUD state.
fn palette(state: &str) -> ([u8; 4], &'static str) {
    match state {
        "listening" => ([59, 130, 246, 255], "聞き取り中"),
        "thinking" => ([251, 191, 36, 255], "思考中"),
        "speaking" => ([34, 211, 238, 255], "発話中"),
        _ => ([52, 211, 153, 255], "待機"),
    }
}

fn status_icon(state: &str) -> Image<'static> {
    const SIZE: u32 = 32;
    let (color, _) = palette(state);
    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    let center = SIZE as f32 / 2.0;

    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 + 0.5 - center;
            let dy = y as f32 + 0.5 - center;
            let distance = (dx * dx + dy * dy).sqrt();
            let index = ((y * SIZE + x) * 4) as usize;

            if distance <= 9.0 {
                rgba[index..index + 4].copy_from_slice(&color);
            } else if distance <= 12.5 {
                let alpha = (((12.5 - distance) / 3.5) * 130.0) as u8;
                rgba[index] = color[0];
                rgba[index + 1] = color[1];
                rgba[index + 2] = color[2];
                rgba[index + 3] = alpha;
            }
        }
    }

    Image::new_owned(rgba, SIZE, SIZE)
}

/// Paint the tray icon and the taskbar icon with the current state color.
pub fn apply(app: &AppHandle, state: &str) {
    let (_, label) = palette(state);

    if let Some(tray) = app.tray_by_id("jarvis-tray") {
        if let Err(error) = tray.set_icon(Some(status_icon(state))) {
            crate::log_message("ERROR", "status", &format!("tray icon: {error}"));
        }
        let tooltip = format!("J.A.R.V.I.S. — {label}");
        if let Err(error) = tray.set_tooltip(Some(tooltip.as_str())) {
            crate::log_message("ERROR", "status", &format!("tray tooltip: {error}"));
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.set_icon(status_icon(state)) {
            crate::log_message("ERROR", "status", &format!("window icon: {error}"));
        }
    }
}
