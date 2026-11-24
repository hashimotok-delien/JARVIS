use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

use crate::db;
use crate::events::{self, ChatTitle};
use crate::models::Message;
use crate::providers::{self, ChatTurn, StreamContext};
use crate::state::AppState;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAck {
    pub request_id: String,
    pub thread_id: String,
    pub user_message: Message,
    pub assistant_id: String,
}

fn derive_title(content: &str) -> String {
    let first_line = content
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();
    let mut title = String::new();
    for (index, ch) in first_line.chars().enumerate() {
        if index >= 32 {
            title.push('…');
            break;
        }
        title.push(ch);
    }
    if title.is_empty() {
        "新しい会話".into()
    } else {
        title
    }
}

#[tauri::command(rename_all = "camelCase", async)]
pub async fn send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
    content: String,
) -> Result<SendAck, String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("メッセージが空です".into());
    }

    let (settings, turns, user_message, title_update) = {
        let conn = crate::commands::lock_db(&state)?;

        if db::get_thread(&conn, &thread_id)?.is_none() {
            db::create_thread(&conn, &thread_id, &derive_title(&content))?;
        }

        let previous = db::list_messages(&conn, &thread_id)?;
        let is_first = previous.is_empty();

        let user_message = Message {
            id: uuid::Uuid::new_v4().to_string(),
            thread_id: thread_id.clone(),
            role: "user".into(),
            content: content.clone(),
            created_at: db::now_ms(),
            provider: None,
            model: None,
            error: None,
        };
        db::insert_message(&conn, &user_message)?;
        db::touch_thread(&conn, &thread_id)?;

        let title_update = is_first.then(|| derive_title(&content));
        if let Some(title) = title_update.as_deref() {
            db::rename_thread(&conn, &thread_id, title)?;
        }

        let settings = db::load_settings(&conn);
        let mut history = previous;
        history.push(user_message.clone());

        let start = history.len().saturating_sub(settings.max_history);
        let mut turns = vec![ChatTurn {
            role: "system".into(),
            content: settings.system_prompt.clone(),
        }];
        for message in &history[start..] {
            if message.content.trim().is_empty() {
                continue;
            }
            if message.role != "user" && message.role != "assistant" {
                continue;
            }
            turns.push(ChatTurn {
                role: message.role.clone(),
                content: message.content.clone(),
            });
        }
        (settings, turns, user_message, title_update)
    };

    let request_id = uuid::Uuid::new_v4().to_string();
    let assistant_id = uuid::Uuid::new_v4().to_string();

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut cancels = state
            .cancels
            .lock()
            .map_err(|_| "状態ロックに失敗しました".to_string())?;
        cancels.insert(request_id.clone(), cancel.clone());
    }

    if let Some(title) = title_update {
        events::emit(
            &app,
            events::CHAT_TITLE,
            ChatTitle {
                thread_id: thread_id.clone(),
                title,
            },
        );
    }

    let context = StreamContext {
        request_id: request_id.clone(),
        thread_id: thread_id.clone(),
        message_id: assistant_id.clone(),
        turns,
    };

    let app_handle = app.clone();
    let request_key = request_id.clone();
    tauri::async_runtime::spawn(async move {
        providers::run(
            app_handle.clone(),
            context,
            settings,
            cancel,
        )
        .await;

        if let Some(state) = app_handle.try_state::<AppState>() {
            if let Ok(mut cancels) = state.cancels.lock() {
                cancels.remove(&request_key);
            }
        }
    });

    Ok(SendAck {
        request_id,
        thread_id,
        user_message,
        assistant_id,
    })
}

#[tauri::command]
pub fn stop_generation(
    state: State<'_, AppState>,
    request_id: String,
) {
    if let Ok(cancels) = state.cancels.lock() {
        if let Some(flag) = cancels.get(&request_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}
