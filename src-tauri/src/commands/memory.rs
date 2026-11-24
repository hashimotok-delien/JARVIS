//! Long-term memory, thread summaries and daily digests.

use rusqlite::Connection;
use tauri::{AppHandle, Manager, State};

use crate::db;
use crate::models::{Memory, Settings};
use crate::state::AppState;

const SUMMARY_SYSTEM: &str =
    "あなたは会話ログを圧縮する要約器です。日本語で、固有名詞・決定事項・未解決の課題を落とさずに簡潔にまとめます。";

const EXTRACT_SYSTEM: &str = "あなたは長期記憶の抽出器です。会話からユーザーに関する永続的に有用な事実（好み・環境・予定・制約）だけを抽出し、1行1項目の「- 」で始まる箇条書きだけを出力します。推測や一般論は出力しません。該当がなければ何も出力しません。";

#[tauri::command]
pub fn list_memories(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<Memory>, String> {
    let conn = crate::commands::lock_db(&state)?;
    db::list_memories(&conn, limit.unwrap_or(200))
}

#[tauri::command]
pub fn add_memory(
    app: AppHandle,
    state: State<'_, AppState>,
    content: String,
    kind: Option<String>,
) -> Result<Memory, String> {
    let memory = {
        let conn = crate::commands::lock_db(&state)?;
        db::add_memory(&conn, &content, kind.as_deref().unwrap_or("fact"))?
    };
    crate::events::emit(&app, crate::events::MEMORY_UPDATED, &memory);
    Ok(memory)
}

#[tauri::command]
pub fn update_memory(
    state: State<'_, AppState>,
    id: String,
    content: String,
    kind: Option<String>,
) -> Result<(), String> {
    let conn = crate::commands::lock_db(&state)?;
    db::update_memory(&conn, &id, &content, kind.as_deref().unwrap_or("fact"))
}

#[tauri::command]
pub fn delete_memory(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = crate::commands::lock_db(&state)?;
    db::delete_memory(&conn, &id)
}

/// Build the memory block injected into the system prompt.
pub fn memory_context(conn: &Connection, settings: &Settings) -> String {
    if !settings.memory.enabled || !settings.memory.inject || settings.memory.max_items == 0 {
        return String::new();
    }
    let Ok(items) = db::list_memories(conn, settings.memory.max_items) else {
        return String::new();
    };
    if items.is_empty() {
        return String::new();
    }
    let mut block = String::from("【長期記憶（ユーザーについて）】\n");
    for item in items {
        block.push_str(&format!("- {}\n", item.content));
    }
    block
}

#[tauri::command]
pub async fn summarize_thread(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<String, String> {
    let (settings, existing, messages) = {
        let conn = crate::commands::lock_db(&state)?;
        let settings = db::load_settings(&conn);
        let thread = db::get_thread(&conn, &thread_id)?
            .ok_or_else(|| "スレッドが見つかりません".to_string())?;
        let messages = db::list_messages(&conn, &thread_id)?;
        (settings, thread.summary.unwrap_or_default(), messages)
    };

    if messages.is_empty() {
        return Err("要約するメッセージがありません".into());
    }

    let mut transcript = String::new();
    if !existing.trim().is_empty() {
        transcript.push_str(&format!("【既存の要約】\n{existing}\n\n"));
    }
    for message in &messages {
        let label = if message.role == "user" { "あなた" } else { "JARVIS" };
        let content: String = message.content.chars().take(600).collect();
        transcript.push_str(&format!("{label}: {content}\n"));
        if transcript.chars().count() > 8000 {
            break;
        }
    }

    let summary = crate::providers::complete::complete(
        &app,
        &settings,
        SUMMARY_SYSTEM,
        &format!("以下の会話を300字程度で要約してください。\n\n{transcript}"),
    )
    .await?;

    let upto = messages.last().map(|message| message.created_at).unwrap_or(0);
    {
        let conn = crate::commands::lock_db(&state)?;
        db::set_thread_summary(&conn, &thread_id, &summary, upto)?;
    }
    Ok(summary)
}

#[tauri::command]
pub async fn daily_digest(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let (settings, transcript) = {
        let conn = crate::commands::lock_db(&state)?;
        let settings = db::load_settings(&conn);
        let since = db::now_ms() - 86_400_000;
        let mut stmt = conn
            .prepare(
                "SELECT role, content FROM messages
                 WHERE created_at >= ?1 AND role IN ('user','assistant')
                 ORDER BY created_at ASC",
            )
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![since], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| error.to_string())?;

        let mut transcript = String::new();
        for row in rows.flatten() {
            let label = if row.0 == "user" { "あなた" } else { "JARVIS" };
            transcript.push_str(&format!("{label}: {}\n", row.1.chars().take(300).collect::<String>()));
            if transcript.chars().count() > 8000 {
                break;
            }
        }
        (settings, transcript)
    };

    if transcript.trim().is_empty() {
        return Ok("直近24時間の会話はありません。".into());
    }

    let digest = crate::providers::complete::complete(
        &app,
        &settings,
        "あなたはJ.A.R.V.I.S.です。執事口調で簡潔に振り返りを述べます。",
        &format!(
            "以下は直近24時間の会話です。重要事項・決定・気づきを3〜6個の箇条書きで振り返ってください。\n\n{transcript}"
        ),
    )
    .await?;
    Ok(digest)
}

/// Kick off background memory extraction / summarization after a reply.
pub fn after_reply(app: &AppHandle, thread_id: &str, settings: &Settings) {
    if !settings.memory.enabled {
        return;
    }
    let extract = settings.memory.auto_extract;
    let summarize = settings.memory.auto_summarize;
    if !extract && !summarize {
        return;
    }

    let app = app.clone();
    let thread_id = thread_id.to_string();
    let settings = settings.clone();
    tauri::async_runtime::spawn(async move {
        if summarize {
            auto_summarize(&app, &settings, &thread_id).await;
        }
        if extract {
            auto_extract(&app, &settings, &thread_id).await;
        }
    });
}

async fn auto_summarize(app: &AppHandle, settings: &Settings, thread_id: &str) {
    let (messages, existing) = {
        let state = app.state::<AppState>();
        let Ok(conn) = state.db.lock() else {
            return;
        };
        let Ok(messages) = db::list_messages(&conn, thread_id) else {
            return;
        };
        let existing = db::get_thread(&conn, thread_id)
            .ok()
            .flatten()
            .and_then(|thread| thread.summary)
            .unwrap_or_default();
        (messages, existing)
    };

    if messages.len() <= settings.max_history * 2 {
        return;
    }

    let mut transcript = String::new();
    if !existing.trim().is_empty() {
        transcript.push_str(&format!("【既存の要約】\n{existing}\n\n"));
    }
    for message in messages.iter().take(messages.len().saturating_sub(settings.max_history)) {
        let label = if message.role == "user" { "あなた" } else { "JARVIS" };
        transcript.push_str(&format!(
            "{label}: {}\n",
            message.content.chars().take(500).collect::<String>()
        ));
        if transcript.chars().count() > 8000 {
            break;
        }
    }

    let result = crate::providers::complete::complete(
        app,
        settings,
        SUMMARY_SYSTEM,
        &format!("以下の会話を300字程度で要約してください。\n\n{transcript}"),
    )
    .await;

    if let Ok(summary) = result {
        let state = app.state::<AppState>();
        let Ok(conn) = state.db.lock() else {
            return;
        };
        let upto = messages
            .iter()
            .take(messages.len().saturating_sub(settings.max_history))
            .last()
            .map(|message| message.created_at)
            .unwrap_or(0);
        if let Err(error) = db::set_thread_summary(&conn, thread_id, &summary, upto) {
            crate::log_message("WARN", "memory", &format!("save summary: {error}"));
        }
    }
}

async fn auto_extract(app: &AppHandle, settings: &Settings, thread_id: &str) {
    let messages = {
        let state = app.state::<AppState>();
        let Ok(conn) = state.db.lock() else {
            return;
        };
        let Ok(all) = db::list_messages(&conn, thread_id) else {
            return;
        };
        all.into_iter()
            .rev()
            .take(6)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
    };
    if messages.len() < 2 {
        return;
    }

    let mut transcript = String::new();
    for message in &messages {
        let label = if message.role == "user" { "あなた" } else { "JARVIS" };
        transcript.push_str(&format!(
            "{label}: {}\n",
            message.content.chars().take(400).collect::<String>()
        ));
    }

    let Ok(result) = crate::providers::complete::complete(
        app,
        settings,
        EXTRACT_SYSTEM,
        &format!(
            "次の会話から、ユーザーに関する永続的に有用な事実だけを「- 」形式で抽出してください。\n\n{transcript}"
        ),
    )
    .await
    else {
        return;
    };

    let state = app.state::<AppState>();
    let Ok(conn) = state.db.lock() else {
        return;
    };
    let mut added = 0;
    for line in result.lines() {
        let line = line.trim().trim_start_matches(['-', '*', '・']).trim();
        if line.len() < 4 || line.len() > 200 {
            continue;
        }
        if db::add_memory(&conn, line, "auto").is_ok() {
            added += 1;
        }
        if added >= 5 {
            break;
        }
    }
    drop(conn);
    if added > 0 {
        crate::events::emit(app, crate::events::MEMORY_UPDATED, added);
    }
}
