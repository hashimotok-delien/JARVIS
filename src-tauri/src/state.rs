use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::speech::worker::SpeechWorker;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSnapshot {
    pub state: String,
    pub detail: Option<String>,
}

impl Default for VoiceSnapshot {
    fn default() -> Self {
        Self {
            state: "idle".into(),
            detail: None,
        }
    }
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub voice: Mutex<VoiceSnapshot>,
    pub quitting: AtomicBool,
    pub data_dir: PathBuf,
    /// Version that ran before this launch (set when the app was upgraded).
    pub previous_version: Mutex<Option<String>>,
    /// Pending tool approvals awaiting a user decision.
    pub approvals: Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>,
    /// Long-lived speech.cpp worker that keeps the recognizer loaded.
    pub asr_worker: Mutex<Option<SpeechWorker>>,
    /// Services spawned by JARVIS (owned) keyed by configured name.
    pub services: Mutex<HashMap<String, std::process::Child>>,
}

impl AppState {
    pub fn new(conn: Connection, data_dir: PathBuf) -> Self {
        Self {
            db: Mutex::new(conn),
            cancels: Mutex::new(HashMap::new()),
            voice: Mutex::new(VoiceSnapshot::default()),
            quitting: AtomicBool::new(false),
            data_dir,
            previous_version: Mutex::new(None),
            approvals: Mutex::new(HashMap::new()),
            asr_worker: Mutex::new(None),
            services: Mutex::new(HashMap::new()),
        }
    }
}
