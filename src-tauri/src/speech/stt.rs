//! Speech-to-text through speech.cpp (Haas-ja) or whisper.cpp.
//!
//! speech.cpp keeps its recognizer loaded in a worker process, so an utterance
//! costs tens of milliseconds instead of a model load per request.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

use super::worker::SpeechWorker;
use crate::models::{DEFAULT_SPEECH_MODEL, HAAS_MODEL_FILE, Settings};
use crate::paths;
use crate::state::AppState;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const SPEECH_BINARY_NAMES: [&str; 2] = ["speech.exe", "speech"];
const WHISPER_BINARY_NAMES: [&str; 3] = ["whisper-cli.exe", "whisper-cli", "main.exe"];

fn is_file(path: &Path) -> bool {
    path.is_file()
}

fn from_settings(value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = PathBuf::from(trimmed);
    is_file(&path).then_some(path)
}

fn search_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let state = app.state::<AppState>();
    dirs.push(state.data_dir.join("bin"));
    if let Ok(dir) = app.path().resource_dir() {
        dirs.push(dir.join("binaries"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.join("binaries"));
            dirs.push(parent.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd.join("src-tauri").join("binaries"));
        dirs.push(cwd.join("binaries"));
    }
    dirs
}

fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

fn find_binary(app: &AppHandle, configured: &str, names: &[&str]) -> Option<PathBuf> {
    if let Some(path) = from_settings(configured) {
        return Some(path);
    }
    for dir in search_dirs(app) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    names.iter().find_map(|name| which(name))
}

/// Path where JARVIS stores its own copy of the Haas-ja weights.
pub fn local_model_path(app: &AppHandle) -> PathBuf {
    let state = app.state::<AppState>();
    paths::models_dir(&state.data_dir).join(HAAS_MODEL_FILE)
}

fn speech_model_arg(app: &AppHandle, settings: &Settings) -> String {
    let configured = settings.stt.speech_model.trim();
    if configured.is_empty() {
        return DEFAULT_SPEECH_MODEL.to_string();
    }
    if configured.to_lowercase().ends_with(".gguf") {
        let path = PathBuf::from(configured);
        if path.is_file() {
            return path.to_string_lossy().to_string();
        }
        return DEFAULT_SPEECH_MODEL.to_string();
    }
    if configured == DEFAULT_SPEECH_MODEL {
        let local = local_model_path(app);
        if local.is_file() {
            return local.to_string_lossy().to_string();
        }
    }
    configured.to_string()
}

pub fn resolve_speech_binary(app: &AppHandle, settings: &Settings) -> Option<PathBuf> {
    find_binary(app, &settings.stt.speech_path, &SPEECH_BINARY_NAMES)
}

pub fn resolve_binary(app: &AppHandle, settings: &Settings) -> Option<PathBuf> {
    find_binary(app, &settings.stt.whisper_path, &WHISPER_BINARY_NAMES)
}

pub fn resolve_model(app: &AppHandle, settings: &Settings) -> Option<PathBuf> {
    if let Some(path) = from_settings(&settings.stt.model_path) {
        return Some(path);
    }
    let names = ["ggml-small.bin", "ggml-base.bin", "ggml-medium.bin"];
    for dir in search_dirs(app) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Custom vocabulary for Haas: the wake word with the ways the user says it.
pub fn keyword_line(settings: &Settings) -> String {
    let mut readings: Vec<String> = ["じゃーびす", "じゃあびす", "じゃびす", "ジャーヴィス"]
        .iter()
        .map(|value| (*value).to_string())
        .collect();

    for sample in &settings.stt.wake_samples {
        let cleaned: String = sample
            .chars()
            .filter(|character| {
                !character.is_control()
                    && !character.is_whitespace()
                    && *character != ','
                    && *character != '='
            })
            .take(24)
            .collect();
        if !cleaned.is_empty() {
            readings.push(cleaned);
        }
    }

    let mut unique: Vec<String> = Vec::new();
    for reading in readings {
        if !unique.iter().any(|existing| existing == &reading) {
            unique.push(reading);
        }
    }
    unique.truncate(6);
    format!("ジャービス={}", unique.join(","))
}

#[cfg(test)]
fn wake_prompt(settings: &Settings) -> String {
    let mut phrases = vec![
        "JARVIS".to_string(),
        "ジャービス".to_string(),
        "ジャーヴィス".to_string(),
        "ジャビス".to_string(),
        "じゃあびす".to_string(),
    ];
    phrases.extend(settings.stt.wake_samples.iter().cloned());
    let mut unique: Vec<String> = Vec::new();
    for phrase in phrases {
        if !unique.iter().any(|existing| existing == &phrase) {
            unique.push(phrase);
        }
    }
    unique.join(", ")
}

fn whisper_ready(app: &AppHandle, settings: &Settings) -> bool {
    resolve_binary(app, settings).is_some() && resolve_model(app, settings).is_some()
}

fn speech_cache_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|dir| PathBuf::from(dir).join("speech.cpp").join("models"))
}

fn find_cached_model(dir: &Path, needle: &str, depth: usize) -> bool {
    if depth > 4 {
        return false;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if find_cached_model(&path, needle, depth + 1) {
                return true;
            }
            continue;
        }
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if name.ends_with(".gguf") && name.contains(needle) {
            return true;
        }
    }
    false
}

/// Whether the configured recognizer weights can be loaded.
pub fn model_present(app: &AppHandle, settings: &Settings) -> bool {
    let model = speech_model_arg(app, settings);
    if model.to_lowercase().ends_with(".gguf") {
        return Path::new(&model).is_file();
    }
    let needle = if model.to_lowercase().contains("haas") {
        "haas".to_string()
    } else {
        model.to_lowercase()
    };
    match speech_cache_dir() {
        Some(dir) => find_cached_model(&dir, &needle, 0),
        None => false,
    }
}

fn speech_ready(app: &AppHandle, settings: &Settings) -> bool {
    resolve_speech_binary(app, settings).is_some() && model_present(app, settings)
}

/// Which engine will be used, considering what is installed.
pub fn active_engine(app: &AppHandle, settings: &Settings) -> &'static str {
    if settings.stt.engine == "speech" {
        if speech_ready(app, settings) {
            "speech"
        } else if whisper_ready(app, settings) {
            "whisper"
        } else {
            "none"
        }
    } else if whisper_ready(app, settings) {
        "whisper"
    } else if speech_ready(app, settings) {
        "speech"
    } else {
        "none"
    }
}

pub fn availability(app: &AppHandle, settings: &Settings) -> (bool, String) {
    match active_engine(app, settings) {
        "speech" => {
            let model = speech_model_arg(app, settings);
            let model_name = model.rsplit(['\\', '/']).next().unwrap_or(&model);
            let binary_name = resolve_speech_binary(app, settings)
                .and_then(|path| {
                    path.file_name()
                        .map(|name| name.to_string_lossy().to_string())
                })
                .unwrap_or_else(|| "speech.exe".to_string());
            (true, format!("{binary_name} / {model_name}"))
        }
        "whisper" => {
            let binary = resolve_binary(app, settings);
            let model = resolve_model(app, settings);
            match (binary, model) {
                (Some(b), Some(m)) => (
                    true,
                    format!(
                        "{} / {}",
                        b.file_name().unwrap_or_default().to_string_lossy(),
                        m.file_name().unwrap_or_default().to_string_lossy()
                    ),
                ),
                (None, _) => (
                    false,
                    "whisper-cli.exe が見つかりません（設定でパス指定可）".into(),
                ),
                (_, None) => (
                    false,
                    "ggml モデルが見つかりません（設定でパス指定可）".into(),
                ),
            }
        }
        _ => {
            if resolve_speech_binary(app, settings).is_some() {
                (
                    false,
                    "音声認識モデルが未取得です。設定の「取得」でダウンロードしてください".into(),
                )
            } else {
                (
                    false,
                    "speech.exe（speech.cpp）か whisper-cli.exe を設定してください".into(),
                )
            }
        }
    }
}

/// Whisper (especially the small model) and noisy recordings can produce a
/// single syllable repeated over and over, e.g. "ババババババ". Treat that as a
/// failed recognition instead of showing nonsense to the user.
const HALLUCINATION_PHRASES: &[&str] = &[
    "ご視聴ありがとうございました",
    "ご視聴いただきありがとうございました",
    "チャンネル登録",
    "高評価",
    "字幕",
    "おやすみなさい",
    "thanksforwatching",
    "thankyouforwatching",
];

/// Whisper invents stock phrases on silence or noise. Reject them unless the
/// audio clearly contains speech.
fn looks_like_hallucination(
    text: &str,
    metrics: Option<crate::speech::dsp::AudioMetrics>,
) -> bool {
    let normalized: String = text
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>()
        .to_lowercase();
    if normalized.chars().count() > 60 {
        return false;
    }
    let hit = HALLUCINATION_PHRASES
        .iter()
        .any(|phrase| normalized.contains(phrase));
    if !hit {
        return false;
    }
    match metrics {
        Some(metrics) => metrics.speech_ratio < 0.25 || metrics.duration_ms < 1_200,
        None => true,
    }
}

fn is_degenerate_transcript(text: &str) -> bool {
    let chars: Vec<char> = text.chars().filter(|c| !c.is_whitespace()).collect();
    if chars.len() < 8 {
        return false;
    }
    let mut counts: HashMap<char, usize> = HashMap::new();
    for character in &chars {
        *counts.entry(*character).or_default() += 1;
    }
    let most = counts.values().copied().max().unwrap_or(0);
    most * 100 / chars.len() >= 60
}

fn run_engine(
    app: &AppHandle,
    settings: &Settings,
    wav: &[u8],
    engine: &str,
) -> Result<String, String> {
    match engine {
        "speech" => transcribe_speech(app, settings, wav),
        "whisper" => transcribe_whisper(app, settings, wav),
        _ => Err(
            "音声認識エンジンがありません。設定で speech.exe か whisper-cli.exe を指定してください。"
                .to_string(),
        ),
    }
}

pub fn transcribe(app: &AppHandle, settings: &Settings, wav: &[u8]) -> Result<String, String> {
    let engine = active_engine(app, settings);

    // Preprocess once so every engine and retry sees the same cleaned audio.
    let (processed, mut metrics) = if settings.stt.denoise || settings.stt.normalize {
        match crate::speech::dsp::process_wav(
            wav,
            settings.stt.denoise,
            settings.stt.normalize,
            &settings.stt.denoise_engine,
        ) {
            Ok((bytes, metrics)) => (bytes, Some(metrics)),
            Err(error) => {
                crate::log_message("WARN", "stt", &format!("dsp failed: {error}"));
                (
                    wav.to_vec(),
                    crate::speech::dsp::wav_metrics(wav).ok(),
                )
            }
        }
    } else {
        (
            wav.to_vec(),
            crate::speech::dsp::wav_metrics(wav).ok(),
        )
    };
    // Both engines expect 16 kHz mono; resample once for all retries.
    let wav_buffer = crate::speech::dsp::ensure_16k(&processed).unwrap_or(processed);
    if let Some(metrics) = metrics.as_mut() {
        metrics.sample_rate = 16_000;
    }
    let wav = wav_buffer.as_slice();
    if let Some(metrics) = metrics {
        crate::log_message(
            "DEBUG",
            "stt",
            &format!("engine={engine} {}", metrics.summary()),
        );
    }

    let mut used = engine;
    let mut result = run_engine(app, settings, wav, engine);
    if result.is_err() && engine == "speech" && whisper_ready(app, settings) {
        crate::log_message("WARN", "stt", "speech failed; retrying with whisper");
        used = "whisper";
        result = run_engine(app, settings, wav, "whisper");
    }

    let low_quality = match &result {
        Err(_) => true,
        Ok(text) => {
            text.trim().is_empty()
                || is_degenerate_transcript(text)
                || looks_like_hallucination(text, metrics)
                || metrics
                    .map(|metrics| {
                        metrics.duration_ms >= 500 && metrics.speech_ratio < 0.06
                    })
                    .unwrap_or(false)
        }
    };
    if low_quality {
        let alternate = match used {
            "speech" if whisper_ready(app, settings) => Some("whisper"),
            "whisper" if speech_ready(app, settings) => Some("speech"),
            _ => None,
        };
        if let Some(alternate) = alternate {
            crate::log_message(
                "WARN",
                "stt",
                &format!("low quality result from {used}; retrying with {alternate}"),
            );
            if let Ok(text) = run_engine(app, settings, wav, alternate) {
                if !text.trim().is_empty() && !is_degenerate_transcript(&text) {
                    used = alternate;
                    result = Ok(text);
                }
            }
        }
    }

    match result {
        Ok(text) if !text.trim().is_empty() => {
            let preview: String = text.chars().take(80).collect();
            crate::log_message(
                "DEBUG",
                "stt",
                &format!("engine={used} text={preview}"),
            );
            if is_degenerate_transcript(&text)
                || looks_like_hallucination(&text, metrics)
            {
                crate::log_message(
                    "WARN",
                    "stt",
                    &format!("suspect transcript rejected (engine={used})"),
                );
                // Not an error: this is silence/noise. An empty string lets
                // the caller return to idle without surfacing a failure.
                Ok(String::new())
            } else {
                Ok(text)
            }
        }
        Ok(_) => Ok(String::new()),
        Err(error) => Err(error),
    }
}

fn transcribe_speech(app: &AppHandle, settings: &Settings, wav: &[u8]) -> Result<String, String> {
    let binary = resolve_speech_binary(app, settings)
        .ok_or_else(|| "speech.exe が見つかりません。設定画面で指定してください。".to_string())?;
    if !model_present(app, settings) {
        return Err(
            "音声認識モデルがありません。設定 → 音声入力 → 「取得」でダウンロードしてください。"
                .to_string(),
        );
    }
    let model = speech_model_arg(app, settings);
    let device = settings.stt.speech_device.clone();
    let keywords = if settings.stt.speech_keywords {
        keyword_line(settings)
    } else {
        String::new()
    };
    let signature = format!(
        "{}|{}|{}|{}",
        binary.to_string_lossy(),
        model,
        device,
        keywords
    );
    let (pcm, sample_rate) = wav_pcm(wav)?;

    let state = app.state::<AppState>();
    let mut guard = state
        .asr_worker
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    for attempt in 0..2 {
        let stale = guard
            .as_ref()
            .map(|worker| worker.signature() != signature)
            .unwrap_or(true);
        if stale {
            *guard = None;
            match SpeechWorker::spawn(&binary, &model, &device, &keywords) {
                Ok(worker) => *guard = Some(worker),
                Err(error) => {
                    crate::log_message("ERROR", "stt", &error);
                    return Err(error);
                }
            }
        }

        let result = match guard.as_mut() {
            Some(worker) => worker.transcribe(&pcm, sample_rate),
            None => Err("speech worker を起動できません".to_string()),
        };
        match result {
            Ok(text) => return Ok(text),
            Err(error) => {
                crate::log_message("WARN", "stt", &format!("worker retry {attempt}: {error}"));
                *guard = None;
            }
        }
    }

    Err("speech worker で文字起こしできませんでした".to_string())
}

fn transcribe_whisper(app: &AppHandle, settings: &Settings, wav: &[u8]) -> Result<String, String> {
    let binary = resolve_binary(app, settings).ok_or_else(|| {
        "whisper.cpp が見つかりません。設定画面で whisper-cli.exe のパスを指定してください。"
            .to_string()
    })?;
    let model = resolve_model(app, settings).ok_or_else(|| {
        "whisper モデル（ggml-*.bin）が見つかりません。設定画面で指定してください。".to_string()
    })?;

    let work = std::env::temp_dir().join("jarvis-stt");
    std::fs::create_dir_all(&work).map_err(|e| format!("作業ディレクトリを作成できません: {e}"))?;

    let id = uuid::Uuid::new_v4().simple().to_string();
    let wav_path = work.join(format!("{id}.wav"));
    let out_base = work.join(&id);
    let txt_path = work.join(format!("{id}.txt"));

    std::fs::write(&wav_path, wav).map_err(|e| format!("音声ファイルを書き込めません: {e}"))?;

    let mut command = Command::new(&binary);
    command
        .arg("-m")
        .arg(&model)
        .arg("-f")
        .arg(&wav_path)
        .arg("-l")
        .arg(&settings.stt.language);
    // Do not bias free speech with the wake-word prompt. A long custom prompt
    // can be set explicitly when the user wants domain vocabulary.
    let prompt = settings.stt.whisper_prompt.trim();
    if !prompt.is_empty() {
        command.arg("--prompt").arg(prompt);
    }
    command.arg("-nt").arg("-otxt").arg("-of").arg(&out_base);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|e| format!("whisper を起動できません: {e}"))?;

    let text = std::fs::read_to_string(&txt_path)
        .ok()
        .or_else(|| {
            output
                .status
                .success()
                .then(|| String::from_utf8_lossy(&output.stdout).to_string())
        })
        .unwrap_or_default();

    let _ = std::fs::remove_file(&wav_path);
    let _ = std::fs::remove_file(&txt_path);

    if !output.status.success() && text.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail: String = stderr.chars().take(400).collect();
        return Err(format!("whisper が失敗しました: {detail}"));
    }

    Ok(text.trim().to_string())
}

/// Start the worker ahead of the first utterance so it is warm when needed.
pub fn warm_up(app: &AppHandle) {
    let settings = crate::commands::read_settings_from(app);
    if !settings.stt.enabled || active_engine(app, &settings) != "speech" {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let settings = crate::commands::read_settings_from(&app);
        match transcribe_speech(&app, &settings, &silent_wav()) {
            Ok(_) => crate::log_message("INFO", "stt", "speech worker warmed up"),
            Err(error) => crate::log_message(
                "WARN",
                "stt",
                &format!("speech worker warm-up failed: {error}"),
            ),
        }
    });
}

fn silent_wav() -> Vec<u8> {
    let pcm = vec![0u8; 16_000];
    wav_bytes(&pcm, 16_000)
}

fn wav_bytes(pcm: &[u8], sample_rate: u32) -> Vec<u8> {
    let mut wav = Vec::with_capacity(44 + pcm.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&((36 + pcm.len()) as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(pcm);
    wav
}

/// Extract the PCM payload and sample rate from a WAV recording.
pub fn wav_pcm(wav: &[u8]) -> Result<(Vec<u8>, u32), String> {
    if wav.len() < 12 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return Err("WAV 形式ではありません".to_string());
    }

    let mut sample_rate = 16_000u32;
    let mut offset = 12usize;
    while offset + 8 <= wav.len() {
        let id = &wav[offset..offset + 4];
        let size = u32::from_le_bytes([
            wav[offset + 4],
            wav[offset + 5],
            wav[offset + 6],
            wav[offset + 7],
        ]) as usize;
        let body = offset + 8;

        match id {
            b"fmt " if body + 8 <= wav.len() => {
                sample_rate = u32::from_le_bytes([
                    wav[body + 4],
                    wav[body + 5],
                    wav[body + 6],
                    wav[body + 7],
                ]);
            }
            b"data" => {
                let end = (body + size).min(wav.len());
                return Ok((wav[body..end].to_vec(), sample_rate));
            }
            _ => {}
        }

        offset = body + size + (size & 1);
    }

    Err("WAV の data チャンクが見つかりません".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SttSettings;

    fn settings_with_wake(samples: &[&str]) -> Settings {
        Settings {
            stt: SttSettings {
                wake_samples: samples.iter().map(|value| (*value).to_string()).collect(),
                ..SttSettings::default()
            },
            ..Settings::default()
        }
    }

    #[test]
    fn prompt_includes_standard_and_enrolled_wake_phrases() {
        let prompt = wake_prompt(&settings_with_wake(&["じゃあびす"]));

        assert!(prompt.contains("ジャービス"));
        assert!(prompt.contains("じゃあびす"));
    }

    #[test]
    fn keywords_include_enrolled_readings_once() {
        let keywords = keyword_line(&settings_with_wake(&["じゃあびす", "ジャービス"]));

        assert!(keywords.starts_with("ジャービス="));
        assert!(keywords.contains("じゃあびす"));
        assert_eq!(keywords.matches("ジャービス=").count(), 1);
    }

    #[test]
    fn keywords_drop_separators_from_samples() {
        let keywords = keyword_line(&settings_with_wake(&["じゃ,あ=びす"]));

        assert!(keywords.contains("じゃあびす"));
        assert_eq!(keywords.matches('=').count(), 1);
    }

    #[test]
    fn wav_payload_is_extracted_with_its_rate() {
        let wav = wav_bytes(&[1, 2, 3, 4], 16_000);
        let (pcm, rate) = wav_pcm(&wav).unwrap();

        assert_eq!(pcm, vec![1, 2, 3, 4]);
        assert_eq!(rate, 16_000);
    }

    #[test]
    fn non_wav_input_is_rejected() {
        assert!(wav_pcm(b"not a wav file").is_err());
    }

    #[test]
    fn repeated_syllable_is_treated_as_garbage() {
        assert!(is_degenerate_transcript(
            "ババババババババババババババババイト"
        ));
        assert!(!is_degenerate_transcript("こんにちは、ジャービスです"));
        assert!(!is_degenerate_transcript("はい"));
    }

    #[test]
    fn cached_model_lookup_walks_nested_folders() {
        let root = std::env::temp_dir().join(format!(
            "jarvis-model-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let nested = root.join("sakasegawa--Haas-ja-v1.0-GGUF").join("sha");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("Haas-616M-ja-v1.0-Q8_0.gguf"), b"GGUF").unwrap();

        assert!(find_cached_model(&root, "haas", 0));
        assert!(!find_cached_model(&root, "qwen", 0));

        let _ = std::fs::remove_dir_all(&root);
    }
}
