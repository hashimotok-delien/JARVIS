use serde::{Deserialize, Serialize};

const DEFAULT_SYSTEM_PROMPT: &str = concat!(
    "あなたはJ.A.R.V.I.S.（Just A Rather Very Intelligent System）。",
    "簡潔で落ち着いた口調の有能な執事AIです。",
    "日本語で回答し、要点から述べてから補足します。"
);
const LEGACY_DEFAULT_SYSTEM_PROMPT: &str = concat!(
    "あなたはJ.A.R.V.I.S.（Just A Rather Very Intelligent System）。",
    "ユーザーを「ボス」と呼ぶ、簡潔で落ち着いた口調の有能な執事AIです。",
    "日本語で回答し、要点から述べてから補足します。"
);

/// speech.cpp model name used when no explicit file is configured.
pub const DEFAULT_SPEECH_MODEL: &str = "haas-ja-v1.0";
/// File name of the recommended Haas-ja Q8_0 weights.
pub const HAAS_MODEL_FILE: &str = "Haas-616M-ja-v1.0-Q8_0.gguf";
/// Byte length of `HAAS_MODEL_FILE`, used to verify a download.
pub const HAAS_MODEL_BYTES: u64 = 656_381_472;

fn clean_path(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(512)
        .collect::<String>()
        .trim()
        .to_string()
}

/// True for `#rrggbb` strings.
fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: String,
    pub title: String,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default)]
    pub summary_upto: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: String,
    pub content: String,
    pub kind: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
    pub body: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub message_id: String,
    pub thread_id: String,
    pub thread_title: String,
    pub role: String,
    pub snippet: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket {
    pub requests: i64,
    pub characters: i64,
    pub avg_latency_ms: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    pub provider: String,
    pub model: String,
    pub requests: i64,
    pub characters: i64,
    pub avg_latency_ms: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    pub today: UsageBucket,
    pub week: UsageBucket,
    pub all: UsageBucket,
    pub by_provider: Vec<ProviderUsage>,
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
    /// OpenCode Go server (OpenAI-compatible base, e.g. http://host:3000/v1).
    pub opencode_base_url: String,
    pub opencode_model: String,
    /// Heavier model used for coding/analysis prompts when auto-routing.
    pub opencode_heavy_model: String,
    /// Route short/simple prompts to the local model and heavy ones to cloud.
    pub auto_route: bool,
}

impl Default for ProviderSettings {
    fn default() -> Self {
        Self {
            order: vec!["gemini".into(), "ollama".into(), "opencode".into()],
            gemini_model: "gemini-2.5-flash".into(),
            gemini_base_url: "https://generativelanguage.googleapis.com/v1beta/openai".into(),
            ollama_model: "qwen2.5:7b-instruct".into(),
            ollama_base_url: "http://127.0.0.1:11434".into(),
            opencode_base_url: "http://127.0.0.1:3000".into(),
            opencode_model: "deepseek-v4.1-flash".into(),
            opencode_heavy_model: "deepseek-v4.1-pro".into(),
            auto_route: false,
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
    /// Pitch in percent (-100..100), mapped to edge-tts Hz.
    pub pitch: i32,
    /// Stop speaking as soon as the microphone detects the user.
    pub barge_in: bool,
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
            pitch: 0,
            barge_in: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SttSettings {
    pub enabled: bool,
    /// "speech" (speech.cpp + Haas-ja) or "whisper" (whisper.cpp).
    pub engine: String,
    pub language: String,
    /// Absolute or relative path to speech.exe (speech.cpp).
    pub speech_path: String,
    /// Model name for speech.cpp, or a path to a .gguf file.
    pub speech_model: String,
    /// "auto", "gpu" or "cpu".
    pub speech_device: String,
    /// Microphone device id; empty selects the system default input.
    pub input_device_id: String,
    /// Feed enrolled wake phrases to Haas as a custom vocabulary.
    pub speech_keywords: bool,
    /// Absolute or relative path to whisper-cli.exe.
    pub whisper_path: String,
    /// Absolute or relative path to a ggml model (e.g. ggml-small.bin).
    pub model_path: String,
    /// Optional initial prompt passed to whisper.cpp (`--prompt`).
    /// Empty disables the wake-word prompt so free speech is not biased.
    pub whisper_prompt: String,
    /// Silence duration that ends an utterance.
    pub silence_ms: u32,
    /// RMS threshold for voice activity detection (0..1).
    pub threshold: f32,
    pub hands_free: bool,
    /// Locally recognized wake-word variants recorded during setup.
    pub wake_samples: Vec<String>,
    /// Seconds to keep listening for a follow-up in hands-free mode.
    pub follow_up_ms: u32,
    /// Continuously poll short audio windows for the wake word while idle.
    pub wake_watch: bool,
    /// High-pass/low-pass filtering plus a noise gate before recognition.
    pub denoise: bool,
    /// "rnnoise" (neural) or "classic" (filters + gate).
    pub denoise_engine: String,
    /// Loudness normalization (AGC) before recognition.
    pub normalize: bool,
}

impl Default for SttSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            engine: "speech".into(),
            language: "ja".into(),
            speech_path: String::new(),
            speech_model: String::new(),
            speech_device: "auto".into(),
            input_device_id: String::new(),
            speech_keywords: true,
            whisper_path: String::new(),
            model_path: String::new(),
            whisper_prompt: String::new(),
            silence_ms: 800,
            threshold: 0.02,
            hands_free: false,
            wake_samples: Vec::new(),
            follow_up_ms: 12_000,
            wake_watch: false,
            denoise: true,
            denoise_engine: "rnnoise".into(),
            normalize: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HudSettings {
    pub click_through: bool,
    pub opacity: f32,
    pub pinned: bool,
    pub width: u32,
    pub height: u32,
    pub position_x: i32,
    pub position_y: i32,
    /// Freeze ring rotation and drop the blur to save CPU.
    pub static_mode: bool,
    pub show_clock: bool,
    pub show_system: bool,
    pub show_weather: bool,
    pub show_usage: bool,
    /// Background alpha of the dashboard panels (0.0..1.0).
    pub panel_opacity: f32,
    /// Label shown on the weather panel.
    pub weather_city: String,
    pub weather_lat: f64,
    pub weather_lon: f64,
}

impl Default for HudSettings {
    fn default() -> Self {
        Self {
            click_through: false,
            opacity: 1.0,
            pinned: false,
            width: 380,
            height: 208,
            position_x: 40,
            position_y: 40,
            static_mode: false,
            show_clock: true,
            show_system: true,
            show_weather: true,
            show_usage: true,
            panel_opacity: 0.9,
            weather_city: "TOKYO".into(),
            weather_lat: 35.6812,
            weather_lon: 139.7671,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct McpServer {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub enabled: bool,
}

impl Default for McpServer {
    fn default() -> Self {
        Self {
            name: String::new(),
            command: String::new(),
            args: Vec::new(),
            enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ToolSettings {
    /// Master switch for function calling.
    pub enabled: bool,
    pub web_search: bool,
    pub shell: bool,
    pub files: bool,
    pub clipboard: bool,
    pub screenshot: bool,
    pub timers: bool,
    /// Ask the user before risky tool calls (write_file, launch_app, open_url).
    pub approval: bool,
    pub mcp_servers: Vec<McpServer>,
}

impl Default for ToolSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            web_search: true,
            shell: true,
            files: true,
            clipboard: true,
            screenshot: true,
            timers: true,
            approval: true,
            mcp_servers: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MemorySettings {
    pub enabled: bool,
    pub auto_extract: bool,
    pub inject: bool,
    pub max_items: usize,
    pub auto_summarize: bool,
}

impl Default for MemorySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            auto_extract: false,
            inject: true,
            max_items: 12,
            auto_summarize: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UiSettings {
    /// "dark" or "light".
    pub theme: String,
    pub font_scale: f32,
    /// "custom" | "top-left" | "top-right" | "bottom-left" | "bottom-right".
    pub hud_preset: String,
    pub clipboard_watch: bool,
    /// "arc" | "ember" | "matrix" | "crimson" | "mono" | "custom".
    pub hud_theme: String,
    /// Accent colour (#rrggbb) used when `hud_theme` is "custom".
    pub hud_accent: String,
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            font_scale: 1.0,
            hud_preset: "custom".into(),
            clipboard_watch: false,
            hud_theme: "arc".into(),
            hud_accent: "#00e5ff".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateSettings {
    /// Folder watched for `latest.json` and its installer.
    pub folder: String,
    /// Re-check the folder while the app runs.
    pub watch: bool,
    /// Seconds between automatic checks.
    pub poll_seconds: u32,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self {
            folder: String::new(),
            watch: true,
            poll_seconds: 60,
        }
    }
}

/// A locally-run helper process (Ollama, opencode web, ...) that JARVIS can
/// start on launch and stop on exit when it spawned it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalService {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    /// Optional URL that is polled until the service answers.
    pub health_url: String,
    pub auto_start: bool,
    pub stop_on_exit: bool,
    pub enabled: bool,
}

impl Default for LocalService {
    fn default() -> Self {
        Self {
            name: String::new(),
            command: String::new(),
            args: Vec::new(),
            cwd: String::new(),
            health_url: String::new(),
            auto_start: true,
            stop_on_exit: true,
            enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub providers: ProviderSettings,
    pub system_prompt: String,
    pub preferred_name: String,
    pub temperature: f32,
    pub max_history: usize,
    pub tts: TtsSettings,
    pub stt: SttSettings,
    pub hud: HudSettings,
    pub start_minimized: bool,
    pub tools: ToolSettings,
    pub memory: MemorySettings,
    pub ui: UiSettings,
    pub updates: UpdateSettings,
    pub services: Vec<LocalService>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            providers: ProviderSettings::default(),
            system_prompt: DEFAULT_SYSTEM_PROMPT.into(),
            preferred_name: "ボス".into(),
            temperature: 0.7,
            max_history: 24,
            tts: TtsSettings::default(),
            stt: SttSettings::default(),
            hud: HudSettings::default(),
            start_minimized: false,
            tools: ToolSettings::default(),
            memory: MemorySettings::default(),
            ui: UiSettings::default(),
            updates: UpdateSettings::default(),
            services: Vec::new(),
        }
    }
}

impl Settings {
    /// Clamp every numeric field into a safe range before persisting.
    pub fn sanitized(mut self) -> Self {
        if self.system_prompt == LEGACY_DEFAULT_SYSTEM_PROMPT {
            self.system_prompt = DEFAULT_SYSTEM_PROMPT.into();
        }
        self.preferred_name = self
            .preferred_name
            .chars()
            .filter(|character| !character.is_control())
            .take(32)
            .collect::<String>()
            .trim()
            .to_string();
        if self.preferred_name.is_empty() {
            self.preferred_name = "ボス".into();
        }
        self.temperature = self.temperature.clamp(0.0, 2.0);
        self.max_history = self.max_history.clamp(2, 100);
        if self.providers.order.is_empty() {
            self.providers.order = ProviderSettings::default().order;
        }
        self.providers
            .order
            .retain(|id| id == "gemini" || id == "ollama" || id == "opencode");
        if self.providers.order.is_empty() {
            self.providers.order = ProviderSettings::default().order;
        }
        self.providers.gemini_base_url =
            self.providers.gemini_base_url.trim_end_matches('/').into();
        self.providers.ollama_base_url =
            self.providers.ollama_base_url.trim_end_matches('/').into();
        self.providers.opencode_base_url =
            self.providers.opencode_base_url.trim_end_matches('/').into();
        // Older builds pointed at an OpenAI-compatible `/v1`; the native
        // API lives at the server root.
        let trimmed = self.providers.opencode_base_url.clone();
        let normalized = trimmed
            .strip_suffix("/v1")
            .unwrap_or(&trimmed)
            .to_string();
        self.providers.opencode_base_url = normalized;
        if self.providers.opencode_base_url.trim().is_empty() {
            self.providers.opencode_base_url =
                ProviderSettings::default().opencode_base_url;
        }
        for model in [
            &mut self.providers.opencode_model,
            &mut self.providers.opencode_heavy_model,
        ] {
            *model = model
                .chars()
                .filter(|character| !character.is_control())
                .take(80)
                .collect::<String>()
                .trim()
                .to_string();
        }
        if self.providers.opencode_model.is_empty() {
            self.providers.opencode_model = ProviderSettings::default().opencode_model;
        }
        if self.providers.opencode_heavy_model.is_empty() {
            self.providers.opencode_heavy_model =
                ProviderSettings::default().opencode_heavy_model;
        }
        if self.tts.engine != "sapi" {
            self.tts.engine = "edge".into();
        }
        self.tts.rate = self.tts.rate.clamp(-100, 100);
        self.tts.volume = self.tts.volume.clamp(0, 100);
        self.tts.pitch = self.tts.pitch.clamp(-100, 100);
        if self.tts.voice.trim().is_empty() {
            self.tts.voice = TtsSettings::default().voice;
        }
        self.tts.voice = self
            .tts
            .voice
            .chars()
            .filter(|c| !c.is_control())
            .take(80)
            .collect();
        self.ui.font_scale = self.ui.font_scale.clamp(0.8, 1.4);
        if self.ui.theme != "light" {
            self.ui.theme = "dark".into();
        }
        if !matches!(
            self.ui.hud_preset.as_str(),
            "top-left" | "top-right" | "bottom-left" | "bottom-right"
        ) {
            self.ui.hud_preset = "custom".into();
        }
        if !matches!(
            self.ui.hud_theme.as_str(),
            "arc" | "ember" | "matrix" | "crimson" | "mono" | "custom"
        ) {
            self.ui.hud_theme = "arc".into();
        }
        self.ui.hud_accent = self
            .ui
            .hud_accent
            .trim()
            .to_ascii_lowercase()
            .chars()
            .take(7)
            .collect();
        if !is_hex_color(&self.ui.hud_accent) {
            self.ui.hud_accent = "#00e5ff".into();
        }
        self.hud.width = self.hud.width.clamp(320, 1920);
        self.hud.height = self.hud.height.clamp(160, 1080);
        self.hud.opacity = self.hud.opacity.clamp(0.3, 1.0);
        self.hud.panel_opacity = self.hud.panel_opacity.clamp(0.0, 1.0);
        self.hud.weather_city = self
            .hud
            .weather_city
            .chars()
            .filter(|character| !character.is_control())
            .take(24)
            .collect::<String>()
            .trim()
            .to_string();
        if self.hud.weather_city.is_empty() {
            self.hud.weather_city = HudSettings::default().weather_city;
        }
        self.hud.weather_lat = self.hud.weather_lat.clamp(-90.0, 90.0);
        self.hud.weather_lon = self.hud.weather_lon.clamp(-180.0, 180.0);
        self.memory.max_items = self.memory.max_items.clamp(0, 40);
        self.tools.mcp_servers = std::mem::take(&mut self.tools.mcp_servers)
            .into_iter()
            .filter_map(|server| {
                let name: String = server
                    .name
                    .chars()
                    .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                    .take(32)
                    .collect();
                let command = server.command.trim().to_string();
                if name.is_empty() || command.is_empty() {
                    return None;
                }
                Some(McpServer {
                    name,
                    command,
                    args: server
                        .args
                        .into_iter()
                        .map(|arg| arg.trim().to_string())
                        .filter(|arg| !arg.is_empty())
                        .take(16)
                        .collect(),
                    enabled: server.enabled,
                })
            })
            .take(8)
            .collect();
        self.updates.folder = self
            .updates
            .folder
            .chars()
            .filter(|character| !character.is_control())
            .take(512)
            .collect::<String>()
            .trim()
            .to_string();
        self.updates.poll_seconds = self.updates.poll_seconds.clamp(15, 3600);
        if self.stt.engine != "whisper" {
            self.stt.engine = "speech".into();
        }
        if !matches!(self.stt.speech_device.as_str(), "gpu" | "cpu") {
            self.stt.speech_device = "auto".into();
        }
        self.stt.input_device_id = self
            .stt
            .input_device_id
            .chars()
            .filter(|character| !character.is_control())
            .take(256)
            .collect::<String>()
            .trim()
            .to_string();
        self.stt.speech_path = clean_path(&self.stt.speech_path);
        self.stt.speech_model = clean_path(&self.stt.speech_model);
        if self.stt.speech_model.is_empty() {
            self.stt.speech_model = DEFAULT_SPEECH_MODEL.into();
        }
        self.stt.whisper_path = clean_path(&self.stt.whisper_path);
        self.stt.model_path = clean_path(&self.stt.model_path);
        self.stt.whisper_prompt = self
            .stt
            .whisper_prompt
            .chars()
            .filter(|character| !character.is_control())
            .take(200)
            .collect::<String>()
            .trim()
            .to_string();
        self.stt.silence_ms = self.stt.silence_ms.clamp(200, 5000);
        self.stt.threshold = self.stt.threshold.clamp(0.002, 0.4);
        let mut wake_samples = Vec::new();
        for sample in std::mem::take(&mut self.stt.wake_samples) {
            let sample: String = sample
                .chars()
                .filter(|character| !character.is_control())
                .take(48)
                .collect::<String>()
                .trim()
                .to_string();
            // Keep every enrollment attempt (up to 5) so the registered count
            // matches what the user recorded. Duplicates are collapsed later,
            // only when building the ASR keyword prompt.
            if !sample.is_empty() && wake_samples.len() < 5 {
                wake_samples.push(sample);
            }
        }
        self.stt.wake_samples = wake_samples;
        self.stt.follow_up_ms = self.stt.follow_up_ms.clamp(0, 60_000);
        if self.stt.denoise_engine != "classic" {
            self.stt.denoise_engine = "rnnoise".into();
        }
        self.hud.opacity = self.hud.opacity.clamp(0.2, 1.0);
        self.hud.width = self.hud.width.clamp(380, 1920);
        self.hud.height = self.hud.height.clamp(208, 1080);
        self.hud.position_x = self.hud.position_x.clamp(-16_384, 16_384);
        self.hud.position_y = self.hud.position_y.clamp(-16_384, 16_384);

        self.services = std::mem::take(&mut self.services)
            .into_iter()
            .filter_map(|service| {
                let command = service.command.trim().to_string();
                if command.is_empty() {
                    return None;
                }
                let mut name: String = service
                    .name
                    .chars()
                    .filter(|character| !character.is_control())
                    .take(40)
                    .collect::<String>()
                    .trim()
                    .to_string();
                if name.is_empty() {
                    name = command
                        .chars()
                        .filter(|character| {
                            character.is_ascii_alphanumeric()
                                || *character == '-'
                                || *character == '_'
                        })
                        .take(40)
                        .collect();
                }
                if name.is_empty() {
                    return None;
                }
                let health_url = service.health_url.trim().to_string();
                let health_url = if health_url.starts_with("http://")
                    || health_url.starts_with("https://")
                {
                    health_url
                } else {
                    String::new()
                };
                Some(LocalService {
                    name,
                    command,
                    args: service
                        .args
                        .into_iter()
                        .map(|arg| {
                            arg.trim()
                                .chars()
                                .filter(|character| !character.is_control())
                                .take(300)
                                .collect::<String>()
                        })
                        .filter(|arg| !arg.is_empty())
                        .take(20)
                        .collect(),
                    cwd: clean_path(&service.cwd),
                    health_url,
                    auto_start: service.auto_start,
                    stop_on_exit: service.stop_on_exit,
                    enabled: service.enabled,
                })
            })
            .take(10)
            .collect();

        let mut seen: Vec<String> = Vec::new();
        self.services.retain(|service| {
            if seen.iter().any(|name| name == &service.name) {
                false
            } else {
                seen.push(service.name.clone());
                true
            }
        });
        self
    }

    pub fn system_prompt_for_chat(&self) -> String {
        format!(
            "{}\nユーザーを「{}」とお呼びください。",
            self.system_prompt, self.preferred_name
        )
    }
}

/// Approximate edge-tts pitch value ("+0Hz"): percent mapped to Hz.
pub fn pitch_to_hz(value: i32) -> String {
    let hz = (value.clamp(-100, 100) as f32 * 1.6).round() as i32;
    if hz >= 0 {
        format!("+{hz}Hz")
    } else {
        format!("{hz}Hz")
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPayload {
    #[serde(flatten)]
    pub settings: Settings,
    pub has_gemini_key: bool,
    pub has_opencode_key: bool,
    pub stt_available: bool,
    pub stt_detail: String,
    pub db_path: String,
    pub data_dir: String,
    pub previous_version: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn older_settings_default_the_preferred_name() {
        let settings: Settings = serde_json::from_str(r#"{"systemPrompt":"custom"}"#).unwrap();

        assert_eq!(settings.preferred_name, "ボス");
    }

    #[test]
    fn legacy_default_prompt_uses_the_configured_name() {
        let settings = Settings {
            system_prompt: LEGACY_DEFAULT_SYSTEM_PROMPT.into(),
            preferred_name: "アレックス".into(),
            ..Settings::default()
        }
        .sanitized();

        assert!(!settings.system_prompt.contains("ボス"));
        assert!(
            settings
                .system_prompt_for_chat()
                .ends_with("ユーザーを「アレックス」とお呼びください。")
        );
    }

    #[test]
    fn settings_round_trip_new_sections() {
        let settings = Settings {
            tools: ToolSettings {
                enabled: true,
                mcp_servers: vec![McpServer {
                    name: "fs".into(),
                    command: "npx".into(),
                    args: vec!["-y".into(), "server".into()],
                    enabled: true,
                }],
                ..ToolSettings::default()
            },
            memory: MemorySettings {
                auto_extract: true,
                max_items: 20,
                ..MemorySettings::default()
            },
            ui: UiSettings {
                theme: "light".into(),
                font_scale: 1.2,
                ..UiSettings::default()
            },
            ..Settings::default()
        }
        .sanitized();

        let json = serde_json::to_string(&settings).unwrap();
        let parsed: Settings = serde_json::from_str(&json).unwrap();

        assert!(parsed.tools.enabled);
        assert_eq!(parsed.tools.mcp_servers[0].name, "fs");
        assert_eq!(parsed.memory.max_items, 20);
        assert_eq!(parsed.ui.theme, "light");
    }

    #[test]
    fn older_settings_get_default_update_settings() {
        let settings: Settings = serde_json::from_str(r#"{"preferredName":"ボス"}"#).unwrap();

        assert!(settings.updates.folder.is_empty());
        assert!(settings.updates.watch);
        assert_eq!(settings.updates.poll_seconds, 60);
    }

    #[test]
    fn settings_sanitize_update_folder_and_poll_interval() {
        let settings = Settings {
            updates: UpdateSettings {
                folder: "  D:\\repo\\updates\u{7}  ".into(),
                watch: true,
                poll_seconds: 2,
            },
            ..Settings::default()
        }
        .sanitized();

        assert_eq!(settings.updates.folder, "D:\\repo\\updates");
        assert_eq!(settings.updates.poll_seconds, 15);
    }

    #[test]
    fn local_services_are_sanitized_and_deduplicated() {
        let settings = Settings {
            services: vec![
                LocalService {
                    name: " ollama ".into(),
                    command: " ollama ".into(),
                    args: vec!["serve".into(), " ".into()],
                    health_url: "file:///etc/passwd".into(),
                    ..LocalService::default()
                },
                LocalService {
                    name: "ollama".into(),
                    command: "other".into(),
                    ..LocalService::default()
                },
                LocalService {
                    name: "".into(),
                    command: "".into(),
                    ..LocalService::default()
                },
            ],
            ..Settings::default()
        }
        .sanitized();

        assert_eq!(settings.services.len(), 1);
        assert_eq!(settings.services[0].name, "ollama");
        assert_eq!(settings.services[0].command, "ollama");
        assert_eq!(settings.services[0].args, vec!["serve".to_string()]);
        assert!(settings.services[0].health_url.is_empty());
    }

    #[test]
    fn settings_sanitize_wake_samples_and_hud_geometry() {
        let settings = Settings {
            stt: SttSettings {
                wake_samples: vec![
                    "じゃあびす".into(),
                    " じゃあびす ".into(),
                    "JARVIS".into(),
                    "ジャービス".into(),
                    "ジャビス".into(),
                    "呼びかけ5".into(),
                    "呼びかけ6".into(),
                ],
                ..SttSettings::default()
            },
            hud: HudSettings {
                width: 100,
                height: 100,
                position_x: 20_000,
                ..HudSettings::default()
            },
            ..Settings::default()
        }
        .sanitized();

        assert_eq!(settings.stt.wake_samples.len(), 5);
        assert_eq!(settings.hud.width, 380);
        assert_eq!(settings.hud.height, 208);
        assert_eq!(settings.hud.position_x, 16_384);
    }
}
