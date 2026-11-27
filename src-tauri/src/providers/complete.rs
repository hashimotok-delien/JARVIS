//! Non-streaming helper used for summaries, digests and memory extraction.

use serde_json::{Value, json};
use std::time::Duration;
use tauri::AppHandle;

use crate::models::Settings;
use crate::providers::{ProviderConfig, resolve_providers};

async fn request(cfg: &ProviderConfig, system: &str, user: &str) -> Result<String, String> {
    // `opencode web` only speaks its own API, not OpenAI-compatible routes.
    if cfg.id == "opencode" {
        return super::opencode::complete(cfg, system, user).await;
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| error.to_string())?;

    let url = format!("{}/chat/completions", cfg.base_url);
    let body = json!({
        "model": cfg.model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
        "stream": false,
        "temperature": 0.3,
    });

    let mut request = client.post(&url).json(&body);
    if let Some(key) = cfg.api_key.as_deref() {
        request = request.bearer_auth(key);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("接続に失敗しました: {error}"))?;
    let status = response.status();
    // Read the raw body first so a malformed reply can be logged verbatim.
    let body = response
        .text()
        .await
        .map_err(|error| format!("応答の受信に失敗しました: {error}"))?;

    if !status.is_success() {
        return Err(format!("{status} {}", excerpt(&body, 240)));
    }

    // `opencode web` and similar servers answer unknown routes with their
    // SPA index page (HTTP 200 + HTML). Say so instead of "cannot parse".
    if looks_like_html(&body) {
        return Err(html_reply_hint(&cfg.base_url));
    }

    if let Ok(payload) = serde_json::from_str::<Value>(&body) {
        if let Some(error) = payload.get("error") {
            return Err(excerpt(&error.to_string(), 240));
        }
        if let Some(text) = payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
        {
            let text = text.trim();
            if !text.is_empty() {
                return Ok(text.to_string());
            }
        }
        // Report why the model returned nothing (safety stop, empty delta...).
        let reason = payload
            .pointer("/choices/0/finish_reason")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!(
            "empty completion (finish_reason={reason}) 本文: {}",
            excerpt(&body, 160)
        ));
    }

    // Some servers stream even though `stream: false` was requested.
    let streamed = collect_streamed_content(&body);
    if !streamed.trim().is_empty() {
        return Ok(streamed.trim().to_string());
    }

    Err(format!("応答を解釈できません: {}", excerpt(&body, 240)))
}

fn excerpt(value: &str, max: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let head: String = trimmed.chars().take(max).collect();
    format!("{head}…")
}

/// Servers such as `opencode web` answer unknown routes with their SPA index
/// page, so a misconfigured base URL looks like a successful response.
fn looks_like_html(body: &str) -> bool {
    let head: String = body
        .trim_start()
        .chars()
        .take(64)
        .collect::<String>()
        .to_ascii_lowercase();
    head.starts_with("<!doctype html") || head.starts_with("<html")
}

fn html_reply_hint(base_url: &str) -> String {
    format!(
        "サーバーがHTMLを返しました（{base_url}）。OpenAI 互換の \
         /chat/completions ではありません。`opencode web` は /api/ 配下の \
         独自APIのみ提供するため、OpenAI 互換ゲートウェイの URL を設定して\
         ください。"
    )
}

/// Stitch `data:` chunks together when a server ignores `stream: false`.
fn collect_streamed_content(body: &str) -> String {
    let mut text = String::new();
    for line in body.lines() {
        let Some(data) = line.trim().strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(payload) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        if let Some(chunk) = payload
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
        {
            text.push_str(chunk);
        }
    }
    text
}

/// Ask the active provider (with fallback) for a single completion.
pub async fn complete(
    app: &AppHandle,
    settings: &Settings,
    system: &str,
    user: &str,
) -> Result<String, String> {
    let mut errors = Vec::new();
    for provider in resolve_providers(app, settings, Some(user), false) {
        if provider.id == "gemini" && provider.api_key.is_none() {
            continue;
        }
        match request(&provider, system, user).await {
            Ok(text) => return Ok(text),
            Err(error) => {
                crate::log_message(
                    "WARN",
                    "complete",
                    &format!("{} failed: {error}", provider.label),
                );
                errors.push(format!("{}: {error}", provider.label));
            }
        }
    }
    if errors.is_empty() {
        Err("利用可能なプロバイダがありません".into())
    } else {
        Err(errors.join(" / "))
    }
}
