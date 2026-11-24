use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

#[derive(serde::Serialize)]
struct AppInfo {
    name: String,
    version: String,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "J.A.R.V.I.S.".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn toggle_hud_window(app: &AppHandle) -> bool {
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

#[tauri::command]
fn toggle_hud(app: AppHandle) -> bool {
    toggle_hud_window(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_hud_window(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![app_info, toggle_hud])
        .setup(|app| {
            let handle = app.handle();

            let show_item =
                MenuItem::with_id(handle, "show", "表示", true, None::<&str>)?;
            let hud_item =
                MenuItem::with_id(handle, "hud", "HUD 切替", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(handle, "quit", "終了", true, None::<&str>)?;
            let menu =
                Menu::with_items(handle, &[&show_item, &hud_item, &quit_item])?;

            let mut tray = TrayIconBuilder::with_id("jarvis-tray")
                .tooltip("J.A.R.V.I.S.")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main(app),
                    "hud" => {
                        toggle_hud_window(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            let shortcut = Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::ALT),
                Code::Space,
            );
            app.global_shortcut().register(shortcut)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
