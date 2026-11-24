//! Search, history editing, usage stats, data export and templates.

use tauri::State;

use crate::db;
use crate::models::{SearchHit, Template, UsageStats};
use crate::state::AppState;

fn sanitize_filename(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "jarvis".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}

#[tauri::command]
pub fn search_messages(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let conn = crate::commands::lock_db(&state)?;
    db::search_messages(&conn, &query, limit.unwrap_or(40))
}

#[tauri::command]
pub fn truncate_from_message(
    state: State<'_, AppState>,
    thread_id: String,
    message_id: String,
) -> Result<(), String> {
    let conn = crate::commands::lock_db(&state)?;
    db::delete_messages_from(&conn, &thread_id, &message_id)
}

#[tauri::command]
pub fn branch_thread(
    state: State<'_, AppState>,
    thread_id: String,
    message_id: String,
) -> Result<crate::models::Thread, String> {
    let conn = crate::commands::lock_db(&state)?;
    db::branch_thread(&conn, &thread_id, &message_id)
}

#[tauri::command]
pub fn usage_stats(state: State<'_, AppState>) -> Result<UsageStats, String> {
    let conn = crate::commands::lock_db(&state)?;
    db::usage_stats(&conn)
}

#[tauri::command]
pub fn list_templates(state: State<'_, AppState>) -> Result<Vec<Template>, String> {
    let conn = crate::commands::lock_db(&state)?;
    db::list_templates(&conn)
}

#[tauri::command]
pub fn add_template(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
    body: String,
) -> Result<Template, String> {
    let template = {
        let conn = crate::commands::lock_db(&state)?;
        db::add_template(&conn, &name, &body)?
    };
    crate::events::emit(&app, crate::events::MEMORY_UPDATED, "template");
    Ok(template)
}

#[tauri::command]
pub fn delete_template(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    {
        let conn = crate::commands::lock_db(&state)?;
        db::delete_template(&conn, &id)?;
    }
    crate::events::emit(&app, crate::events::MEMORY_UPDATED, "template");
    Ok(())
}

/// Export every thread into a single file in `usr/exports`.
#[tauri::command]
pub fn export_all(state: State<'_, AppState>, format: String) -> Result<String, String> {
    let (threads, messages) = {
        let conn = crate::commands::lock_db(&state)?;
        let threads = db::list_threads(&conn)?;
        let mut messages = Vec::new();
        for thread in &threads {
            messages.push((thread.id.clone(), db::list_messages(&conn, &thread.id)?));
        }
        (threads, messages)
    };

    let dir = state.data_dir.join("exports");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let stamp = db::now_ms();

    if format.trim().eq_ignore_ascii_case("json") {
        let path = dir.join(format!("jarvis-all-{stamp}.json"));
        let payload = serde_json::json!({ "threads": threads, "messages": messages });
        let text = serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;
        std::fs::write(&path, text).map_err(|error| error.to_string())?;
        return Ok(path.to_string_lossy().to_string());
    }

    let path = dir.join(format!("jarvis-all-{stamp}.md"));
    let mut text = String::from("# J.A.R.V.I.S. 会話エクスポート\n\n");
    for (thread, (_thread_id, entries)) in threads.iter().zip(messages.iter()) {
        text.push_str(&format!("## {}\n\n", thread.title));
        for message in entries {
            let label = match message.role.as_str() {
                "user" => "あなた",
                "assistant" => "J.A.R.V.I.S.",
                other => other,
            };
            text.push_str(&format!("**{label}**\n\n{}\n\n", message.content));
        }
    }
    std::fs::write(&path, text).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Copy the SQLite database into `usr/exports` for safekeeping.
#[tauri::command]
pub fn backup_database(state: State<'_, AppState>) -> Result<String, String> {
    let dir = state.data_dir.join("exports");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let source = state.data_dir.join("jarvis.db");
    let name = format!("jarvis-backup-{}.db", db::now_ms());
    let target = dir.join(sanitize_filename(&name));

    {
        let conn = crate::commands::lock_db(&state)?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|error| error.to_string())?;
    }

    std::fs::copy(&source, &target).map_err(|error| error.to_string())?;
    Ok(target.to_string_lossy().to_string())
}
