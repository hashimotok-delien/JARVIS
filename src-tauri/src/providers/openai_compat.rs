//! OpenAI-compatible `/chat/completions` streaming (SSE).
//!
//! Works for Gemini's OpenAI-compatible endpoint, Ollama's `/v1` API and
//! any other OpenAI-compatible server (Groq, OpenRouter, LM Studio, ...).

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct ChatTurn {
    pub role: String,
    pub content: String,
}

pub struct ProviderConfig {
    pub id: &'static str,
    pub label: &'static str,
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub temperature: f32,
}

#[derive(Debug)]
pub enum StreamFailure {
    Cancelled,
    RateLimited(String),
    Auth(String),
    Http(String),
    Network(String),
}

impl StreamFailure {
    pub fn message(&self) -> String {
        match self {
            Self::Cancelled => "生成を停止しました".into(),
            Self::RateLimited(detail) => {
                format!("レート制限に達しました: {detail}")
            }
            Self::Auth(detail) => format!("認証に失敗しました: {detail}"),
            Self::Http(detail) => format!("APIエラー: {detail}"),
            Self::Network(detail) => {
                format!("接続に失敗しました: {detail}")
            }
        }
    }
}

fn truncate(value: &str, max: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let head: String = trimmed.chars().take(max).collect();
    format!("{head}…")
}

pub async fn stream_chat<F>(
    cfg: &ProviderConfig,
    turns: &[ChatTurn],
    cancel: &AtomicBool,
    out: &mut String,
    mut on_delta: F,
) -> Result<(), StreamFailure>
where
    F: FnMut(&str) + Send,
{
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| StreamFailure::Network(e.to_string()))?;

    let url = format!("{}/chat/completions", cfg.base_url);
    let body = serde_json::json!({
        "model": cfg.model,
        "messages": turns,
        "stream": true,
        "temperature": cfg.temperature,
    });

    let mut request = client.post(&url).json(&body);
    if let Some(key) = cfg.api_key.as_deref() {
        request = request.bearer_auth(key);
    }

    let response = request
        .send()
        .await
        .map_err(|e| StreamFailure::Network(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let detail = truncate(&text, 320);
        return Err(match status.as_u16() {
            429 => StreamFailure::RateLimited(detail),
            401 | 403 => StreamFailure::Auth(detail),
            _ => StreamFailure::Http(format!("{status} {detail}")),
        });
    }

    let mut stream = response.bytes_stream();
    let mut pending = String::new();

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Err(StreamFailure::Cancelled);
        }

        let bytes = chunk.map_err(|e| StreamFailure::Network(e.to_string()))?;
        pending.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(index) = pending.find('\n') {
            let line = pending[..index].trim_end_matches('\r').to_string();
            pending.drain(..index + 1);

            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            if data == "[DONE]" {
                return Ok(());
            }

            let Ok(payload) = serde_json::from_str::<Value>(data) else {
                continue;
            };

            if let Some(error) = payload.get("error") {
                return Err(StreamFailure::Http(truncate(
                    &error.to_string(),
                    320,
                )));
            }

            let delta = payload
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str);

            if let Some(text) = delta {
                if !text.is_empty() {
                    out.push_str(text);
                    on_delta(text);
                }
            }
        }
    }

    Ok(())
}
