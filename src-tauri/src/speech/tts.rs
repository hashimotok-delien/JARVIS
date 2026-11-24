//! Text-to-speech: edge-tts WebSocket protocol with Windows SAPI fallback.

use base64::{Engine as _, engine::general_purpose::STANDARD};
use edge_tts_rust::{Boundary, EdgeTtsClient, SpeakOptions};
use serde::Serialize;
use std::process::Command;
use std::sync::OnceLock;
use std::time::Duration;

use crate::models::Settings;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPayload {
    pub base64: String,
    pub mime: String,
    pub engine: String,
    pub voice: String,
}

fn percent(value: i32) -> String {
    if value >= 0 {
        format!("+{value}%")
    } else {
        format!("{value}%")
    }
}

fn edge_options(voice: &str, rate: i32, volume: i32) -> SpeakOptions {
    SpeakOptions {
        voice: voice.to_owned(),
        rate: percent(rate.clamp(-100, 100)),
        volume: percent(volume.clamp(0, 100) - 100),
        boundary: Boundary::Sentence,
        output_format: "audio-24khz-48kbitrate-mono-mp3".into(),
        ..SpeakOptions::default()
    }
}

fn edge_client() -> Result<&'static EdgeTtsClient, String> {
    static CLIENT: OnceLock<Result<EdgeTtsClient, String>> = OnceLock::new();

    CLIENT
        .get_or_init(|| {
            EdgeTtsClient::builder()
                .connect_timeout(Duration::from_secs(10))
                .receive_timeout(Duration::from_secs(25))
                .ws_warmup(false)
                .build()
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

async fn edge_tts(text: &str, voice: &str, rate: i32, volume: i32) -> Result<Vec<u8>, String> {
    let client = edge_client()?;
    let options = edge_options(voice, rate, volume);
    let result = tokio::time::timeout(
        Duration::from_secs(60),
        client.synthesize(text.to_owned(), options),
    )
    .await
    .map_err(|_| "edge-tts の合成がタイムアウトしました".to_string())?
    .map_err(|error| format!("edge-tts 合成エラー: {error}"))?;

    if result.audio.is_empty() {
        return Err("edge-tts が音声を返しませんでした".into());
    }

    Ok(result.audio)
}

fn sapi_speak(settings: &Settings, text: &str) -> Result<Vec<u8>, String> {
    let wav = std::env::temp_dir()
        .join("jarvis-tts")
        .join(format!("{}.wav", uuid::Uuid::new_v4().simple()));
    if let Some(parent) = wav.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("作業ディレクトリを作成できません: {e}"))?;
    }

    let encoded_text = STANDARD.encode(text.as_bytes());
    let wav_arg = wav.to_string_lossy().replace('\'', "''");
    let voice = settings.tts.sapi_voice.replace('\'', "''");
    let rate = (settings.tts.rate / 10).clamp(-10, 10);
    let volume = settings.tts.volume.clamp(0, 100);

    let script = format!(
        "$ErrorActionPreference='Stop'; \
         Add-Type -AssemblyName System.Speech; \
         $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
         $s.Volume = {volume}; $s.Rate = {rate}; \
         if ('{voice}' -ne '') {{ try {{ $s.SelectVoice('{voice}') }} catch {{}} }}; \
         $text = [Text.Encoding]::UTF8.GetString(\
         [Convert]::FromBase64String('{encoded_text}')); \
         $s.SetOutputToWaveFile('{wav_arg}'); \
         $s.Speak($text); $s.Dispose()"
    );

    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|e| format!("SAPI を起動できません: {e}"))?;

    let bytes = std::fs::read(&wav).unwrap_or_default();
    let _ = std::fs::remove_file(&wav);

    if !output.status.success() || bytes.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail: String = stderr.chars().take(300).collect();
        return Err(format!("SAPI 合成に失敗しました: {detail}"));
    }

    Ok(bytes)
}

pub async fn synthesize(settings: &Settings, text: &str) -> Result<AudioPayload, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("読み上げるテキストがありません".into());
    }

    let mut errors = Vec::new();

    if settings.tts.engine != "sapi" {
        match edge_tts(
            trimmed,
            &settings.tts.voice,
            settings.tts.rate,
            settings.tts.volume,
        )
        .await
        {
            Ok(bytes) => {
                return Ok(AudioPayload {
                    base64: STANDARD.encode(bytes),
                    mime: "audio/mpeg".into(),
                    engine: "edge".into(),
                    voice: settings.tts.voice.clone(),
                });
            }
            Err(error) => {
                crate::log_message(
                    "WARN",
                    "tts",
                    &format!(
                        "edge-tts voice={} failed; falling back to SAPI: {error}",
                        settings.tts.voice
                    ),
                );
                errors.push(format!("edge-tts: {error}"));
            }
        }
    }

    let sapi_result = tokio::task::spawn_blocking({
        let settings = settings.clone();
        let text = trimmed.to_string();
        move || sapi_speak(&settings, &text)
    })
    .await
    .map_err(|e| format!("SAPI タスクが失敗しました: {e}"))?;

    match sapi_result {
        Ok(bytes) => Ok(AudioPayload {
            base64: STANDARD.encode(bytes),
            mime: "audio/wav".into(),
            engine: "sapi".into(),
            voice: if settings.tts.sapi_voice.is_empty() {
                "system-default".into()
            } else {
                settings.tts.sapi_voice.clone()
            },
        }),
        Err(error) => {
            errors.push(format!("SAPI: {error}"));
            Err(errors.join(" / "))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edge_options_validate_and_map_full_volume_to_default() {
        let options = edge_options("ja-JP-KeitaNeural", 0, 100);

        assert!(options.validate().is_ok());
        assert_eq!(options.volume, "+0%");
        assert_eq!(options.output_format, "audio-24khz-48kbitrate-mono-mp3");
    }
}
