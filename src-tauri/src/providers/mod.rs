//! Provider resolution with fallback order and the streaming orchestrator.

pub mod agent;
pub mod complete;
pub mod openai_compat;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Manager};

use crate::db;
use crate::events::{self, ChatDone, ChatError, ChatProvider};
use crate::models::{Message, Settings};
use crate::state::AppState;

pub use openai_compat::{ChatTurn, ProviderConfig, StreamFailure};

pub fn gemini_key(app: &AppHandle) -> Option<String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().ok()?;
    db::get_secret(&conn, "gemini_api_key")
}

/// Heuristic: short, conversational prompts can run locally; long or
/// analysis-heavy prompts benefit from the cloud model.
fn prefer_local(text: &str) -> bool {
    let length = text.chars().count();
    if length > 140 {
        return false;
    }
    const HEAVY: &[&str] = &[
        "コード", "実装", "設計", "比較", "調査", "分析", "論文", "翻訳", "要約",
        "program", "explain", "analyze", "compare", "code", "design",
    ];
    let lowered = text.to_lowercase();
    !HEAVY.iter().any(|word| lowered.contains(word))
}

pub fn resolve_providers(
    app: &AppHandle,
    settings: &Settings,
    probe: Option<&str>,
    force_local: bool,
) -> Vec<ProviderConfig> {
    let key = gemini_key(app);

    let mut order = settings.providers.order.clone();
    if settings.providers.auto_route || force_local {
        if let Some(text) = probe {
            // Voice turns always prefer the local model when available.
            let local_first = force_local || prefer_local(text);
            order.sort_by_key(|id| {
                let local = id == "ollama";
                if local_first {
                    !local as u8
                } else {
                    local as u8
                }
            });
        }
    }

    order
        .iter()
        .filter_map(|id| match id.as_str() {
            "gemini" => Some(ProviderConfig {
                id: "gemini",
                label: "Gemini",
                base_url: settings.providers.gemini_base_url.clone(),
                api_key: key.clone(),
                model: settings.providers.gemini_model.clone(),
                temperature: settings.temperature,
            }),
            "ollama" => Some(ProviderConfig {
                id: "ollama",
                label: "Ollama",
                base_url: format!("{}/v1", settings.providers.ollama_base_url),
                api_key: None,
                model: settings.providers.ollama_model.clone(),
                temperature: settings.temperature,
            }),
            _ => None,
        })
        .collect()
}

pub struct StreamContext {
    pub request_id: String,
    pub thread_id: String,
    pub message_id: String,
    pub turns: Vec<ChatTurn>,
    /// Voice-originated requests should use the local model first.
    pub prefer_local: bool,
}

fn persist_assistant(
    app: &AppHandle,
    ctx: &StreamContext,
    content: &str,
    provider: &str,
    model: &str,
    error: Option<String>,
) {
    let state = app.state::<AppState>();
    let Ok(conn) = state.db.lock() else {
        return;
    };
    let message = Message {
        id: ctx.message_id.clone(),
        thread_id: ctx.thread_id.clone(),
        role: "assistant".into(),
        content: content.to_string(),
        created_at: db::now_ms(),
        provider: Some(provider.to_string()),
        model: Some(model.to_string()),
        error,
    };
    if let Err(error) = db::insert_message(&conn, &message) {
        crate::log_message(
            "ERROR",
            "database",
            &format!("persist assistant message: {error}"),
        );
    }
    if let Err(error) = db::touch_thread(&conn, &ctx.thread_id) {
        crate::log_message(
            "ERROR",
            "database",
            &format!("update thread timestamp: {error}"),
        );
    }
}

fn record_usage(
    app: &AppHandle,
    thread_id: &str,
    provider: &str,
    model: &str,
    latency_ms: i64,
    characters: i64,
) {
    let state = app.state::<AppState>();
    let Ok(conn) = state.db.lock() else {
        return;
    };
    if let Err(error) = db::record_usage(&conn, thread_id, provider, model, latency_ms, characters) {
        crate::log_message("ERROR", "usage", &format!("record usage: {error}"));
    }
}

pub async fn run(app: AppHandle, ctx: StreamContext, settings: Settings, cancel: Arc<AtomicBool>) {
    let probe = ctx
        .turns
        .iter()
        .rev()
        .find(|turn| turn.role == "user")
        .map(|turn| turn.content.clone());
    let providers = resolve_providers(
        &app,
        &settings,
        probe.as_deref(),
        ctx.prefer_local,
    );

    if providers.is_empty() {
        let error =
            "利用可能なプロバイダがありません。設定で API キーまたは Ollama を確認してください。";
        persist_assistant(&app, &ctx, "", "none", "none", Some(error.into()));
        events::emit(
            &app,
            events::CHAT_ERROR,
            ChatError {
                request_id: ctx.request_id.clone(),
                thread_id: ctx.thread_id.clone(),
                message_id: ctx.message_id.clone(),
                error: error.into(),
                provider: None,
            },
        );
        return;
    }

    // Gemini without a key would always fail; skip it with a hint.
    let mut candidates: Vec<ProviderConfig> = Vec::new();
    let mut skipped: Option<String> = None;
    for provider in providers {
        if provider.id == "gemini" && provider.api_key.is_none() {
            skipped = Some("Gemini の API キーが未設定のためスキップ".into());
            continue;
        }
        candidates.push(provider);
    }


    if candidates.is_empty() {
        let error = "Gemini の API キーが未設定で、他に利用できるプロバイダがありません。";
        persist_assistant(&app, &ctx, "", "none", "none", Some(error.into()));
        events::emit(
            &app,
            events::CHAT_ERROR,
            ChatError {
                request_id: ctx.request_id.clone(),
                thread_id: ctx.thread_id.clone(),
                message_id: ctx.message_id.clone(),
                error: error.into(),
                provider: None,
            },
        );
        return;
    }

    let mut failures: Vec<String> = Vec::new();
    if let Some(reason) = skipped {
        failures.push(reason);
    }

    for (index, provider) in candidates.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            events::emit(
                &app,
                events::CHAT_ERROR,
                ChatError {
                    request_id: ctx.request_id.clone(),
                    thread_id: ctx.thread_id.clone(),
                    message_id: ctx.message_id.clone(),
                    error: "生成を停止しました".into(),
                    provider: None,
                },
            );
            return;
        }

        events::emit(
            &app,
            events::CHAT_PROVIDER,
            ChatProvider {
                request_id: ctx.request_id.clone(),
                thread_id: ctx.thread_id.clone(),
                provider: provider.label.to_string(),
                model: provider.model.clone(),
                reason: if index == 0 {
                    None
                } else {
                    failures.last().cloned()
                },
            },
        );

        let started = Instant::now();
        let mut content = String::new();

        let result = agent::run_stream(&app, &ctx, provider, &settings, &cancel, &mut content).await;

        match result {
            Ok(()) => {
                persist_assistant(&app, &ctx, &content, provider.id, &provider.model, None);
                record_usage(&app, &ctx.thread_id, provider.id, &provider.model, started.elapsed().as_millis() as i64, content.chars().count() as i64);
                crate::commands::memory::after_reply(&app, &ctx.thread_id, &settings);
                events::emit(
                    &app,
                    events::CHAT_DONE,
                    ChatDone {
                        request_id: ctx.request_id.clone(),
                        thread_id: ctx.thread_id.clone(),
                        message_id: ctx.message_id.clone(),
                        content: content.clone(),
                        provider: provider.label.to_string(),
                        model: provider.model.clone(),
                        latency_ms: started.elapsed().as_millis() as i64,
                        stopped: false,
                    },
                );
                return;
            }
            Err(StreamFailure::Cancelled) => {
                persist_assistant(&app, &ctx, &content, provider.id, &provider.model, None);
                events::emit(
                    &app,
                    events::CHAT_DONE,
                    ChatDone {
                        request_id: ctx.request_id.clone(),
                        thread_id: ctx.thread_id.clone(),
                        message_id: ctx.message_id.clone(),
                        content: content.clone(),
                        provider: provider.label.to_string(),
                        model: provider.model.clone(),
                        latency_ms: started.elapsed().as_millis() as i64,
                        stopped: true,
                    },
                );
                return;
            }
            Err(failure) => {
                crate::log_message(
                    "WARN",
                    "provider",
                    &format!(
                        "{} model={} failed: {}",
                        provider.label,
                        provider.model,
                        failure.message()
                    ),
                );
                failures.push(format!("{}: {}", provider.label, failure.message()));
            }
        }
    }

    let error = failures.join(" / ");
    persist_assistant(
        &app,
        &ctx,
        "",
        candidates.last().map(|p| p.id).unwrap_or("none"),
        candidates
            .last()
            .map(|p| p.model.as_str())
            .unwrap_or("none"),
        Some(error.clone()),
    );
    events::emit(
        &app,
        events::CHAT_ERROR,
        ChatError {
            request_id: ctx.request_id.clone(),
            thread_id: ctx.thread_id.clone(),
            message_id: ctx.message_id.clone(),
            error,
            provider: None,
        },
    );
}
