use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, State};

use crate::speech::tts::AudioPayload;
use crate::state::AppState;

/// Transcribe a base64-encoded 16-bit PCM WAV recording.
#[tauri::command]
pub async fn transcribe(
    app: AppHandle,
    state: State<'_, AppState>,
    audio_base64: String,
) -> Result<String, String> {
    let settings = crate::commands::read_settings(&state);
    if !settings.stt.enabled {
        return Err("音声入力は無効になっています".into());
    }

    let bytes = STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|e| format!("音声データを復号できません: {e}"))?;

    let handle = app.clone();
    tokio::task::spawn_blocking(move || {
        crate::speech::stt::transcribe(&handle, &settings, &bytes)
    })
    .await
    .map_err(|e| format!("文字起こしタスクが失敗しました: {e}"))?
}

#[tauri::command]
pub async fn speak(
    state: State<'_, AppState>,
    text: String,
) -> Result<AudioPayload, String> {
    let settings = crate::commands::read_settings(&state);
    if !settings.tts.enabled {
        return Err("読み上げはミュートされています".into());
    }
    crate::speech::tts::synthesize(&settings, &text).await
}
