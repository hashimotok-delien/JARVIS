//! Desktop-integration commands exposed to the UI.

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedImage {
    pub base64: String,
    pub path: String,
}

#[tauri::command]
pub fn read_clipboard_text() -> Result<String, String> {
    crate::tools::clipboard_text()
}

#[tauri::command]
pub fn write_clipboard_text(text: String) -> Result<(), String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let encoded = STANDARD.encode(text.as_bytes());
    let mut command = std::process::Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &format!(
            "Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded}')))"
        ),
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .output()
        .map(|_| ())
        .map_err(|error| format!("クリップボードに書き込めません: {error}"))
}

#[tauri::command]
pub fn capture_screen_image(app: AppHandle) -> Result<CapturedImage, String> {
    let (base64, path) = crate::tools::screenshot_base64(&app)?;
    Ok(CapturedImage { base64, path })
}

#[tauri::command]
pub fn resolve_tool_approval(app: AppHandle, id: String, approved: bool) -> bool {
    crate::tools::resolve_approval(&app, &id, approved)
}

#[tauri::command]
pub fn notify_desktop(title: String, body: String) {
    crate::tools::notify(&title, &body);
}

#[tauri::command]
pub fn set_timer_now(app: AppHandle, minutes: f64, label: Option<String>) -> Result<(), String> {
    let args = serde_json::json!({
        "minutes": minutes,
        "label": label.unwrap_or_else(|| "タイマー".to_string()),
    });
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app_clone.state::<AppState>();
        let settings = {
            let conn = match state.db.lock() {
                Ok(conn) => conn,
                Err(_) => return,
            };
            crate::db::load_settings(&conn)
        };
        let _ = crate::tools::execute(&app_clone, &settings, "set_timer", &args).await;
    });
    Ok(())
}

/// Grab the current selection by sending Ctrl+C to the focused window.
#[tauri::command]
pub fn capture_selection() -> Result<String, String> {
    let script = "Add-Type -AssemblyName System.Windows.Forms; \
         [System.Windows.Forms.SendKeys]::SendWait('^c'); \
         Start-Sleep -Milliseconds 250; \
         [Console]::Out.Write((Get-Clipboard -Raw -ErrorAction SilentlyContinue))";
    let mut command = std::process::Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command
        .output()
        .map_err(|error| format!("選択範囲を取得できません: {error}"))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub async fn transcribe_audio_file(
    app: AppHandle,
    state: State<'_, AppState>,
    audio_base64: String,
) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let settings = crate::commands::read_settings(&state);
    if !settings.stt.enabled {
        return Err("音声入力は無効になっています".into());
    }
    let bytes = STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|error| format!("音声データを復号できません: {error}"))?;
    tokio::task::spawn_blocking(move || crate::speech::stt::transcribe(&app, &settings, &bytes))
        .await
        .map_err(|error| format!("文字起こしタスクが失敗しました: {error}"))?
}
