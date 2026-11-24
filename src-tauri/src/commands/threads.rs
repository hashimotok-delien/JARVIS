use tauri::State;

use crate::db;
use crate::models::{Message, Thread};
use crate::state::AppState;

#[tauri::command]
pub fn list_threads(state: State<'_, AppState>) -> Result<Vec<Thread>, String> {
    let conn = crate::commands::lock_db(&state)?;
    db::list_threads(&conn)
}

#[tauri::command]
pub fn create_thread(state: State<'_, AppState>, title: Option<String>) -> Result<Thread, String> {
    let conn = crate::commands::lock_db(&state)?;
    let id = uuid::Uuid::new_v4().to_string();
    let title = title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "新しい会話".to_string());
    db::create_thread(&conn, &id, &title)
}

#[tauri::command]
pub fn rename_thread(state: State<'_, AppState>, id: String, title: String) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("タイトルが空です".into());
    }
    let conn = crate::commands::lock_db(&state)?;
    db::rename_thread(&conn, &id, title)
}

#[tauri::command]
pub fn delete_thread(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = crate::commands::lock_db(&state)?;
    db::delete_thread(&conn, &id)
}

#[tauri::command]
pub fn set_thread_pinned(
    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    let conn = crate::commands::lock_db(&state)?;
    db::set_pinned(&conn, &id, pinned)
}

#[tauri::command]
pub fn list_messages(
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<Vec<Message>, String> {
    let conn = crate::commands::lock_db(&state)?;
    db::list_messages(&conn, &thread_id)
}

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
        "thread".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}

/// Export a thread as markdown or JSON and return the written path.
#[tauri::command]
pub fn export_thread(
    state: State<'_, AppState>,
    id: String,
    format: String,
) -> Result<String, String> {
    let (thread, messages) = {
        let conn = crate::commands::lock_db(&state)?;
        let thread =
            db::get_thread(&conn, &id)?.ok_or_else(|| "スレッドが見つかりません".to_string())?;
        let messages = db::list_messages(&conn, &id)?;
        (thread, messages)
    };

    let dir = state.data_dir.join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let base = sanitize_filename(&thread.title);
    let format = format.trim().to_lowercase();

    if format == "json" {
        let path = dir.join(format!("{base}.json"));
        let payload = serde_json::json!({
            "thread": thread,
            "messages": messages,
        });
        let text = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
        std::fs::write(&path, text).map_err(|e| e.to_string())?;
        return Ok(path.to_string_lossy().to_string());
    }

    let path = dir.join(format!("{base}.md"));
    let mut text = format!("# {}\n\n", thread.title);
    for message in messages {
        let label = match message.role.as_str() {
            "user" => "あなた",
            "assistant" => "J.A.R.V.I.S.",
            other => other,
        };
        text.push_str(&format!("## {label}\n\n{}\n\n", message.content));
    }
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}
