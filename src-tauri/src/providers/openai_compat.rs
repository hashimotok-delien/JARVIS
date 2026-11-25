//! OpenAI-compatible `/chat/completions` streaming (SSE).
//!
//! Works for Gemini's OpenAI-compatible endpoint, Ollama's `/v1` API and
//! any other OpenAI-compatible server (Groq, OpenRouter, LM Studio, ...).

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct ChatTurn {
    pub role: String,
    pub content: String,
    /// Data URLs (`data:image/png;base64,...`) for vision models.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
    /// Provider-specific metadata that must be echoed back verbatim.
    /// Gemini thinking models return `google.thought_signature` here and
    /// reject follow-up requests that drop it.
    pub extra_content: Option<Value>,
}

#[derive(Debug, Clone, Default)]
pub struct Reply {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
}

impl ChatTurn {
    pub fn new(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
            images: Vec::new(),
        }
    }

    pub fn to_value(&self) -> Value {
        if self.images.is_empty() {
            return json!({ "role": self.role, "content": self.content });
        }
        let mut parts = vec![json!({ "type": "text", "text": self.content })];
        for image in &self.images {
            parts.push(json!({
                "type": "image_url",
                "image_url": { "url": image }
            }));
        }
        json!({ "role": self.role, "content": parts })
    }
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

pub async fn stream_request<F>(
    cfg: &ProviderConfig,
    messages: &[Value],
    tools: Option<&Value>,
    cancel: &AtomicBool,
    mut on_delta: F,
) -> Result<Reply, StreamFailure>
where
    F: FnMut(&str) + Send,
{
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| StreamFailure::Network(e.to_string()))?;

    let url = format!("{}/chat/completions", cfg.base_url);
    let mut body = json!({
        "model": cfg.model,
        "messages": messages,
        "stream": true,
        "temperature": cfg.temperature,
    });
    if let Some(tools) = tools {
        body["tools"] = tools.clone();
        body["tool_choice"] = json!("auto");
    }

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
    let mut reply = Reply::default();
    let mut calls: BTreeMap<u64, ToolCall> = BTreeMap::new();

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
                reply.tool_calls = calls.into_values().collect();
                return Ok(reply);
            }

            let Ok(payload) = serde_json::from_str::<Value>(data) else {
                continue;
            };

            if let Some(error) = payload.get("error") {
                return Err(StreamFailure::Http(truncate(&error.to_string(), 320)));
            }

            if let Some(text) = payload
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
            {
                if !text.is_empty() {
                    reply.content.push_str(text);
                    on_delta(text);
                }
            }

            if let Some(calls_delta) = payload
                .pointer("/choices/0/delta/tool_calls")
                .and_then(Value::as_array)
            {
                for (position, entry) in calls_delta.iter().enumerate() {
                    let index = entry
                        .get("index")
                        .and_then(Value::as_u64)
                        .unwrap_or(position as u64);
                    let slot = calls.entry(index).or_default();
                    if let Some(id) = entry.get("id").and_then(Value::as_str) {
                        if !id.is_empty() {
                            slot.id = id.to_string();
                        }
                    }
                    if let Some(name) = entry.pointer("/function/name").and_then(Value::as_str) {
                        // Providers either send the full name once or stream it,
                        // but a few repeat it every chunk; never duplicate it.
                        if slot.name.is_empty() {
                            slot.name = name.to_string();
                        } else if !slot.name.ends_with(name) && name != slot.name {
                            slot.name.push_str(name);
                        }
                    }
                    if let Some(args) = entry.pointer("/function/arguments").and_then(Value::as_str)
                    {
                        slot.arguments.push_str(args);
                    }
                    if let Some(extra) = entry.get("extra_content") {
                        // Only keep a usable signature. Sending back an empty
                        // `extra_content` makes Gemini reject the whole turn.
                        let has_signature = extra
                            .pointer("/google/thought_signature")
                            .and_then(Value::as_str)
                            .is_some_and(|signature| !signature.is_empty());
                        if has_signature {
                            slot.extra_content = Some(extra.clone());
                        }
                    }
                }
            }
        }
    }

    reply.tool_calls = calls.into_values().collect();
    Ok(reply)
}
