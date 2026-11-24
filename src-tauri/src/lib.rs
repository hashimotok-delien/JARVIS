mod commands;
mod db;
mod events;
mod models;
mod paths;
mod providers;
mod secrets;
mod speech;
mod state;
mod tools;

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::state::AppState;

fn state_log_path() -> PathBuf {
    paths::log_dir().join("jarvis.log")
}

fn timestamp_utc() -> String {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let days = (elapsed.as_secs() / 86_400) as i64;
    let seconds = elapsed.as_secs() % 86_400;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    };
    let year = if month <= 2 { year + 1 } else { year };

    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        seconds / 3_600,
        seconds % 3_600 / 60,
        seconds % 60,
        elapsed.subsec_millis()
    )
}

pub(crate) fn log_message(level: &str, source: &str, message: &str) {
    use std::io::Write;

    static LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let safe_message = message.replace('\r', " ").replace('\n', " ");
    let line = format!(
        "{} [{}] [{}] {}\n",
        timestamp_utc(),
        level.to_uppercase(),
        source,
        safe_message
    );
    let lock = LOG_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = match lock.lock() {
        Ok(guard) => guard,
        Err(error) => {
            eprintln!("JARVIS logger lock failed: {error}");
            return;
        }
    };
    let path = state_log_path();
    if let Some(parent) = path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            eprintln!("JARVIS log directory creation failed: {error}");
            return;
        }
    }
    let result = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut file| file.write_all(line.as_bytes()));
    if let Err(error) = result {
        eprintln!("JARVIS log write failed: {error}");
    }
}

fn install_panic_logger() {
    std::panic::set_hook(Box::new(|info| {
        log_message("ERROR", "panic", &info.to_string());
    }));
}

fn install_tls_crypto_provider() {
    if rustls::crypto::ring::default_provider()
        .install_default()
        .is_err()
    {
        log_message("INFO", "tls", "Rustls CryptoProvider was already installed");
    }
}

fn read_version_file(dir: &Path) -> Option<String> {
    std::fs::read_to_string(dir.join("version.txt"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();

    let show_item = MenuItem::with_id(handle, "show", "表示", true, None::<&str>)?;
    let hud_item = MenuItem::with_id(handle, "hud", "HUD 切替", true, None::<&str>)?;
    let voice_item = MenuItem::with_id(handle, "voice", "音声入力", true, None::<&str>)?;
    let mute_item = MenuItem::with_id(handle, "mute", "ミュート切替", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(handle, "quit", "終了", true, None::<&str>)?;

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
            "voice" => events::emit(app, events::VOICE_TOGGLE, "toggle".to_string()),
            "mute" => {
                if let Err(error) = commands::app::toggle_mute_impl(app) {
                    log_message("ERROR", "tray", &format!("toggle mute: {error}"));
                }
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

fn apply_window_icons(app: &tauri::App) {
    let Some(icon) = app.default_window_icon() else {
        log_message("ERROR", "window", "default application icon is missing");
        return;
    };

    for label in ["main", "hud"] {
        if let Some(window) = app.get_webview_window(label) {
            if let Err(error) = window.set_icon(icon.clone()) {
                log_message(
                    "ERROR",
                    "window",
                    &format!("set {label} window icon: {error}"),
                );
            }
        }
    }
}

fn register_shortcuts(app: &AppHandle) {
    let shortcuts = [
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space),
            "Ctrl+Alt+Space（音声入力）",
        ),
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyH),
            "Ctrl+Alt+H（HUD）",
        ),
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyQ),
            "Ctrl+Alt+Q（クイック入力）",
        ),
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyS),
            "Ctrl+Alt+S（選択テキストをJARVISへ）",
        ),
    ];

    // A conflicting shortcut must never prevent the app from starting.
    for (shortcut, label) in shortcuts {
        if let Err(error) = app.global_shortcut().register(shortcut) {
            log_message(
                "ERROR",
                "shortcut",
                &format!("グローバルショートカット {label} を登録できません: {error}"),
            );
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();
    install_tls_crypto_provider();

    // Open the database and register the state *before* the app runs so
    // window scripts can never invoke a command before `manage()`.
    let data_dir = paths::resolve_data_dir_headless();
    if let Err(error) = std::fs::create_dir_all(&data_dir) {
        log_message("ERROR", "startup", &format!("create data dir: {error}"));
    }
    let conn = db::open(&data_dir.join("jarvis.db")).or_else(|error| {
        log_message(
            "ERROR",
            "startup",
            &format!("open database, trying recovery file: {error}"),
        );
        db::open(&data_dir.join("jarvis-recovery.db")).or_else(|error| {
            log_message(
                "ERROR",
                "startup",
                &format!("recovery database failed, using memory: {error}"),
            );
            db::open_memory()
        })
    });
    let conn = match conn {
        Ok(conn) => conn,
        Err(error) => {
            log_message("ERROR", "startup", &format!("no database available: {error}"));
            return;
        }
    };

    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let previous_version =
        read_version_file(&data_dir).filter(|version| version != &current_version);
    if let Err(error) = std::fs::write(data_dir.join("version.txt"), &current_version) {
        log_message("ERROR", "startup", &format!("version.txt: {error}"));
    }

    let state = AppState::new(conn, data_dir);
    if let Ok(mut slot) = state.previous_version.lock() {
        *slot = previous_version;
    }

    let result = tauri::Builder::default()
        .manage(state)
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
                    if shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::Space) {
                        events::emit(app, events::VOICE_TOGGLE, "toggle".to_string());
                    } else if shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyH) {
                        commands::app::toggle_hud_window(app);
                    } else if shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyQ) {
                        commands::app::toggle_quick_window(app);
                    } else if shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyS) {
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let text = tauri::async_runtime::spawn_blocking(
                                commands::tools::capture_selection,
                            )
                            .await
                            .ok()
                            .and_then(Result::ok)
                            .unwrap_or_default();
                            commands::app::open_quick_window(&handle, Some(text));
                        });
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
                    if let Err(error) = window.hide() {
                        log_message("ERROR", "window", &format!("hide main on close: {error}"));
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::app::write_log,
            commands::app::toggle_hud,
            commands::app::set_hud_visible,
            commands::app::set_hud_priority,
            commands::app::request_voice_toggle,
            commands::app::report_voice_state,
            commands::app::toggle_mute,
            commands::app::apply_hud_settings,
            commands::app::get_hud_geometry,
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
            commands::voice::transcribe_wake_sample,
            commands::voice::speak,
            commands::app::toggle_quick,
            commands::app::show_quick_palette,
            commands::app::show_quick_window,
            commands::memory::list_memories,
            commands::memory::add_memory,
            commands::memory::update_memory,
            commands::memory::delete_memory,
            commands::memory::summarize_thread,
            commands::memory::daily_digest,
            commands::data::search_messages,
            commands::data::truncate_from_message,
            commands::data::branch_thread,
            commands::data::usage_stats,
            commands::data::list_templates,
            commands::data::add_template,
            commands::data::delete_template,
            commands::data::export_all,
            commands::data::backup_database,
            commands::tools::read_clipboard_text,
            commands::tools::write_clipboard_text,
            commands::tools::capture_screen_image,
            commands::tools::resolve_tool_approval,
            commands::tools::notify_desktop,
            commands::tools::set_timer_now,
            commands::tools::capture_selection,
            commands::tools::transcribe_audio_file,
            commands::update::check_update,
            commands::update::launch_update_installer,
            commands::update::open_update_dir,
            commands::dialog::pick_file,
            commands::dialog::pick_folder,
        ])
        .setup(|app| {
            let handle = app.handle();
            let current_version = env!("CARGO_PKG_VERSION").to_string();

            apply_window_icons(app);
            setup_tray(app)?;
            register_shortcuts(handle);

            let settings = commands::read_settings_from(handle);
            commands::app::apply_hud_options(handle, &settings);

            if settings.start_minimized {
                if let Some(main) = handle.get_webview_window("main") {
                    if let Err(error) = main.hide() {
                        log_message("ERROR", "startup", &format!("hide main window: {error}"));
                    }
                }
            }

            log_message(
                "INFO",
                "startup",
                &format!("JARVIS v{current_version} started"),
            );
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = result {
        log_message("ERROR", "startup", &error.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tls_crypto_provider_is_installed() {
        install_tls_crypto_provider();
        assert!(rustls::crypto::CryptoProvider::get_default().is_some());
    }
}
