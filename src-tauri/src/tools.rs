//! Built-in tools for function calling plus a minimal MCP stdio client.

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command as TokioCommand};

use crate::db;
use crate::events::{self, TimerFired, ToolApprovalRequest};
use crate::models::{McpServer, Settings};
use crate::state::AppState;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn function(name: &str, description: &str, parameters: Value) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        }
    })
}

pub async fn definitions(settings: &Settings) -> Vec<Value> {
    if !settings.tools.enabled {
        return Vec::new();
    }

    let mut tools = vec![function(
        "get_current_time",
        "現在のローカル日時を取得します。",
        json!({ "type": "object", "properties": {} }),
    )];

    if settings.tools.web_search {
        tools.push(function(
            "search_web",
            "DuckDuckGo でWeb検索し、上位の結果タイトルとURLを返します。",
            json!({
                "type": "object",
                "properties": { "query": { "type": "string", "description": "検索語" } },
                "required": ["query"],
            }),
        ));
    }
    if settings.tools.clipboard {
        tools.push(function(
            "read_clipboard",
            "クリップボードのテキストを読み取ります。",
            json!({ "type": "object", "properties": {} }),
        ));
        tools.push(function(
            "write_clipboard",
            "クリップボードにテキストを書き込みます。",
            json!({
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"],
            }),
        ));
    }
    if settings.tools.shell {
        tools.push(function(
            "open_url",
            "既定のブラウザでURLを開きます。",
            json!({
                "type": "object",
                "properties": { "url": { "type": "string" } },
                "required": ["url"],
            }),
        ));
        tools.push(function(
            "launch_app",
            "アプリやファイルを起動します（例: notepad, C:\\\\path\\\\file.txt）。",
            json!({
                "type": "object",
                "properties": { "target": { "type": "string" } },
                "required": ["target"],
            }),
        ));
    }
    if settings.tools.files {
        tools.push(function(
            "read_file",
            "テキストファイルを読み取ります（先頭20000文字）。",
            json!({
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"],
            }),
        ));
        tools.push(function(
            "write_file",
            "テキストファイルに書き込みます。",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" },
                },
                "required": ["path", "content"],
            }),
        ));
    }
    if settings.tools.screenshot {
        tools.push(function(
            "capture_screen",
            "プライマリ画面のスクリーンショットをPNGで保存し、パスを返します。",
            json!({ "type": "object", "properties": {} }),
        ));
    }
    if settings.tools.timers {
        tools.push(function(
            "set_timer",
            "指定した分数後にデスクトップ通知で知らせるタイマーを設定します。",
            json!({
                "type": "object",
                "properties": {
                    "minutes": { "type": "number", "description": "分数（0.1以上）" },
                    "label": { "type": "string", "description": "タイマーの名前" },
                },
                "required": ["minutes"],
            }),
        ));
    }
    if settings.memory.enabled {
        tools.push(function(
            "save_memory",
            "ユーザーについて覚えておくべき事実を長期記憶に保存します。",
            json!({
                "type": "object",
                "properties": { "content": { "type": "string" } },
                "required": ["content"],
            }),
        ));
    }

    for server in settings
        .tools
        .mcp_servers
        .iter()
        .filter(|server| server.enabled)
    {
        match mcp_list(server).await {
            Ok(items) => {
                for item in items {
                    let Some(name) = item.get("name").and_then(Value::as_str) else {
                        continue;
                    };
                    let description = item
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or("MCP tool");
                    let schema = item
                        .get("inputSchema")
                        .cloned()
                        .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
                    tools.push(function(
                        &format!("mcp__{}__{}", server.name, name),
                        description,
                        schema,
                    ));
                }
            }
            Err(error) => {
                crate::log_message("WARN", "mcp", &format!("{}: {error}", server.name))
            }
        }
    }

    tools
}

pub async fn execute(
    app: &AppHandle,
    settings: &Settings,
    name: &str,
    args: &Value,
) -> Result<String, String> {
    if let Some(rest) = name.strip_prefix("mcp__") {
        let mut parts = rest.splitn(2, "__");
        let server_name = parts.next().unwrap_or_default();
        let tool_name = parts
            .next()
            .ok_or_else(|| "MCPツール名が不正です".to_string())?;
        let server = settings
            .tools
            .mcp_servers
            .iter()
            .find(|server| server.name == server_name && server.enabled)
            .ok_or_else(|| format!("MCPサーバー {server_name} が見つかりません"))?;
        return mcp_call(server, tool_name, args).await;
    }

    match name {
        "get_current_time" => powershell("Get-Date -Format 'yyyy-MM-dd HH:mm:ss dddd'"),
        "search_web" => {
            if !settings.tools.web_search {
                return Err("Web検索は無効です".into());
            }
            let query = args
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            if query.is_empty() {
                return Err("query が空です".into());
            }
            search_web(query).await
        }
        "read_clipboard" => {
            if !settings.tools.clipboard {
                return Err("クリップボード操作は無効です".into());
            }
            powershell("Get-Clipboard -Raw").map(|text| {
                if text.is_empty() {
                    "（クリップボードは空です）".to_string()
                } else {
                    text.chars().take(8000).collect()
                }
            })
        }
        "write_clipboard" => {
            if !settings.tools.clipboard {
                return Err("クリップボード操作は無効です".into());
            }
            let text = args.get("text").and_then(Value::as_str).unwrap_or("");
            let encoded = STANDARD.encode(text.as_bytes());
            powershell(&format!(
                "Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded}')))"
            ))?;
            Ok("クリップボードに書き込みました".into())
        }
        "open_url" => {
            if !settings.tools.shell {
                return Err("アプリ起動は無効です".into());
            }
            let url = args
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            if !(url.starts_with("http://") || url.starts_with("https://")) {
                return Err("http(s) のURLのみ開けます".into());
            }
            if !confirm(app, settings, "open_url", url).await {
                return Err("ユーザーが実行を拒否しました".into());
            }
            open_target(url)?;
            Ok(format!("{url} を開きました"))
        }
        "launch_app" => {
            if !settings.tools.shell {
                return Err("アプリ起動は無効です".into());
            }
            let target = args
                .get("target")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            if target.is_empty() {
                return Err("target が空です".into());
            }
            let resolved = resolve_app_alias(target);
            let launch = resolved.as_deref().unwrap_or(target);
            if !confirm(app, settings, "launch_app", launch).await {
                return Err("ユーザーが実行を拒否しました".into());
            }
            open_target(launch)?;
            Ok(format!("{target} を起動しました"))
        }
        "read_file" => {
            if !settings.tools.files {
                return Err("ファイル操作は無効です".into());
            }
            let path = args.get("path").and_then(Value::as_str).unwrap_or("");
            if !confirm(app, settings, "read_file", path).await {
                return Err("ユーザーが実行を拒否しました".into());
            }
            let text = std::fs::read_to_string(path)
                .map_err(|error| format!("読み取れません: {error}"))?;
            Ok(text.chars().take(20_000).collect())
        }
        "write_file" => {
            if !settings.tools.files {
                return Err("ファイル操作は無効です".into());
            }
            let path = args.get("path").and_then(Value::as_str).unwrap_or("");
            let content = args.get("content").and_then(Value::as_str).unwrap_or("");
            if path.is_empty() {
                return Err("path が空です".into());
            }
            if !confirm(app, settings, "write_file", path).await {
                return Err("ユーザーが実行を拒否しました".into());
            }
            if let Some(parent) = std::path::Path::new(path).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::write(path, content).map_err(|error| format!("書き込めません: {error}"))?;
            Ok(format!("{path} に書き込みました"))
        }
        "capture_screen" => {
            if !settings.tools.screenshot {
                return Err("スクリーンショットは無効です".into());
            }
            capture_screen(app)
        }
        "set_timer" => {
            if !settings.tools.timers {
                return Err("タイマーは無効です".into());
            }
            let minutes = args
                .get("minutes")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            if minutes <= 0.0 || minutes > 1440.0 {
                return Err("minutes は 0.1〜1440 の範囲で指定してください".into());
            }
            let label = args
                .get("label")
                .and_then(Value::as_str)
                .unwrap_or("タイマー")
                .chars()
                .take(40)
                .collect::<String>();
            let seconds = (minutes * 60.0).round() as u64;
            let handle = app.clone();
            let label_copy = label.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(seconds)).await;
                notify("J.A.R.V.I.S. タイマー", &format!("{label_copy} の時間です"));
                events::emit(
                    &handle,
                    events::TIMER_FIRED,
                    TimerFired {
                        label: label_copy,
                        seconds,
                    },
                );
            });
            Ok(format!("{label} を {minutes} 分後に設定しました"))
        }
        "save_memory" => {
            if !settings.memory.enabled {
                return Err("長期記憶は無効です".into());
            }
            let content = args.get("content").and_then(Value::as_str).unwrap_or("");
            let state = app.state::<AppState>();
            let conn = state
                .db
                .lock()
                .map_err(|_| "データベースのロックに失敗".to_string())?;
            let memory = db::add_memory(&conn, content, "fact")?;
            drop(conn);
            events::emit(app, events::MEMORY_UPDATED, json!({ "id": memory.id }));
            Ok(format!("記憶しました: {}", memory.content))
        }
        other => Err(format!("未知のツールです: {other}")),
    }
}

async fn confirm(app: &AppHandle, settings: &Settings, tool: &str, summary: &str) -> bool {
    if !settings.tools.approval {
        return true;
    }
    let state = app.state::<AppState>();
    let id = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    if let Ok(mut pending) = state.approvals.lock() {
        pending.insert(id.clone(), sender);
    }

    // Make sure the dialog is visible even if the window was hidden.
    crate::commands::app::show_main(app);
    events::emit(
        app,
        events::TOOL_APPROVAL,
        ToolApprovalRequest {
            id: id.clone(),
            tool: tool.to_string(),
            summary: summary.to_string(),
        },
    );

    let approved = match tokio::time::timeout(Duration::from_secs(120), receiver).await {
        Ok(Ok(value)) => value,
        _ => false,
    };

    if let Ok(mut pending) = state.approvals.lock() {
        pending.remove(&id);
    }
    approved
}

pub fn resolve_approval(app: &AppHandle, id: &str, approved: bool) -> bool {
    let state = app.state::<AppState>();
    if let Ok(mut pending) = state.approvals.lock() {
        if let Some(sender) = pending.remove(id) {
            let _ = sender.send(approved);
            return true;
        }
    }
    false
}

pub fn notify(title: &str, body: &str) {
    let title = STANDARD.encode(title.as_bytes());
    let body = STANDARD.encode(body.as_bytes());
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         Add-Type -AssemblyName System.Drawing; \
         $n = New-Object System.Windows.Forms.NotifyIcon; \
         $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; \
         $n.ShowBalloonTip(6000, \
           [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{title}')), \
           [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{body}')), \
           [System.Windows.Forms.ToolTipIcon]::Info); \
         Start-Sleep -Milliseconds 6500; $n.Dispose()"
    );
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &script,
    ]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    if let Err(error) = command.spawn() {
        crate::log_message("ERROR", "notify", &format!("{error}"));
    }
}

fn powershell(script: &str) -> Result<String, String> {
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|error| format!("PowerShell を起動できません: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail: String = stderr.chars().take(400).collect();
        return Err(format!("コマンドが失敗しました: {detail}"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn open_target(target: &str) -> Result<(), String> {
    let mut command = Command::new("cmd.exe");
    command.args(["/C", "start", "", target]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let status = command
        .status()
        .map_err(|error| format!("起動できません: {error}"))?;
    if !status.success() {
        return Err(format!("「{target}」を起動できませんでした"));
    }
    Ok(())
}

/// Map common app names (including whisper misrecognitions) to something
/// `start` can launch. Only bare names are resolved, never paths or URLs.
fn resolve_app_alias(target: &str) -> Option<String> {
    let trimmed = target.trim();
    if trimmed.is_empty()
        || trimmed.contains('\\')
        || trimmed.contains('/')
        || trimmed.contains(':')
    {
        return None;
    }

    let lowered = trimmed.to_lowercase();
    let name = lowered
        .trim_end_matches(".exe")
        .trim_end_matches("を開いて")
        .trim_end_matches("を起動")
        .trim();

    const ALIASES: &[(&[&str], &str)] = &[
        (
            &[
                "電卓",
                "でんたく",
                "でんたこ",
                "全卓",
                "電宅",
                "電タフ",
                "ペンタコ",
                "計算機",
                "けいさんき",
                "伝託",
                "伝達",
            ],
            "calc",
        ),
        (&["メモ帳", "めもちょう", "notepad"], "notepad"),
        (&["ペイント", "paint", "mspaint"], "mspaint"),
        (&["エクスプローラー", "explorer"], "explorer"),
        (&["タスクマネージャー", "taskmgr"], "taskmgr"),
        (&["コマンドプロンプト", "cmd"], "cmd"),
        (&["設定", "せってい"], "ms-settings:"),
    ];

    ALIASES.iter().find_map(|(names, command)| {
        names
            .iter()
            .any(|alias| name == *alias)
            .then(|| (*command).to_string())
    })
}

/// Capture the primary screen, downscaled to at most 1600px wide.
fn capture_script(path: &str) -> String {
    let escaped = path.replace('\'', "''");
    format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         Add-Type -AssemblyName System.Drawing; \
         $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; \
         $full = New-Object System.Drawing.Bitmap $b.Width, $b.Height; \
         $fg = [System.Drawing.Graphics]::FromImage($full); \
         $fg.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size); \
         $scale = [Math]::Min(1.0, 1600.0 / $b.Width); \
         $w = [int]($b.Width * $scale); $h = [int]($b.Height * $scale); \
         $bmp = New-Object System.Drawing.Bitmap $w, $h; \
         $g = [System.Drawing.Graphics]::FromImage($bmp); \
         $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; \
         $g.DrawImage($full, 0, 0, $w, $h); \
         $bmp.Save('{escaped}', [System.Drawing.Imaging.ImageFormat]::Png); \
         $g.Dispose(); $bmp.Dispose(); $fg.Dispose(); $full.Dispose()"
    )
}

fn capture_screen(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<AppState>();
    let dir = state.data_dir.join("screenshots");
    std::fs::create_dir_all(&dir).map_err(|error| format!("フォルダを作成できません: {error}"))?;
    let path = dir.join(format!("screen-{}.png", db::now_ms()));
    powershell(&capture_script(&path.to_string_lossy()))?;
    Ok(format!("画面を保存しました: {}", path.to_string_lossy()))
}

pub fn screenshot_base64(app: &AppHandle) -> Result<(String, String), String> {
    let state = app.state::<AppState>();
    let dir = state.data_dir.join("screenshots");
    std::fs::create_dir_all(&dir).map_err(|error| format!("フォルダを作成できません: {error}"))?;
    let path = dir.join(format!("screen-{}.png", db::now_ms()));
    powershell(&capture_script(&path.to_string_lossy()))?;
    let bytes = std::fs::read(&path).map_err(|error| format!("画像を読めません: {error}"))?;
    Ok((STANDARD.encode(bytes), path.to_string_lossy().to_string()))
}

pub fn clipboard_text() -> Result<String, String> {
    powershell("Get-Clipboard -Raw")
}

async fn search_web(query: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) JARVIS/2.0")
        .build()
        .map_err(|error| error.to_string())?;

    let encoded = url_encode(query);
    let url = format!("https://html.duckduckgo.com/html/?q={encoded}");
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("検索できません: {error}"))?;
    let html = response.text().await.map_err(|error| error.to_string())?;
    let results = extract_results(&html, 6);
    if results.is_empty() {
        return Ok("検索結果を取得できませんでした（ネットワーク制限の可能性）".into());
    }
    Ok(results.join("\n"))
}

fn url_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn strip_tags(value: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for character in value.chars() {
        match character {
            '<' => inside = true,
            '>' => inside = false,
            _ if !inside => out.push(character),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .trim()
        .to_string()
}

fn resolve_ddg_href(href: &str) -> String {
    if let Some(index) = href.find("uddg=") {
        let rest = &href[index + 5..];
        let end = rest.find('&').unwrap_or(rest.len());
        return percent_decode(&rest[..end]);
    }
    href.to_string()
}

fn extract_results(html: &str, limit: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = html;
    while out.len() < limit {
        let Some(index) = rest.find("class=\"result__a\"") else {
            break;
        };
        rest = &rest[index..];
        let Some(href_index) = rest.find("href=\"") else {
            break;
        };
        let after_href = &rest[href_index + 6..];
        let Some(href_end) = after_href.find('"') else {
            break;
        };
        let href = resolve_ddg_href(&after_href[..href_end]);
        let Some(gt) = rest.find('>') else {
            break;
        };
        let tail = &rest[gt + 1..];
        let Some(close) = tail.find("</a>") else {
            break;
        };
        let title = strip_tags(&tail[..close]);
        if !title.is_empty() {
            out.push(format!("- {title}\n  {href}"));
        }
        rest = &tail[close + 4..];
    }
    out
}

/* ---------------- MCP (stdio JSON-RPC) ---------------- */

struct McpConn {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl McpConn {
    async fn start(server: &McpServer) -> Result<Self, String> {
        let mut child = TokioCommand::new(&server.command)
            .args(&server.args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|error| format!("起動できません: {error}"))?;
        let stdin = child.stdin.take().ok_or("stdin がありません")?;
        let stdout = child.stdout.take().ok_or("stdout がありません")?;
        Ok(Self {
            _child: child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 1,
        })
    }

    async fn send(&mut self, message: Value) -> Result<u64, String> {
        let id = self.next_id;
        self.next_id += 1;
        let mut payload = message;
        payload["jsonrpc"] = json!("2.0");
        payload["id"] = json!(id);
        let mut line = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|error| format!("送信できません: {error}"))?;
        self.stdin
            .flush()
            .await
            .map_err(|error| format!("送信できません: {error}"))?;
        Ok(id)
    }

    async fn read_response(&mut self, id: u64) -> Result<Value, String> {
        loop {
            let mut line = String::new();
            let read = tokio::time::timeout(Duration::from_secs(12), self.stdout.read_line(&mut line))
                .await
                .map_err(|_| "MCP応答がタイムアウトしました".to_string())?
                .map_err(|error| format!("受信できません: {error}"))?;
            if read == 0 {
                return Err("MCPサーバーが終了しました".into());
            }
            let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
                continue;
            };
            if value.get("id").and_then(Value::as_u64) == Some(id) {
                if let Some(error) = value.get("error") {
                    let detail: String = error.to_string().chars().take(300).collect();
                    return Err(format!("MCPエラー: {detail}"));
                }
                return Ok(value.get("result").cloned().unwrap_or(Value::Null));
            }
        }
    }

    async fn initialize(&mut self) -> Result<(), String> {
        let id = self
            .send(json!({
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": { "name": "JARVIS", "version": env!("CARGO_PKG_VERSION") }
                }
            }))
            .await?;
        self.read_response(id).await?;
        let mut note = serde_json::to_string(&json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }))
        .map_err(|error| error.to_string())?;
        note.push('\n');
        self.stdin
            .write_all(note.as_bytes())
            .await
            .map_err(|error| error.to_string())?;
        self.stdin.flush().await.map_err(|error| error.to_string())
    }

    async fn list_tools(&mut self) -> Result<Vec<Value>, String> {
        self.initialize().await?;
        let id = self
            .send(json!({ "method": "tools/list", "params": {} }))
            .await?;
        let result = self.read_response(id).await?;
        Ok(result
            .get("tools")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default())
    }

    async fn call(&mut self, name: &str, args: &Value) -> Result<String, String> {
        self.initialize().await?;
        let id = self
            .send(json!({
                "method": "tools/call",
                "params": { "name": name, "arguments": args }
            }))
            .await?;
        let result = self.read_response(id).await?;
        if let Some(items) = result.get("content").and_then(Value::as_array) {
            let text = items
                .iter()
                .filter_map(|item| item.get("text").and_then(Value::as_str).map(str::to_string))
                .collect::<Vec<_>>()
                .join("\n");
            if !text.is_empty() {
                return Ok(text);
            }
        }
        Ok(result.to_string().chars().take(4000).collect())
    }
}

async fn mcp_list(server: &McpServer) -> Result<Vec<Value>, String> {
    let mut conn = McpConn::start(server).await?;
    conn.list_tools().await
}

async fn mcp_call(server: &McpServer, tool: &str, args: &Value) -> Result<String, String> {
    let mut conn = McpConn::start(server).await?;
    conn.call(tool, args).await
}
