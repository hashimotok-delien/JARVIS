//! Download of the speech.cpp recognizer weights (Haas-ja-v1.0, Q8_0).

use std::io::Read;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::io::AsyncWriteExt;

use crate::events;
use crate::models::{HAAS_MODEL_BYTES, HAAS_MODEL_FILE};
use crate::paths;
use crate::state::AppState;

const MODEL_URL: &str =
    "https://huggingface.co/sakasegawa/Haas-ja-v1.0-GGUF/resolve/main/Haas-616M-ja-v1.0-Q8_0.gguf";
const RELEASE_API: &str = "https://api.github.com/repos/nyosegawa/speech.cpp/releases/latest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModelStatus {
    pub path: String,
    pub present: bool,
    pub bytes: u64,
    pub expected_bytes: u64,
    pub url: String,
}

fn is_complete(path: &std::path::Path) -> bool {
    std::fs::metadata(path)
        .map(|meta| meta.len() == HAAS_MODEL_BYTES)
        .unwrap_or(false)
}

#[tauri::command]
pub fn speech_model_status(state: State<'_, AppState>) -> SpeechModelStatus {
    let path = paths::models_dir(&state.data_dir).join(HAAS_MODEL_FILE);
    let bytes = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);

    SpeechModelStatus {
        path: path.to_string_lossy().to_string(),
        present: bytes == HAAS_MODEL_BYTES,
        bytes,
        expected_bytes: HAAS_MODEL_BYTES,
        url: MODEL_URL.to_string(),
    }
}

#[tauri::command]
pub async fn download_speech_model(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let dir = paths::models_dir(&state.data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("モデル用フォルダを作成できません: {e}"))?;
    let target = dir.join(HAAS_MODEL_FILE);
    if is_complete(&target) {
        return Ok(target.to_string_lossy().to_string());
    }

    let partial = dir.join(format!("{HAAS_MODEL_FILE}.part"));
    let client = reqwest::Client::new();
    let response = client
        .get(MODEL_URL)
        .send()
        .await
        .map_err(|e| format!("モデルを取得できません: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "モデルを取得できません: HTTP {}",
            response.status()
        ));
    }

    let total = response.content_length().unwrap_or(HAAS_MODEL_BYTES);
    let mut file = tokio::fs::File::create(&partial)
        .await
        .map_err(|e| format!("モデルを書き込めません: {e}"))?;
    let mut stream = response.bytes_stream();
    let mut received = 0u64;
    let mut notified = 0u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("モデルの受信に失敗しました: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("モデルを書き込めません: {e}"))?;
        received += chunk.len() as u64;
        if received - notified >= 4 * 1024 * 1024 {
            notified = received;
            events::emit(
                &app,
                events::SPEECH_MODEL_PROGRESS,
                events::SpeechModelProgress { received, total },
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("モデルを書き込めません: {e}"))?;
    drop(file);

    if received != HAAS_MODEL_BYTES {
        let _ = tokio::fs::remove_file(&partial).await;
        return Err(format!(
            "モデルのサイズが想定と違います（{received} / {HAAS_MODEL_BYTES} バイト）"
        ));
    }

    let mut head = [0u8; 4];
    let mut probe =
        std::fs::File::open(&partial).map_err(|e| format!("モデルを確認できません: {e}"))?;
    probe
        .read_exact(&mut head)
        .map_err(|e| format!("モデルを確認できません: {e}"))?;
    drop(probe);
    if &head != b"GGUF" {
        let _ = tokio::fs::remove_file(&partial).await;
        return Err("ダウンロードしたファイルが GGUF ではありません".to_string());
    }

    tokio::fs::rename(&partial, &target)
        .await
        .map_err(|e| format!("モデルを配置できません: {e}"))?;

    if let Ok(mut worker) = state.asr_worker.lock() {
        *worker = None;
    }
    events::emit(
        &app,
        events::SPEECH_MODEL_PROGRESS,
        events::SpeechModelProgress { received, total },
    );

    Ok(target.to_string_lossy().to_string())
}

/// Extract `speech.exe` from the newest speech.cpp Windows release.
#[tauri::command]
pub async fn install_speech_binary(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let bin_dir = state.data_dir.join("bin");
    std::fs::create_dir_all(&bin_dir).map_err(|e| format!("フォルダを作成できません: {e}"))?;
    let target = bin_dir.join("speech.exe");

    let client = reqwest::Client::new();
    let release: serde_json::Value = client
        .get(RELEASE_API)
        .header("User-Agent", "JARVIS")
        .send()
        .await
        .map_err(|e| format!("speech.cpp の情報を取得できません: {e}"))?
        .json()
        .await
        .map_err(|e| format!("speech.cpp の情報を解析できません: {e}"))?;

    let url = release
        .get("assets")
        .and_then(|assets| assets.as_array())
        .and_then(|assets| {
            assets.iter().find_map(|asset| {
                let name = asset.get("name").and_then(|value| value.as_str())?;
                if name.contains("windows-x64") && name.ends_with(".zip") {
                    asset
                        .get("browser_download_url")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                } else {
                    None
                }
            })
        })
        .ok_or_else(|| "Windows 版 speech.cpp が見つかりません".to_string())?;

    let response = client
        .get(&url)
        .header("User-Agent", "JARVIS")
        .send()
        .await
        .map_err(|e| format!("speech.cpp を取得できません: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "speech.cpp を取得できません: HTTP {}",
            response.status()
        ));
    }
    let total = response.content_length().unwrap_or(0);

    let archive = state.data_dir.join("bin").join("speech.zip");
    let mut file = tokio::fs::File::create(&archive)
        .await
        .map_err(|e| format!("speech.cpp を書き込めません: {e}"))?;
    let mut stream = response.bytes_stream();
    let mut received = 0u64;
    let mut notified = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("speech.cpp の受信に失敗しました: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("speech.cpp を書き込めません: {e}"))?;
        received += chunk.len() as u64;
        if received - notified >= 4 * 1024 * 1024 {
            notified = received;
            events::emit(
                &app,
                events::SPEECH_MODEL_PROGRESS,
                events::SpeechModelProgress { received, total },
            );
        }
    }
    drop(file);

    let script = format!(
        "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
        archive.to_string_lossy().replace('\'', "''"),
        bin_dir.to_string_lossy().replace('\'', "''"),
    );
    let mut command = tokio::process::Command::new("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let output = command
        .output()
        .await
        .map_err(|e| format!("speech.cpp を展開できません: {e}"))?;
    let _ = tokio::fs::remove_file(&archive).await;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("speech.cpp を展開できません: {detail}"));
    }
    if !target.is_file() {
        return Err("speech.exe が見つかりません".to_string());
    }

    events::emit(
        &app,
        events::SPEECH_MODEL_PROGRESS,
        events::SpeechModelProgress {
            received: total,
            total,
        },
    );
    Ok(target.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_model_is_not_complete() {
        assert!(!is_complete(std::path::Path::new(
            "D:\\nowhere\\missing.gguf"
        )));
    }
}
