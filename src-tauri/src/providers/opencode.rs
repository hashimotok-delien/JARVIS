//! OpenCode native API (`opencode web` / `opencode serve`).
//!
//! The server has no OpenAI-compatible `/chat/completions`: unknown routes
//! fall through to its SPA and answer with HTML. We use the stateless
//! one-shot `POST /api/experimental/generate/text` instead of the session
//! API, because a session runs OpenCode's own agent (file edits, shell
//! commands and its own permission prompts) that JARVIS does not manage.

use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use super::openai_compat::{ChatTurn, ProviderConfig, Reply, StreamFailure};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);

fn client() -> Result<reqwest::Client, StreamFailure> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| StreamFailure::Network(error.to_string()))
}

fn endpoint(cfg: &ProviderConfig, path: &str) -> String {
    let base = cfg.base_url.trim_end_matches('/');
    format!("{base}{path}")
}

fn excerpt(value: &str, max: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let head: String = trimmed.chars().take(max).collect();
    format!("{head}…")
}

fn looks_like_html(body: &str) -> bool {
    let head: String = body
        .trim_start()
        .chars()
        .take(64)
        .collect::<String>()
        .to_ascii_lowercase();
    head.starts_with("<!doctype html") || head.starts_with("<html")
}

fn html_hint(cfg: &ProviderConfig) -> StreamFailure {
    StreamFailure::Http(format!(
        "サーバーがHTMLを返しました（{}）。`opencode web` のサーバー URL \
         （例: http://127.0.0.1:3000）を Base URL に設定してください。",
        cfg.base_url
    ))
}

/// Flatten JARVIS turns into the single `prompt` string the endpoint takes.
///
/// The endpoint is stateless, so the conversation JARVIS already holds is
/// serialised into the prompt instead of relying on a server-side session.
fn flatten(turns: &[ChatTurn]) -> String {
    let mut prompt = String::new();
    for turn in turns {
        if turn.content.trim().is_empty() {
            continue;
        }
        let label = match turn.role.as_str() {
            "system" => "【システム】",
            "assistant" => "【アシスタント】",
            _ => "【ユーザー】",
        };
        prompt.push_str(label);
        prompt.push('\n');
        prompt.push_str(turn.content.trim());
        prompt.push_str("\n\n");
    }
    prompt.trim_end().to_string()
}

/// `provider/model` is used as-is; a bare id is looked up in `GET /api/model`.
/// Returning `None` means "let the server use its default model".
async fn model_ref(
    client: &reqwest::Client,
    cfg: &ProviderConfig,
) -> Option<Value> {
    let configured = cfg.model.trim();
    if configured.is_empty() {
        return None;
    }
    if let Some((provider, id)) = configured.split_once('/') {
        if !provider.is_empty() && !id.is_empty() {
            return Some(json!({ "providerID": provider, "id": id }));
        }
    }

    let mut request = client.get(endpoint(cfg, "/api/model"));
    if let Some(key) = cfg.api_key.as_deref() {
        request = request.bearer_auth(key);
    }
    let response = request.send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let payload: Value = response.json().await.ok()?;
    let items = payload.get("data")?.as_array()?;
    let hit = items.iter().find(|item| {
        ["id", "modelID", "name"].iter().any(|field| {
            item.get(*field)
                .and_then(Value::as_str)
                .is_some_and(|value| value == configured)
        })
    })?;
    let provider = hit.get("providerID")?.as_str()?;
    let id = hit
        .get("id")
        .and_then(Value::as_str)
        .or_else(|| hit.get("modelID").and_then(Value::as_str))?;
    Some(json!({ "providerID": provider, "id": id }))
}

async fn post_text(
    cfg: &ProviderConfig,
    prompt: &str,
) -> Result<String, StreamFailure> {
    let client = client()?;
    let url = endpoint(cfg, "/api/experimental/generate/text");

    let mut body = json!({ "prompt": prompt });
    if let Some(model) = model_ref(&client, cfg).await {
        body["model"] = model;
    }

    let mut request = client.post(url).json(&body);
    if let Some(key) = cfg.api_key.as_deref() {
        request = request.bearer_auth(key);
    }

    let response = request
        .send()
        .await
        .map_err(|error| StreamFailure::Network(error.to_string()))?;
    let status = response.status();
    let raw = response.text().await.unwrap_or_default();

    // A wrong base URL hits the SPA fallback and returns HTML with 200.
    if looks_like_html(&raw) {
        return Err(html_hint(cfg));
    }

    if !status.is_success() {
        let detail = excerpt(&raw, 240);
        return Err(match status.as_u16() {
            401 | 403 => StreamFailure::Auth(detail),
            429 => StreamFailure::RateLimited(detail),
            _ => StreamFailure::Http(format!("{status} {detail}")),
        });
    }

    let payload: Value = serde_json::from_str(&raw).map_err(|_| {
        StreamFailure::Http(format!(
            "応答を解釈できません: {}",
            excerpt(&raw, 240)
        ))
    })?;
    if let Some(error) = payload.get("error") {
        return Err(StreamFailure::Http(excerpt(&error.to_string(), 240)));
    }

    let text = payload
        .pointer("/data/text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if text.is_empty() {
        return Err(StreamFailure::Http(
            "空の応答が返りました（モデルの設定を確認してください）".into(),
        ));
    }
    Ok(text)
}

/// Single completion used for summaries, digests and memory extraction.
pub async fn complete(
    cfg: &ProviderConfig,
    system: &str,
    user: &str,
) -> Result<String, String> {
    let prompt = flatten(&[
        ChatTurn::new("system", system),
        ChatTurn::new("user", user),
    ]);
    post_text(cfg, &prompt)
        .await
        .map_err(|error| error.message())
}

/// Chat turn. The endpoint returns the whole answer at once, so the result
/// is emitted as a single delta and tool calls are not available.
pub async fn stream<F>(
    cfg: &ProviderConfig,
    turns: &[ChatTurn],
    cancel: &AtomicBool,
    mut on_delta: F,
) -> Result<Reply, StreamFailure>
where
    F: FnMut(&str),
{
    if cancel.load(Ordering::Relaxed) {
        return Err(StreamFailure::Cancelled);
    }

    let text = post_text(cfg, &flatten(turns)).await?;

    if cancel.load(Ordering::Relaxed) {
        return Err(StreamFailure::Cancelled);
    }
    on_delta(&text);
    Ok(Reply {
        content: text,
        tool_calls: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flatten_labels_every_role() {
        let turns = vec![
            ChatTurn::new("system", "あなたはJARVISです"),
            ChatTurn::new("user", "こんにちは"),
            ChatTurn::new("assistant", "はい"),
        ];
        let prompt = flatten(&turns);

        assert!(prompt.starts_with("【システム】\nあなたはJARVISです"));
        assert!(prompt.contains("【ユーザー】\nこんにちは"));
        assert!(prompt.contains("【アシスタント】\nはい"));
    }

    #[test]
    fn flatten_skips_empty_turns() {
        let turns = vec![
            ChatTurn::new("user", "  "),
            ChatTurn::new("user", "本文"),
        ];
        assert_eq!(flatten(&turns), "【ユーザー】\n本文");
    }

    #[test]
    fn html_is_detected() {
        assert!(looks_like_html("  <!doctype html><html>"));
        assert!(looks_like_html("<HTML lang=\"en\">"));
        assert!(!looks_like_html("{\"data\":{\"text\":\"ok\"}}"));
    }
}
