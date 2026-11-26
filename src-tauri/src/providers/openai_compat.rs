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

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();

    // Some OpenAI-compatible servers ignore `"stream": true` and answer with
    // a single JSON object. Treat that as a complete reply instead of
    // silently returning empty content.
    if content_type.starts_with("application/json") {
        let payload: Value = response
            .json()
            .await
            .map_err(|error| StreamFailure::Network(error.to_string()))?;
        return parse_plain_completion(payload, &mut on_delta);
    }

    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();
    let mut reply = Reply::default();
    let mut calls: BTreeMap<u64, ToolCall> = BTreeMap::new();

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Err(StreamFailure::Cancelled);
        }

        let bytes = chunk.map_err(map_body_error)?;
        buffer.extend_from_slice(&bytes);

        while let Some(position) = buffer.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = buffer.drain(..=position).collect();
            if process_sse_line(&line, &mut reply, &mut calls, &mut on_delta)? {
                reply.tool_calls = calls.into_values().collect();
                return Ok(reply);
            }
        }
    }

    // Flush a trailing line when the server closes without a newline.
    if !buffer.is_empty()
        && process_sse_line(&buffer, &mut reply, &mut calls, &mut on_delta)?
    {
        reply.tool_calls = calls.into_values().collect();
        return Ok(reply);
    }

    reply.tool_calls = calls.into_values().collect();
    Ok(reply)
}

/// A truncated/aborted body is a transport problem, not a JSON problem.
fn map_body_error(error: reqwest::Error) -> StreamFailure {
    if error.is_decode() || error.is_body() {
        StreamFailure::Network(
            "応答の受信が途中で切れました（サーバー側の応答形式を確認してください）"
                .into(),
        )
    } else {
        StreamFailure::Network(error.to_string())
    }
}

/// Handle a server that returned one JSON object instead of SSE.
fn parse_plain_completion<F>(
    payload: Value,
    on_delta: &mut F,
) -> Result<Reply, StreamFailure>
where
    F: FnMut(&str),
{
    if let Some(error) = payload.get("error") {
        return Err(StreamFailure::Http(truncate(&error.to_string(), 320)));
    }

    let mut reply = Reply::default();
    if let Some(text) = payload
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
    {
        if !text.is_empty() {
            reply.content.push_str(text);
            on_delta(text);
        }
    }

    if let Some(items) = payload
        .pointer("/choices/0/message/tool_calls")
        .and_then(Value::as_array)
    {
        for entry in items {
            let mut call = ToolCall::default();
            if let Some(id) = entry.get("id").and_then(Value::as_str) {
                call.id = id.to_string();
            }
            if let Some(name) = entry.pointer("/function/name").and_then(Value::as_str) {
                call.name = name.to_string();
            }
            if let Some(args) = entry.pointer("/function/arguments").and_then(Value::as_str) {
                call.arguments = args.to_string();
            }
            if let Some(extra) = entry.get("extra_content") {
                call.extra_content = Some(extra.clone());
            }
            reply.tool_calls.push(call);
        }
    }

    Ok(reply)
}

/// Parse one SSE line. Returns `true` when `[DONE]` was seen.
fn process_sse_line<F>(
    raw: &[u8],
    reply: &mut Reply,
    calls: &mut BTreeMap<u64, ToolCall>,
    on_delta: &mut F,
) -> Result<bool, StreamFailure>
where
    F: FnMut(&str),
{
    // Decode only complete lines: TCP chunks can split a multi-byte UTF-8
    // character, and decoding per chunk would corrupt Japanese text.
    let text = String::from_utf8_lossy(raw);
    let text = text.trim_end_matches(|c| c == '\r' || c == '\n');
    let Some(data) = text.strip_prefix("data:") else {
        return Ok(false);
    };
    let data = data.trim();
    if data.is_empty() {
        return Ok(false);
    }
    if data == "[DONE]" {
        return Ok(true);
    }

    let Ok(payload) = serde_json::from_str::<Value>(data) else {
        return Ok(false);
    };

    if let Some(error) = payload.get("error") {
        return Err(StreamFailure::Http(truncate(&error.to_string(), 320)));
    }

    if let Some(content) = payload.pointer("/choices/0/delta/content") {
        match content {
            Value::String(chunk) if !chunk.is_empty() => {
                reply.content.push_str(chunk);
                on_delta(chunk);
            }
            // A few gateways send content parts instead of a plain string.
            Value::Array(parts) => {
                for part in parts {
                    if let Some(chunk) = part.get("text").and_then(Value::as_str) {
                        if !chunk.is_empty() {
                            reply.content.push_str(chunk);
                            on_delta(chunk);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if let Some(delta) = payload
        .pointer("/choices/0/delta/tool_calls")
        .and_then(Value::as_array)
    {
        for (position, entry) in delta.iter().enumerate() {
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
            if let Some(args) = entry.pointer("/function/arguments").and_then(Value::as_str) {
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

    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feed raw bytes the way `stream_request` does (byte buffer, line split).
    fn feed(chunks: &[&[u8]]) -> Reply {
        let mut reply = Reply::default();
        let mut calls: BTreeMap<u64, ToolCall> = BTreeMap::new();
        let mut buffer: Vec<u8> = Vec::new();

        for chunk in chunks {
            buffer.extend_from_slice(chunk);
            while let Some(position) = buffer.iter().position(|byte| *byte == b'\n') {
                let line: Vec<u8> = buffer.drain(..=position).collect();
                let done = process_sse_line(&line, &mut reply, &mut calls, &mut |_| {})
                    .expect("line should parse");
                assert!(!done);
            }
        }

        reply.tool_calls = calls.into_values().collect();
        reply
    }

    #[test]
    fn decodes_multibyte_content_split_across_chunks() {
        let line = "data: {\"choices\":[{\"delta\":{\"content\":\"日本語です\"}}]}\n";
        let bytes = line.as_bytes();
        // Cut in the middle of a 3-byte character.
        let cut = line.find('日').expect("character present") + 1;
        let reply = feed(&[&bytes[..cut], &bytes[cut..]]);
        assert_eq!(reply.content, "日本語です");
    }

    #[test]
    fn assembles_tool_call_arguments() {
        let first = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\
                     \"id\":\"call_1\",\"function\":{\"name\":\"launch_app\",\
                     \"arguments\":\"{\\\"target\\\":\"}}]}}]}\n";
        let second = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\
                      \"function\":{\"arguments\":\"\\\"calc\\\"}\"}}]}}]}\n";
        let reply = feed(&[first.as_bytes(), second.as_bytes()]);
        assert_eq!(reply.tool_calls.len(), 1);
        assert_eq!(reply.tool_calls[0].name, "launch_app");
        assert_eq!(reply.tool_calls[0].arguments, "{\"target\":\"calc\"}");
    }

    #[test]
    fn ignores_keepalive_and_bad_json() {
        let reply = feed(&[
            b": keepalive\n",
            b"data: not-json\n",
            b"data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n",
        ]);
        assert_eq!(reply.content, "ok");
    }
}
