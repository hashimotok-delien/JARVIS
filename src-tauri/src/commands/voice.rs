use base64::{Engine as _, engine::general_purpose::STANDARD};
use tauri::{AppHandle, State};

use crate::speech::tts::AudioPayload;
use crate::state::AppState;

async fn transcribe_with_settings(
    app: AppHandle,
    settings: crate::models::Settings,
    audio_base64: String,
) -> Result<String, String> {
    let bytes = STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|e| format!("音声データを復号できません: {e}"))?;

    tokio::task::spawn_blocking(move || crate::speech::stt::transcribe(&app, &settings, &bytes))
        .await
        .map_err(|e| format!("文字起こしタスクが失敗しました: {e}"))?
}

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

    transcribe_with_settings(app, settings, audio_base64).await
}

#[tauri::command]
pub async fn transcribe_wake_sample(
    app: AppHandle,
    state: State<'_, AppState>,
    audio_base64: String,
    wake_samples: Vec<String>,
) -> Result<String, String> {
    let mut settings = crate::commands::read_settings(&state);
    settings.stt.wake_samples = wake_samples;
    let settings = settings.sanitized();
    transcribe_with_settings(app, settings, audio_base64).await
}

#[tauri::command]
pub async fn speak(state: State<'_, AppState>, text: String) -> Result<AudioPayload, String> {
    let settings = crate::commands::read_settings(&state);
    if !settings.tts.enabled {
        return Err("読み上げはミュートされています".into());
    }
    crate::speech::tts::synthesize(&settings, &text).await
}
