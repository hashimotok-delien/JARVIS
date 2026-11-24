use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: String,
    pub title: String,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub thread_id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProviderSettings {
    /// Fallback order, e.g. ["gemini", "ollama"].
    pub order: Vec<String>,
    pub gemini_model: String,
    pub gemini_base_url: String,
    pub ollama_model: String,
    pub ollama_base_url: String,
}

impl Default for ProviderSettings {
    fn default() -> Self {
        Self {
            order: vec!["gemini".into(), "ollama".into()],
            gemini_model: "gemini-2.5-flash".into(),
            gemini_base_url:
                "https://generativelanguage.googleapis.com/v1beta/openai".into(),
            ollama_model: "qwen2.5:7b-instruct".into(),
            ollama_base_url: "http://127.0.0.1:11434".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TtsSettings {
    pub enabled: bool,
    /// "edge" (edge-tts protocol) or "sapi" (Windows System.Speech).
    pub engine: String,
    pub voice: String,
    pub sapi_voice: String,
    /// Speaking rate in percent (-100..100).
    pub rate: i32,
    /// Volume in percent (0..100).
    pub volume: i32,
}

impl Default for TtsSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            engine: "edge".into(),
            voice: "ja-JP-NanamiNeural".into(),
            sapi_voice: String::new(),
            rate: 0,
            volume: 100,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SttSettings {
    pub enabled: bool,
    pub language: String,
    /// Absolute or relative path to whisper-cli.exe.
    pub whisper_path: String,
    /// Absolute or relative path to a ggml model (e.g. ggml-small.bin).
    pub model_path: String,
    /// Silence duration that ends an utterance.
    pub silence_ms: u32,
    /// RMS threshold for voice activity detection (0..1).
    pub threshold: f32,
    pub hands_free: bool,
    /// Seconds to keep listening for a follow-up in hands-free mode.
    pub follow_up_ms: u32,
}

impl Default for SttSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            language: "ja".into(),
            whisper_path: String::new(),
            model_path: String::new(),
            silence_ms: 800,
            threshold: 0.02,
            hands_free: false,
            follow_up_ms: 12_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HudSettings {
    pub click_through: bool,
    pub opacity: f32,
}

impl Default for HudSettings {
    fn default() -> Self {
        Self {
            click_through: false,
            opacity: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub providers: ProviderSettings,
    pub system_prompt: String,
    pub temperature: f32,
    pub max_history: usize,
    pub tts: TtsSettings,
    pub stt: SttSettings,
    pub hud: HudSettings,
    pub start_minimized: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            providers: ProviderSettings::default(),
            system_prompt: concat!(
                "あなたはJ.A.R.V.I.S.（Just A Rather Very Intelligent System）。",
                "ユーザーを「ボス」と呼ぶ、簡潔で落ち着いた口調の有能な執事AIです。",
                "日本語で回答し、要点から述べてから補足します。"
            )
            .into(),
            temperature: 0.7,
            max_history: 24,
            tts: TtsSettings::default(),
            stt: SttSettings::default(),
            hud: HudSettings::default(),
            start_minimized: false,
        }
    }
}

impl Settings {
    /// Clamp every numeric field into a safe range before persisting.
    pub fn sanitized(mut self) -> Self {
        self.temperature = self.temperature.clamp(0.0, 2.0);
        self.max_history = self.max_history.clamp(2, 100);
        if self.providers.order.is_empty() {
            self.providers.order =
                ProviderSettings::default().order;
        }
        self.providers.order.retain(|id| {
            id == "gemini" || id == "ollama"
        });
        if self.providers.order.is_empty() {
            self.providers.order =
                ProviderSettings::default().order;
        }
        self.providers.gemini_base_url =
            self.providers.gemini_base_url.trim_end_matches('/').into();
        self.providers.ollama_base_url =
            self.providers.ollama_base_url.trim_end_matches('/').into();
        if self.tts.engine != "sapi" {
            self.tts.engine = "edge".into();
        }
        self.tts.rate = self.tts.rate.clamp(-100, 100);
        self.tts.volume = self.tts.volume.clamp(0, 100);
        self.stt.silence_ms = self.stt.silence_ms.clamp(200, 5000);
        self.stt.threshold = self.stt.threshold.clamp(0.002, 0.4);
        self.stt.follow_up_ms = self.stt.follow_up_ms.clamp(0, 60_000);
        self.hud.opacity = self.hud.opacity.clamp(0.2, 1.0);
        self
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPayload {
    #[serde(flatten)]
    pub settings: Settings,
    pub has_gemini_key: bool,
    pub stt_available: bool,
    pub stt_detail: String,
    pub db_path: String,
    pub data_dir: String,
    pub previous_version: Option<String>,
}
