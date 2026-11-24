//! Non-streaming helper used for summaries, digests and memory extraction.

use serde_json::{Value, json};
use std::time::Duration;
use tauri::AppHandle;

use crate::models::Settings;
use crate::providers::{ProviderConfig, resolve_providers};

async fn request(cfg: &ProviderConfig, system: &str, user: &str) -> Result<String, String> {
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
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let payload: Value = response.json().await.map_err(|error| error.to_string())?;

    if !status.is_success() {
        let detail: String = payload.to_string().chars().take(240).collect();
        return Err(format!("{status} {detail}"));
    }

    payload
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "empty completion".to_string())
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
