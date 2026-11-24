//! Text-to-speech: edge-tts WebSocket protocol with Windows SAPI fallback.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message as WsMessage;

use crate::models::Settings;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const TRUSTED_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const GEC_VERSION: &str = "1-130.0.2849.68";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPayload {
    pub base64: String,
    pub mime: String,
    pub engine: String,
    pub voice: String,
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn edge_timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let weekdays = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
    let weekday = weekdays[days.rem_euclid(7) as usize];
    let (year, month, day) = civil_from_days(days);
    let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep",
        "Oct", "Nov", "Dec",
    ];
    let month = months[(month - 1) as usize];
    format!(
        "{weekday} {month} {day:02} {year} {h:02}:{m:02}:{s:02} \
         GMT+0000 (Coordinated Universal Time)"
    )
}

/// Sec-MS-GEC token required by the Edge read-aloud endpoint.
fn gec_token() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let win_epoch = secs + 11_644_473_600;
    let rounded = win_epoch - win_epoch % 300;
    let ticks = rounded as i128 * 10_000_000;
    let input = format!("{ticks}{TRUSTED_TOKEN}");
    let digest = Sha256::digest(input.as_bytes());
    digest
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<String>()
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn percent(value: i32) -> String {
    if value > 0 {
        format!("+{value}%")
    } else {
        format!("{value}%")
    }
}

async fn edge_tts(
    text: &str,
    voice: &str,
    rate: i32,
    volume: i32,
) -> Result<Vec<u8>, String> {
    let connection_id = uuid::Uuid::new_v4().simple().to_string();
    let url = format!(
        "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1\
         ?TrustedClientToken={TRUSTED_TOKEN}\
         &Sec-MS-GEC={}\
         &Sec-MS-GEC-Version={GEC_VERSION}\
         &ConnectionId={connection_id}",
        gec_token()
    );

    let mut request = url
        .into_client_request()
        .map_err(|e| format!("edge-tts URL が不正です: {e}"))?;
    {
        let headers = request.headers_mut();
        headers.insert(
            "User-Agent",
            HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
                 AppleWebKit/537.36 (KHTML, like Gecko) \
                 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
            ),
        );
        headers.insert(
            "Origin",
            HeaderValue::from_static(
                "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
            ),
        );
        headers.insert("Pragma", HeaderValue::from_static("no-cache"));
        headers.insert(
            "Cache-Control",
            HeaderValue::from_static("no-cache"),
        );
    }

    let (mut socket, _response) = tokio::time::timeout(
        Duration::from_secs(10),
        connect_async(request),
    )
    .await
    .map_err(|_| "edge-tts への接続がタイムアウトしました".to_string())?
    .map_err(|e| format!("edge-tts に接続できません: {e}"))?;

    let timestamp = edge_timestamp();

    let config = format!(
        "X-Timestamp:{timestamp}\r\n\
         Content-Type:application/json; charset=utf-8\r\n\
         Path:speech.config\r\n\r\n\
         {{\"context\":{{\"synthesis\":{{\"audio\":{{\
         \"metadataoptions\":{{\"sentenceBoundaryEnabled\":\"false\",\
         \"wordBoundaryEnabled\":\"false\"}},\
         \"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}}}}}"
    );

    let ssml = format!(
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' \
         xml:lang='en-US'><voice name='{voice}'>\
         <prosody pitch='+0Hz' rate='{}' volume='{}'>{}</prosody>\
         </voice></speak>",
        percent(rate),
        format!("{}%", volume.clamp(0, 100)),
        escape_xml(text)
    );

    let request_id = uuid::Uuid::new_v4().simple().to_string();
    let ssml_frame = format!(
        "X-RequestId:{request_id}\r\n\
         Content-Type:application/ssml+xml\r\n\
         X-Timestamp:{timestamp}Z\r\n\
         Path:ssml\r\n\r\n{ssml}"
    );

    socket
        .send(WsMessage::Text(config.into()))
        .await
        .map_err(|e| format!("edge-tts 送信エラー: {e}"))?;
    socket
        .send(WsMessage::Text(ssml_frame.into()))
        .await
        .map_err(|e| format!("edge-tts 送信エラー: {e}"))?;

    let mut audio: Vec<u8> = Vec::new();
    let mut finished = false;

    while !finished {
        let message = tokio::time::timeout(
            Duration::from_secs(25),
            socket.next(),
        )
        .await
        .map_err(|_| "edge-tts の応答がタイムアウトしました".to_string())?;

        let Some(message) = message else {
            break;
        };

        match message.map_err(|e| format!("edge-tts 受信エラー: {e}"))? {
            WsMessage::Binary(data) => {
                if data.len() < 2 {
                    continue;
                }
                let header_len =
                    ((data[0] as usize) << 8) | data[1] as usize;
                if data.len() >= 2 + header_len {
                    audio.extend_from_slice(&data[2 + header_len..]);
                }
            }
            WsMessage::Text(text) => {
                if text.contains("Path:turn.end") {
                    finished = true;
                }
            }
            WsMessage::Close(_) => break,
            _ => {}
        }
    }

    let _ = socket.close(None).await;

    if audio.is_empty() {
        return Err("edge-tts が音声を返しませんでした".into());
    }

    Ok(audio)
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

pub async fn synthesize(
    settings: &Settings,
    text: &str,
) -> Result<AudioPayload, String> {
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
