//! Speech-to-text via a whisper.cpp sidecar binary.

use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Manager};

use crate::models::Settings;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn is_file(path: &PathBuf) -> bool {
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
    if let Ok(dir) = app.path().resource_dir() {
        dirs.push(dir.join("binaries"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.join("binaries"));
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

pub fn resolve_binary(app: &AppHandle, settings: &Settings) -> Option<PathBuf> {
    if let Some(path) = from_settings(&settings.stt.whisper_path) {
        return Some(path);
    }
    let names = ["whisper-cli.exe", "whisper-cli", "main.exe"];
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

fn wake_prompt(settings: &Settings) -> String {
    let mut phrases = vec![
        "JARVIS".to_string(),
        "ジャービス".to_string(),
        "ジャーヴィス".to_string(),
        "ジャビス".to_string(),
        "じゃあびす".to_string(),
    ];
    phrases.extend(settings.stt.wake_samples.iter().cloned());
    phrases.join(", ")
}

pub fn availability(app: &AppHandle, settings: &Settings) -> (bool, String) {
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

pub fn transcribe(app: &AppHandle, settings: &Settings, wav: &[u8]) -> Result<String, String> {
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
        .arg(&settings.stt.language)
        .arg("--prompt")
        .arg(wake_prompt(settings))
        .arg("-nt")
        .arg("-otxt")
        .arg("-of")
        .arg(&out_base);

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_includes_standard_and_enrolled_wake_phrases() {
        let settings = Settings {
            stt: crate::models::SttSettings {
                wake_samples: vec!["じゃあびす".into()],
                ..crate::models::SttSettings::default()
            },
            ..Settings::default()
        };
        let prompt = wake_prompt(&settings);

        assert!(prompt.contains("ジャービス"));
        assert!(prompt.contains("じゃあびす"));
    }
}
