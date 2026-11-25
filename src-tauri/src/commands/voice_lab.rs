//! "Voice lab": save recordings with reference text and compare ASR settings.

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

use crate::models::Settings;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceTestResult {
    pub engine: String,
    pub model: String,
    pub text: String,
    pub cer: f64,
    pub elapsed_ms: u64,
    pub created_at: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceTest {
    pub id: String,
    pub name: String,
    pub reference: String,
    pub created_at: i64,
    pub duration_ms: u32,
    pub sample_rate: u32,
    pub results: Vec<VoiceTestResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelInfo {
    pub path: String,
    pub name: String,
    pub size_mb: u64,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn tests_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("voice-tests")
}

fn paths_for(state: &AppState, id: &str) -> (PathBuf, PathBuf) {
    let dir = tests_dir(state);
    (dir.join(format!("{id}.wav")), dir.join(format!("{id}.json")))
}

fn load_test(state: &AppState, id: &str) -> Result<VoiceTest, String> {
    let (_, json) = paths_for(state, id);
    let bytes = std::fs::read(&json).map_err(|error| format!("テストが見つかりません: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("テストを読めません: {error}"))
}

fn save_test(state: &AppState, test: &VoiceTest) -> Result<(), String> {
    let (_, json) = paths_for(state, &test.id);
    let bytes = serde_json::to_vec_pretty(test).map_err(|error| error.to_string())?;
    std::fs::write(json, bytes).map_err(|error| format!("テストを保存できません: {error}"))
}

#[tauri::command]
pub fn save_voice_test(
    state: State<'_, AppState>,
    name: String,
    reference: String,
    audio_base64: String,
) -> Result<VoiceTest, String> {
    let bytes = STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|error| format!("音声データを復号できません: {error}"))?;
    let (pcm, sample_rate) = crate::speech::stt::wav_pcm(&bytes)?;
    if pcm.is_empty() {
        return Err("録音が空です".into());
    }

    let dir = tests_dir(&state);
    std::fs::create_dir_all(&dir).map_err(|error| format!("フォルダを作成できません: {error}"))?;

    let id = uuid::Uuid::new_v4().simple().to_string();
    let duration_ms = (pcm.len() as u64 * 1000 / 2 / sample_rate.max(1) as u64) as u32;
    let test = VoiceTest {
        id: id.clone(),
        name: if name.trim().is_empty() {
            format!("テスト {}", duration_ms)
        } else {
            name.trim().chars().take(60).collect()
        },
        reference: reference.trim().to_string(),
        created_at: now_ms(),
        duration_ms,
        sample_rate,
        results: Vec::new(),
    };

    let (wav_path, _) = paths_for(&state, &id);
    std::fs::write(wav_path, &bytes).map_err(|error| format!("音声を保存できません: {error}"))?;
    save_test(&state, &test)?;
    Ok(test)
}

#[tauri::command]
pub fn list_voice_tests(state: State<'_, AppState>) -> Result<Vec<VoiceTest>, String> {
    let dir = tests_dir(&state);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut tests = Vec::new();
    for entry in entries.flatten() {
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        if let Ok(bytes) = std::fs::read(entry.path()) {
            if let Ok(test) = serde_json::from_slice::<VoiceTest>(&bytes) {
                tests.push(test);
            }
        }
    }
    tests.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(tests)
}

#[tauri::command]
pub fn read_voice_test_audio(
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let (wav_path, _) = paths_for(&state, &id);
    let bytes = std::fs::read(wav_path).map_err(|error| format!("音声を読めません: {error}"))?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
pub fn delete_voice_test(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let (wav, json) = paths_for(&state, &id);
    let _ = std::fs::remove_file(wav);
    let _ = std::fs::remove_file(json);
    Ok(())
}

fn normalize_chars(text: &str) -> Vec<char> {
    text.chars()
        .filter(|character| {
            character.is_alphanumeric()
                || (0x3040..=0x30FF).contains(&(*character as u32))
                || (0x4E00..=0x9FFF).contains(&(*character as u32))
        })
        .flat_map(|character| character.to_lowercase())
        .collect()
}

fn levenshtein(a: &[char], b: &[char]) -> usize {
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    let mut current = vec![0usize; b.len() + 1];
    for (i, left) in a.iter().enumerate() {
        current[0] = i + 1;
        for (j, right) in b.iter().enumerate() {
            let cost = if left == right { 0 } else { 1 };
            current[j + 1] = (previous[j + 1] + 1)
                .min(current[j] + 1)
                .min(previous[j] + cost);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[b.len()]
}

pub fn character_error_rate(reference: &str, hypothesis: &str) -> f64 {
    let reference = normalize_chars(reference);
    let hypothesis = normalize_chars(hypothesis);
    if reference.is_empty() {
        return if hypothesis.is_empty() { 0.0 } else { 1.0 };
    }
    levenshtein(&reference, &hypothesis) as f64 / reference.len() as f64
}

fn model_label(settings: &Settings, engine: &str) -> String {
    if engine == "whisper" {
        let path = Path::new(&settings.stt.model_path);
        path.file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "whisper".to_string())
    } else {
        let model = settings.stt.speech_model.trim();
        if model.is_empty() {
            "haas-ja-v1.0".to_string()
        } else {
            model.rsplit(['\\', '/'])
                .next()
                .unwrap_or(model)
                .to_string()
        }
    }
}

#[tauri::command]
pub async fn run_voice_test(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    engine: Option<String>,
    model_path: Option<String>,
) -> Result<VoiceTestResult, String> {
    let mut test = load_test(&state, &id)?;
    let (wav_path, _) = paths_for(&state, &id);
    let wav = std::fs::read(wav_path).map_err(|error| format!("音声を読めません: {error}"))?;

    let mut settings = crate::commands::read_settings(&state);
    let requested = engine
        .map(|value| if value == "whisper" { "whisper" } else { "speech" })
        .unwrap_or(settings.stt.engine.as_str())
        .to_string();
    settings.stt.engine = requested.clone();
    if let Some(path) = model_path {
        if !path.trim().is_empty() {
            settings.stt.model_path = path;
        }
    }
    let settings = settings.sanitized();
    let label = model_label(&settings, &requested);

    let handle = app.clone();
    let worker_settings = settings.clone();
    let started = Instant::now();
    let outcome = tokio::task::spawn_blocking(move || {
        crate::speech::stt::transcribe(&handle, &worker_settings, &wav)
    })
    .await
    .map_err(|error| format!("認識タスクが失敗しました: {error}"))?;
    let elapsed_ms = started.elapsed().as_millis() as u64;

    let (text, error) = match outcome {
        Ok(text) => (text, None),
        Err(error) => (String::new(), Some(error)),
    };
    let cer = if error.is_none() {
        character_error_rate(&test.reference, &text)
    } else {
        1.0
    };

    let result = VoiceTestResult {
        engine: requested,
        model: label,
        text,
        cer,
        elapsed_ms,
        created_at: now_ms(),
        error,
    };
    test.results.push(result.clone());
    if test.results.len() > 40 {
        let excess = test.results.len() - 40;
        test.results.drain(0..excess);
    }
    save_test(&state, &test)?;
    Ok(result)
}

#[tauri::command]
pub fn list_whisper_models(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<WhisperModelInfo>, String> {
    let settings = crate::commands::read_settings(&state);
    let mut roots: Vec<PathBuf> = vec![state.data_dir.join("models")];

    if !settings.stt.model_path.trim().is_empty() {
        if let Some(parent) = Path::new(&settings.stt.model_path).parent() {
            roots.push(parent.to_path_buf());
        }
    }
    if let Some(binary) = crate::speech::stt::resolve_binary(&app, &settings) {
        if let Some(parent) = binary.parent() {
            roots.push(parent.to_path_buf());
            roots.push(parent.join("models"));
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("whisper"));
    }
    if let Some(home) = std::env::var_os("USERPROFILE") {
        roots.push(PathBuf::from(home).join(".cache").join("whisper"));
    }

    let mut seen: Vec<String> = Vec::new();
    let mut models = Vec::new();
    for root in roots {
        collect_models(&root, 0, &mut seen, &mut models);
    }
    models.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(models)
}

fn collect_models(
    dir: &Path,
    depth: usize,
    seen: &mut Vec<String>,
    models: &mut Vec<WhisperModelInfo>,
) {
    if depth > 2 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_models(&path, depth + 1, seen, models);
            continue;
        }
        let Some(name) = path.file_name().map(|value| value.to_string_lossy().to_string()) else {
            continue;
        };
        let lower = name.to_lowercase();
        if !lower.ends_with(".bin") || !(lower.contains("ggml") || lower.contains("whisper")) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.len() < 1_000_000 {
            continue;
        }
        let key = path.to_string_lossy().to_lowercase();
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        models.push(WhisperModelInfo {
            path: path.to_string_lossy().to_string(),
            name,
            size_mb: metadata.len() / 1_048_576,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cer_matches_identical_text() {
        assert_eq!(character_error_rate("今日の天気", "今日の天気"), 0.0);
    }

    #[test]
    fn cer_counts_character_errors() {
        let cer = character_error_rate("今日の天気", "今日の天気を");
        assert!(cer > 0.0);
        assert!(cer < 0.5);
    }

    #[test]
    fn cer_ignores_punctuation_and_spaces() {
        assert_eq!(
            character_error_rate("今日の天気を教えて", "今日の天気を、教えて。"),
            0.0
        );
    }
}
