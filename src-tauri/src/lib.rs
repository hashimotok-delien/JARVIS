mod commands;
mod db;
mod events;
mod models;
mod paths;
mod providers;
mod secrets;
mod speech;
mod state;

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

use crate::state::AppState;

fn state_log_path() -> PathBuf {
    paths::log_dir().join("startup.log")
}

fn append_log(message: &str) {
    use std::io::Write;

    let path = state_log_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(file, "{message}");
    }
}

fn install_panic_logger() {
    std::panic::set_hook(Box::new(|info| {
        append_log(&format!("[panic] {info}"));
    }));
}

fn read_version_file(dir: &Path) -> Option<String> {
    std::fs::read_to_string(dir.join("version.txt"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn write_version_file(dir: &Path, version: &str) {
    let _ = std::fs::write(dir.join("version.txt"), version);
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();

    let show_item =
        MenuItem::with_id(handle, "show", "表示", true, None::<&str>)?;
    let hud_item =
        MenuItem::with_id(handle, "hud", "HUD 切替", true, None::<&str>)?;
    let voice_item =
        MenuItem::with_id(handle, "voice", "音声入力", true, None::<&str>)?;
    let mute_item =
        MenuItem::with_id(handle, "mute", "ミュート切替", true, None::<&str>)?;
    let quit_item =
        MenuItem::with_id(handle, "quit", "終了", true, None::<&str>)?;

    let menu = Menu::with_items(
        handle,
        &[&show_item, &hud_item, &voice_item, &mute_item, &quit_item],
    )?;

    let mut tray = TrayIconBuilder::with_id("jarvis-tray")
        .tooltip("J.A.R.V.I.S.")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => commands::app::show_main(app),
            "hud" => {
                commands::app::toggle_hud_window(app);
            }
            "voice" => {
                events::emit(app, events::VOICE_TOGGLE, "toggle".to_string())
            }
            "mute" => {
                let _ = commands::app::toggle_mute_impl(app);
            }
            "quit" => {
                if let Some(state) = app.try_state::<AppState>() {
                    state.quitting.store(true, Ordering::Relaxed);
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                commands::app::show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    Ok(())
}

fn register_shortcuts(app: &AppHandle) {
    let shortcuts = [
        (
            Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::ALT),
                Code::Space,
            ),
            "Ctrl+Alt+Space（音声入力）",
        ),
        (
            Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::ALT),
                Code::KeyH,
            ),
            "Ctrl+Alt+H（HUD）",
        ),
    ];

    // A conflicting shortcut must never prevent the app from starting.
    for (shortcut, label) in shortcuts {
        if let Err(error) = app.global_shortcut().register(shortcut) {
            eprintln!("グローバルショートカット {label} を登録できません: {error}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            commands::app::show_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut.matches(
                        Modifiers::CONTROL | Modifiers::ALT,
                        Code::Space,
                    ) {
                        events::emit(
                            app,
                            events::VOICE_TOGGLE,
                            "toggle".to_string(),
                        );
                    } else {
                        commands::app::toggle_hud_window(app);
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "main" {
                    return;
                }
                let app = window.app_handle();
                let quitting = app
                    .try_state::<AppState>()
                    .map(|state| state.quitting.load(Ordering::Relaxed))
                    .unwrap_or(false);
                if !quitting {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::app::toggle_hud,
            commands::app::set_hud_visible,
            commands::app::request_voice_toggle,
            commands::app::report_voice_state,
            commands::app::toggle_mute,
            commands::app::apply_hud_settings,
            commands::app::show_main_window,
            commands::threads::list_threads,
            commands::threads::create_thread,
            commands::threads::rename_thread,
            commands::threads::delete_thread,
            commands::threads::set_thread_pinned,
            commands::threads::list_messages,
            commands::threads::export_thread,
            commands::chat::send_message,
            commands::chat::stop_generation,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::set_gemini_key,
            commands::settings::test_providers,
            commands::voice::transcribe,
            commands::voice::speak,
            commands::update::check_update,
            commands::update::launch_update_installer,
            commands::update::open_update_dir,
        ])
        .setup(|app| {
            let handle = app.handle();

            let data_dir = paths::resolve_data_dir(handle);
            std::fs::create_dir_all(&data_dir)?;
            let conn = db::open(&data_dir.join("jarvis.db"))
                .map_err(std::io::Error::other)?;

            let current_version = env!("CARGO_PKG_VERSION").to_string();
            let previous_version = read_version_file(&data_dir)
                .filter(|version| version != &current_version);
            write_version_file(&data_dir, &current_version);

            let state = AppState::new(conn, data_dir);
            if let Ok(mut slot) = state.previous_version.lock() {
                *slot = previous_version;
            }
            app.manage(state);

            setup_tray(app)?;
            register_shortcuts(handle);

            let settings = commands::read_settings_from(handle);
            commands::app::apply_hud_options(handle, &settings);

            if settings.start_minimized {
                if let Some(main) = handle.get_webview_window("main") {
                    let _ = main.hide();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = result {
        append_log(&format!("[startup] {error}"));
    }
}
