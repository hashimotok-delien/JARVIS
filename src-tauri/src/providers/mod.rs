//! Provider resolution with fallback order and the streaming orchestrator.

pub mod openai_compat;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Manager};

use crate::db;
use crate::events::{self, ChatDelta, ChatDone, ChatError, ChatProvider};
use crate::models::{Message, Settings};
use crate::state::AppState;

pub use openai_compat::{ChatTurn, ProviderConfig, StreamFailure};

pub fn gemini_key(app: &AppHandle) -> Option<String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().ok()?;
    db::get_secret(&conn, "gemini_api_key")
}

pub fn resolve_providers(app: &AppHandle, settings: &Settings) -> Vec<ProviderConfig> {
    let key = gemini_key(app);

    settings
        .providers
        .order
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

pub async fn run(app: AppHandle, ctx: StreamContext, settings: Settings, cancel: Arc<AtomicBool>) {
    let providers = resolve_providers(&app, &settings);

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

        let result = {
            let app_ref = &app;
            let request_id = ctx.request_id.clone();
            let thread_id = ctx.thread_id.clone();
            let message_id = ctx.message_id.clone();
            openai_compat::stream_chat(provider, &ctx.turns, &cancel, &mut content, move |delta| {
                events::emit(
                    app_ref,
                    events::CHAT_DELTA,
                    ChatDelta {
                        request_id: request_id.clone(),
                        thread_id: thread_id.clone(),
                        message_id: message_id.clone(),
                        delta: delta.to_string(),
                    },
                );
            })
            .await
        };

        match result {
            Ok(()) => {
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
