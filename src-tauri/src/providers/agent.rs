//! Streaming chat with an OpenAI-compatible function-calling loop.

use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

use crate::events::{self, ChatDelta, ToolStatus};
use crate::models::Settings;
use crate::providers::StreamContext;
use crate::providers::openai_compat::{self, ProviderConfig, StreamFailure};

const MAX_ROUNDS: usize = 4;

pub async fn run_stream(
    app: &AppHandle,
    ctx: &StreamContext,
    provider: &ProviderConfig,
    settings: &Settings,
    cancel: &AtomicBool,
    out: &mut String,
) -> Result<(), StreamFailure> {
    let mut messages: Vec<Value> = ctx.turns.iter().map(|turn| turn.to_value()).collect();
    let definitions = crate::tools::definitions(settings).await;
    let tools = if definitions.is_empty() {
        None
    } else {
        Some(Value::Array(definitions))
    };

    for _round in 0..MAX_ROUNDS {
        if cancel.load(Ordering::Relaxed) {
            return Err(StreamFailure::Cancelled);
        }

        let reply = {
            let sink = &mut *out;
            let app_handle = app.clone();
            let request_id = ctx.request_id.clone();
            let thread_id = ctx.thread_id.clone();
            let message_id = ctx.message_id.clone();
            openai_compat::stream_request(
                provider,
                &messages,
                tools.as_ref(),
                cancel,
                move |delta| {
                    sink.push_str(delta);
                    events::emit(
                        &app_handle,
                        events::CHAT_DELTA,
                        ChatDelta {
                            request_id: request_id.clone(),
                            thread_id: thread_id.clone(),
                            message_id: message_id.clone(),
                            delta: delta.to_string(),
                        },
                    );
                },
            )
            .await?
        };

        if reply.tool_calls.is_empty() {
            return Ok(());
        }

        let mut calls_json = Vec::new();
        for (index, call) in reply.tool_calls.iter().enumerate() {
            let id = if call.id.is_empty() {
                format!("call_{round}_{index}", round = _round)
            } else {
                call.id.clone()
            };
            calls_json.push(json!({
                "id": id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": if call.arguments.trim().is_empty() {
                        "{}".to_string()
                    } else {
                        call.arguments.clone()
                    },
                }
            }));
        }

        messages.push(json!({
            "role": "assistant",
            "content": reply.content,
            "tool_calls": calls_json,
        }));

        for (index, call) in reply.tool_calls.iter().enumerate() {
            let id = calls_json[index]["id"].as_str().unwrap_or_default().to_string();
            let arguments: Value = serde_json::from_str(&call.arguments)
                .unwrap_or_else(|_| json!({}));

            events::emit(
                app,
                events::TOOL_STATUS,
                ToolStatus {
                    name: call.name.clone(),
                    state: "running".into(),
                    detail: None,
                },
            );

            let result = crate::tools::execute(app, settings, &call.name, &arguments).await;
            let (text, state) = match result {
                Ok(text) => (text, "ok"),
                Err(error) => (format!("エラー: {error}"), "error"),
            };

            events::emit(
                app,
                events::TOOL_STATUS,
                ToolStatus {
                    name: call.name.clone(),
                    state: state.into(),
                    detail: Some(text.chars().take(200).collect()),
                },
            );

            messages.push(json!({
                "role": "tool",
                "tool_call_id": id,
                "content": text,
            }));
        }
    }

    Ok(())
}
