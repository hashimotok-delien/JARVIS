//! SQLite persistence for threads, messages, settings and secrets.

use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::{Message, Settings, Thread};
use crate::secrets;

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

pub fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS threads (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            system_prompt TEXT,
            pinned INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL
                REFERENCES threads(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            provider TEXT,
            model TEXT,
            error TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_thread
            ON messages(thread_id, created_at);
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS secrets (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    )
    .map_err(|e| e.to_string())
}

pub fn list_threads(conn: &Connection) -> Result<Vec<Thread>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, pinned, created_at, updated_at
             FROM threads
             ORDER BY pinned DESC, updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Thread {
                id: row.get(0)?,
                title: row.get(1)?,
                pinned: row.get::<_, i64>(2)? != 0,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_thread(conn: &Connection, id: &str) -> Result<Option<Thread>, String> {
    conn.query_row(
        "SELECT id, title, pinned, created_at, updated_at
         FROM threads WHERE id = ?1",
        params![id],
        |row| {
            Ok(Thread {
                id: row.get(0)?,
                title: row.get(1)?,
                pinned: row.get::<_, i64>(2)? != 0,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn create_thread(conn: &Connection, id: &str, title: &str) -> Result<Thread, String> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO threads (id, title, pinned, created_at, updated_at)
         VALUES (?1, ?2, 0, ?3, ?3)",
        params![id, title, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(Thread {
        id: id.to_string(),
        title: title.to_string(),
        pinned: false,
        created_at: now,
        updated_at: now,
    })
}

pub fn rename_thread(conn: &Connection, id: &str, title: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE threads SET title = ?2 WHERE id = ?1",
        params![id, title],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_thread(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM threads WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_pinned(conn: &Connection, id: &str, pinned: bool) -> Result<(), String> {
    conn.execute(
        "UPDATE threads SET pinned = ?2 WHERE id = ?1",
        params![id, i64::from(pinned)],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn touch_thread(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE threads SET updated_at = ?2 WHERE id = ?1",
        params![id, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_messages(conn: &Connection, thread_id: &str) -> Result<Vec<Message>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, thread_id, role, content, created_at,
                    provider, model, error
             FROM messages
             WHERE thread_id = ?1
             ORDER BY created_at ASC, rowid ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![thread_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                thread_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                provider: row.get(5)?,
                model: row.get(6)?,
                error: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn insert_message(conn: &Connection, message: &Message) -> Result<(), String> {
    conn.execute(
        "INSERT INTO messages
            (id, thread_id, role, content, provider, model, error, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            message.id,
            message.thread_id,
            message.role,
            message.content,
            message.provider,
            message.model,
            message.error,
            message.created_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_settings(conn: &Connection) -> Settings {
    let raw: Option<String> = match conn
        .query_row("SELECT value FROM settings WHERE key = 'app'", [], |row| {
            row.get(0)
        })
        .optional()
    {
        Ok(raw) => raw,
        Err(error) => {
            crate::log_message(
                "ERROR",
                "settings",
                &format!("failed to read settings: {error}"),
            );
            None
        }
    };

    match raw {
        Some(json) => match serde_json::from_str::<Settings>(&json) {
            Ok(settings) => settings.sanitized(),
            Err(error) => {
                crate::log_message(
                    "ERROR",
                    "settings",
                    &format!("failed to parse saved settings: {error}"),
                );
                Settings::default()
            }
        },
        None => Settings::default(),
    }
}

pub fn save_settings(conn: &Connection, settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('app', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_secret(conn: &Connection, key: &str) -> Option<String> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM secrets WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .unwrap_or(None);

    stored
        .and_then(|encoded| secrets::unprotect(&encoded).ok())
        .filter(|value| !value.is_empty())
}

pub fn set_secret(conn: &Connection, key: &str, plain: Option<&str>) -> Result<(), String> {
    match plain.map(str::trim).filter(|v| !v.is_empty()) {
        Some(value) => {
            let encoded = secrets::protect(value)?;
            conn.execute(
                "INSERT INTO secrets (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, encoded],
            )
            .map_err(|e| e.to_string())?;
        }
        None => {
            conn.execute("DELETE FROM secrets WHERE key = ?1", params![key])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
