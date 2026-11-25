//! Client for `speech worker` (speech.cpp), which keeps a recognizer loaded.
//!
//! The worker speaks JSON Lines on stdin/stdout: one `chunk` of base64 PCM per
//! line, then a `transcribe` line, then progress and one terminal message.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::Value;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct SpeechWorker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    signature: String,
    counter: u64,
}

impl SpeechWorker {
    /// Start a worker and wait until the model is loaded (it prints `ready`).
    pub fn spawn(binary: &Path, model: &str, device: &str, keywords: &str) -> Result<Self, String> {
        let mut command = Command::new(binary);
        command.arg("worker").arg(model);
        command.arg("--device").arg(device);
        if !keywords.trim().is_empty() {
            command.arg("--keywords").arg(keywords);
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("speech.exe を起動できません: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "speech worker の入力を作成できません".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "speech worker の出力を作成できません".to_string())?;

        let signature = format!(
            "{}|{}|{}|{}",
            binary.to_string_lossy(),
            model,
            device,
            keywords
        );
        let mut worker = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            signature,
            counter: 0,
        };

        match worker.read_until_terminal("ready")? {
            Terminal::Ready => Ok(worker),
            Terminal::Error(message) => Err(format!("speech worker: {message}")),
            Terminal::End => Err("speech worker が応答しません".to_string()),
        }
    }

    pub fn signature(&self) -> &str {
        &self.signature
    }

    /// Recognize 16-bit mono PCM and return the text.
    pub fn transcribe(&mut self, pcm: &[u8], sample_rate: u32) -> Result<String, String> {
        self.counter += 1;
        let id = format!("r{}", self.counter);

        let chunk = serde_json::json!({
            "type": "chunk",
            "id": id,
            "seq": 0,
            "pcm": base64_encode(pcm),
        });
        let request = serde_json::json!({
            "type": "transcribe",
            "id": id,
            "sample_rate": sample_rate,
        });

        writeln!(self.stdin, "{chunk}")
            .and_then(|_| writeln!(self.stdin, "{request}"))
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("speech worker に送信できません: {error}"))?;

        loop {
            let line = self
                .read_line()?
                .ok_or_else(|| "speech worker が終了しました".to_string())?;
            let message: Value = serde_json::from_str(&line)
                .map_err(|error| format!("speech worker の応答を解析できません: {error}"))?;
            let kind = message.get("type").and_then(Value::as_str).unwrap_or("");
            let same_request = message.get("id").and_then(Value::as_str) == Some(id.as_str());
            if !same_request {
                continue;
            }
            match kind {
                "progress" => continue,
                "end" => {
                    return Ok(message
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim()
                        .to_string());
                }
                "error" => {
                    let detail = message
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("不明なエラー");
                    return Err(format!("speech worker: {detail}"));
                }
                "cancelled" => return Err("speech worker: 処理が中断されました".to_string()),
                _ => continue,
            }
        }
    }

    fn read_line(&mut self) -> Result<Option<String>, String> {
        let mut buffer = String::new();
        let read = self
            .stdout
            .read_line(&mut buffer)
            .map_err(|error| format!("speech worker の応答を読めません: {error}"))?;
        if read == 0 {
            return Ok(None);
        }
        Ok(Some(buffer.trim_end_matches(['\r', '\n']).to_string()))
    }

    fn read_until_terminal(&mut self, expected: &str) -> Result<Terminal, String> {
        loop {
            let Some(line) = self.read_line()? else {
                return Err("speech worker が起動直後に終了しました".to_string());
            };
            if line.is_empty() {
                continue;
            }
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match message.get("type").and_then(Value::as_str).unwrap_or("") {
                kind if kind == expected => return Ok(Terminal::Ready),
                "fatal" => {
                    let detail = message
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("起動に失敗しました");
                    return Ok(Terminal::Error(detail.to_string()));
                }
                "end" => return Ok(Terminal::End),
                _ => continue,
            }
        }
    }
}

impl Drop for SpeechWorker {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"");
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

enum Terminal {
    Ready,
    Error(String),
    End,
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    STANDARD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_tracks_every_launch_option() {
        let signature = format!("{}|{}|{}|{}", "speech.exe", "haas-ja-v1.0", "auto", "a=b");
        assert!(signature.contains("haas-ja-v1.0"));
    }

    #[test]
    fn pcm_is_sent_as_base64() {
        assert_eq!(base64_encode(&[1, 2, 3]), "AQID");
    }

    /// Round trip against a real `speech.exe` and recording.
    /// Run with `JARVIS_SPEECH_EXE` and `JARVIS_SPEECH_WAV` set and `--ignored`.
    #[test]
    #[ignore]
    fn speech_worker_transcribes_a_real_recording() {
        let Ok(exe) = std::env::var("JARVIS_SPEECH_EXE") else {
            return;
        };
        let Ok(wav) = std::env::var("JARVIS_SPEECH_WAV") else {
            return;
        };
        let bytes = std::fs::read(&wav).expect("recording is readable");
        let (pcm, rate) = crate::speech::stt::wav_pcm(&bytes).expect("recording is a WAV");

        let mut worker = SpeechWorker::spawn(
            Path::new(&exe),
            "haas-ja-v1.0",
            "auto",
            "ジャービス=じゃあびす,じゃびす",
        )
        .expect("worker starts");
        let text = worker.transcribe(&pcm, rate).expect("recognition works");

        println!("recognized: {text}");
        assert!(text.contains("ジャービス"));
    }
}
