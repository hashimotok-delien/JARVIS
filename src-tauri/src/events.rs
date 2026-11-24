//! Event names and payloads shared between the Rust backend and the UI.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const CHAT_DELTA: &str = "chat://delta";
pub const CHAT_DONE: &str = "chat://done";
pub const CHAT_ERROR: &str = "chat://error";
pub const CHAT_PROVIDER: &str = "chat://provider";
pub const CHAT_TITLE: &str = "chat://title";
pub const VOICE_STATE: &str = "voice://state";
pub const VOICE_TOGGLE: &str = "voice://toggle";
pub const SETTINGS_CHANGED: &str = "settings://changed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDelta {
    pub request_id: String,
    pub thread_id: String,
    pub message_id: String,
    pub delta: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDone {
    pub request_id: String,
    pub thread_id: String,
    pub message_id: String,
    pub content: String,
    pub provider: String,
    pub model: String,
    pub latency_ms: i64,
    pub stopped: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatError {
    pub request_id: String,
    pub thread_id: String,
    pub message_id: String,
    pub error: String,
    pub provider: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatProvider {
    pub request_id: String,
    pub thread_id: String,
    pub provider: String,
    pub model: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTitle {
    pub thread_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceState {
    pub state: String,
    pub detail: Option<String>,
}

pub fn emit<T>(app: &AppHandle, event: &str, payload: T)
where
    T: Serialize + Clone,
{
    let _ = app.emit(event, payload);
}
