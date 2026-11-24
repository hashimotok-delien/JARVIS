//! SQLite persistence for threads, messages, settings and secrets.

use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::{
    Memory, Message, ProviderUsage, SearchHit, Settings, Template, Thread, UsageBucket, UsageStats,
};
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

/// Last-resort database so a broken data folder cannot prevent startup.
pub fn open_memory() -> Result<Connection, String> {
    let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
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
        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'fact',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS usage_events (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            latency_ms INTEGER NOT NULL,
            characters INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_usage_created
            ON usage_events(created_at);
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            content,
            message_id UNINDEXED,
            thread_id UNINDEXED,
            tokenize = 'trigram'
        );
        CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts (content, message_id, thread_id)
            VALUES (new.content, new.id, new.thread_id);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
            DELETE FROM messages_fts WHERE message_id = old.id;
        END;
        CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE OF content ON messages BEGIN
            DELETE FROM messages_fts WHERE message_id = old.id;
            INSERT INTO messages_fts (content, message_id, thread_id)
            VALUES (new.content, new.id, new.thread_id);
        END;
        "#,
    )
    .map_err(|e| e.to_string())?;

    ensure_column(conn, "threads", "summary", "TEXT")?;
    ensure_column(
        conn,
        "threads",
        "summary_upto",
        "INTEGER NOT NULL DEFAULT 0",
    )?;

    // Backfill the search index for databases created before FTS existed.
    let missing: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM messages m
             WHERE NOT EXISTS (
                 SELECT 1 FROM messages_fts f WHERE f.message_id = m.id
             )",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if missing > 0 {
        conn.execute(
            "INSERT INTO messages_fts (content, message_id, thread_id)
             SELECT m.content, m.id, m.thread_id FROM messages m
             WHERE NOT EXISTS (
                 SELECT 1 FROM messages_fts f WHERE f.message_id = m.id
             )",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let exists = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .any(|name| name == column);
    if exists {
        return Ok(());
    }
    conn.execute_batch(&format!(
        "ALTER TABLE {table} ADD COLUMN {column} {definition}"
    ))
    .map_err(|e| e.to_string())
}

pub fn list_threads(conn: &Connection) -> Result<Vec<Thread>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, pinned, created_at, updated_at,
                    summary, summary_upto
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
                summary: row.get(5)?,
                summary_upto: row.get::<_, Option<i64>>(6)?.unwrap_or(0),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_thread(conn: &Connection, id: &str) -> Result<Option<Thread>, String> {
    conn.query_row(
        "SELECT id, title, pinned, created_at, updated_at,
                summary, summary_upto
         FROM threads WHERE id = ?1",
        params![id],
        |row| {
            Ok(Thread {
                id: row.get(0)?,
                title: row.get(1)?,
                pinned: row.get::<_, i64>(2)? != 0,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                summary: row.get(5)?,
                summary_upto: row.get::<_, Option<i64>>(6)?.unwrap_or(0),
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
        summary: None,
        summary_upto: 0,
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

pub fn get_message(conn: &Connection, id: &str) -> Result<Option<Message>, String> {
    conn.query_row(
        "SELECT id, thread_id, role, content, created_at,
                provider, model, error
         FROM messages WHERE id = ?1",
        params![id],
        |row| {
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
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Delete the given message and every message after it in the same thread.
pub fn delete_messages_from(
    conn: &Connection,
    thread_id: &str,
    message_id: &str,
) -> Result<(), String> {
    get_message(conn, message_id)?
        .filter(|message| message.thread_id == thread_id)
        .ok_or_else(|| "メッセージが見つかりません".to_string())?;
    conn.execute(
        "DELETE FROM messages
         WHERE thread_id = ?1
           AND rowid >= (SELECT rowid FROM messages WHERE id = ?2)",
        params![thread_id, message_id],
    )
    .map_err(|e| e.to_string())?;
    touch_thread(conn, thread_id)?;
    Ok(())
}

/// Copy every message up to and including `message_id` into a new thread.
pub fn branch_thread(
    conn: &Connection,
    source_thread_id: &str,
    message_id: &str,
) -> Result<Thread, String> {
    let source = get_thread(conn, source_thread_id)?
        .ok_or_else(|| "スレッドが見つかりません".to_string())?;
    get_message(conn, message_id)?
        .filter(|message| message.thread_id == source_thread_id)
        .ok_or_else(|| "メッセージが見つかりません".to_string())?;

    let new_id = uuid::Uuid::new_v4().to_string();
    let title = format!("{}（分岐）", source.title);
    let thread = create_thread(conn, &new_id, &title)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, thread_id, role, content, created_at,
                    provider, model, error
             FROM messages
             WHERE thread_id = ?1
               AND rowid <= (SELECT rowid FROM messages WHERE id = ?2)
             ORDER BY rowid ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![source_thread_id, message_id], |row| {
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
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    for message in rows {
        let copy = Message {
            id: uuid::Uuid::new_v4().to_string(),
            thread_id: new_id.clone(),
            ..message
        };
        insert_message(conn, &copy)?;
    }
    Ok(thread)
}

pub fn set_thread_summary(
    conn: &Connection,
    thread_id: &str,
    summary: &str,
    upto: i64,
) -> Result<(), String> {
    conn.execute(
        "UPDATE threads SET summary = ?2, summary_upto = ?3 WHERE id = ?1",
        params![thread_id, summary, upto],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn search_messages(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchHit>, String> {
    let keyword = query.trim();
    if keyword.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 100) as i64;
    let pattern = format!("%{}%", keyword.replace('%', "").replace('_', ""));

    let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<SearchHit> {
        let content: String = row.get(4)?;
        let snippet: String = content.chars().take(160).collect();
        Ok(SearchHit {
            message_id: row.get(0)?,
            thread_id: row.get(1)?,
            thread_title: row.get(2)?,
            role: row.get(3)?,
            snippet,
            created_at: row.get(5)?,
        })
    };

    // The trigram index needs at least three characters; shorter terms use LIKE.
    if keyword.chars().count() >= 3 {
        let phrase = format!("\"{}\"", keyword.replace('"', "\"\""));
        let fts_sql =
            "SELECT m.id, m.thread_id, t.title, m.role, m.content, m.created_at
             FROM messages_fts f
             JOIN messages m ON m.id = f.message_id
             JOIN threads t ON t.id = m.thread_id
             WHERE messages_fts MATCH ?1
             ORDER BY m.created_at DESC
             LIMIT ?2";
        if let Ok(mut stmt) = conn.prepare(fts_sql) {
            if let Ok(rows) = stmt.query_map(params![phrase, limit], map_row) {
                let hits = rows
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                if !hits.is_empty() {
                    return Ok(hits);
                }
            }
        }
    }

    let sql = "SELECT m.id, m.thread_id, t.title, m.role, m.content, m.created_at
               FROM messages m
               JOIN threads t ON t.id = m.thread_id
               WHERE m.content LIKE ?1
               ORDER BY m.created_at DESC
               LIMIT ?2";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![pattern, limit], map_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn list_memories(conn: &Connection, limit: usize) -> Result<Vec<Memory>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, content, kind, created_at, updated_at
             FROM memories
             ORDER BY updated_at DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit.clamp(1, 500) as i64], |row| {
            Ok(Memory {
                id: row.get(0)?,
                content: row.get(1)?,
                kind: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn add_memory(conn: &Connection, content: &str, kind: &str) -> Result<Memory, String> {
    let content = content.trim();
    if content.is_empty() {
        return Err("記憶する内容が空です".into());
    }
    // Avoid duplicates that differ only by surrounding whitespace/case.
    let existing: Option<Memory> = conn
        .query_row(
            "SELECT id, content, kind, created_at, updated_at
             FROM memories
             WHERE lower(trim(content)) = lower(trim(?1))
             LIMIT 1",
            params![content],
            |row| {
                Ok(Memory {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    kind: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(mut memory) = existing {
        memory.updated_at = now_ms();
        conn.execute(
            "UPDATE memories SET updated_at = ?2 WHERE id = ?1",
            params![memory.id, memory.updated_at],
        )
        .map_err(|e| e.to_string())?;
        return Ok(memory);
    }

    let now = now_ms();
    let memory = Memory {
        id: uuid::Uuid::new_v4().to_string(),
        content: content.to_string(),
        kind: kind.to_string(),
        created_at: now,
        updated_at: now,
    };
    conn.execute(
        "INSERT INTO memories (id, content, kind, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            memory.id,
            memory.content,
            memory.kind,
            memory.created_at,
            memory.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(memory)
}

pub fn update_memory(
    conn: &Connection,
    id: &str,
    content: &str,
    kind: &str,
) -> Result<(), String> {
    let content = content.trim();
    if content.is_empty() {
        return Err("記憶する内容が空です".into());
    }
    conn.execute(
        "UPDATE memories SET content = ?2, kind = ?3, updated_at = ?4
         WHERE id = ?1",
        params![id, content, kind, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_memory(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM memories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_templates(conn: &Connection) -> Result<Vec<Template>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, body, created_at FROM templates
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Template {
                id: row.get(0)?,
                name: row.get(1)?,
                body: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn add_template(conn: &Connection, name: &str, body: &str) -> Result<Template, String> {
    let name = name.trim();
    let body = body.trim();
    if name.is_empty() || body.is_empty() {
        return Err("テンプレート名と本文を入力してください".into());
    }
    let template = Template {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.chars().take(40).collect(),
        body: body.to_string(),
        created_at: now_ms(),
    };
    conn.execute(
        "INSERT INTO templates (id, name, body, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            template.id,
            template.name,
            template.body,
            template.created_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(template)
}

pub fn delete_template(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM templates WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn record_usage(
    conn: &Connection,
    thread_id: &str,
    provider: &str,
    model: &str,
    latency_ms: i64,
    characters: i64,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO usage_events
            (id, thread_id, provider, model, latency_ms, characters, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            uuid::Uuid::new_v4().to_string(),
            thread_id,
            provider,
            model,
            latency_ms.max(0),
            characters.max(0),
            now_ms()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn usage_bucket(conn: &Connection, since: i64) -> Result<UsageBucket, String> {
    conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(characters), 0),
                COALESCE(AVG(latency_ms), 0)
         FROM usage_events WHERE created_at >= ?1",
        params![since],
        |row| {
            Ok(UsageBucket {
                requests: row.get(0)?,
                characters: row.get(1)?,
                avg_latency_ms: row.get::<_, f64>(2)? as i64,
            })
        },
    )
    .map_err(|e| e.to_string())
}

pub fn usage_stats(conn: &Connection) -> Result<UsageStats, String> {
    let day_ago = now_ms() - 86_400_000;
    let week_ago = now_ms() - 7 * 86_400_000;

    let by_provider = {
        let mut stmt = conn
            .prepare(
                "SELECT provider, model, COUNT(*),
                        COALESCE(SUM(characters), 0),
                        COALESCE(AVG(latency_ms), 0)
                 FROM usage_events
                 GROUP BY provider, model
                 ORDER BY COUNT(*) DESC
                 LIMIT 12",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ProviderUsage {
                    provider: row.get(0)?,
                    model: row.get(1)?,
                    requests: row.get(2)?,
                    characters: row.get(3)?,
                    avg_latency_ms: row.get::<_, f64>(4)? as i64,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    Ok(UsageStats {
        today: usage_bucket(conn, day_ago)?,
        week: usage_bucket(conn, week_ago)?,
        all: usage_bucket(conn, 0)?,
        by_provider,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn add_message(conn: &Connection, thread_id: &str, role: &str, content: &str) {
        let message = Message {
            id: uuid::Uuid::new_v4().to_string(),
            thread_id: thread_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            created_at: now_ms(),
            provider: None,
            model: None,
            error: None,
        };
        insert_message(conn, &message).unwrap();
    }

    #[test]
    fn fts_trigram_search_finds_japanese_substrings() {
        let conn = memory_db();
        let thread = create_thread(&conn, "t1", "テスト").unwrap();
        add_message(&conn, &thread.id, "user", "明日の会議は10時からです");
        add_message(&conn, &thread.id, "assistant", "承知しました");

        let hits = search_messages(&conn, "会議", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].thread_id, thread.id);

        let short = search_messages(&conn, "10", 10).unwrap();
        assert_eq!(short.len(), 1);
    }

    #[test]
    fn memories_are_deduplicated_and_updated() {
        let conn = memory_db();
        let first = add_memory(&conn, "コーヒーが好き", "manual").unwrap();
        let second = add_memory(&conn, "  コーヒーが好き  ", "manual").unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(list_memories(&conn, 10).unwrap().len(), 1);

        update_memory(&conn, &first.id, "紅茶が好き", "manual").unwrap();
        let items = list_memories(&conn, 10).unwrap();
        assert_eq!(items[0].content, "紅茶が好き");
    }

    #[test]
    fn branch_and_truncate_keep_expected_messages() {
        let conn = memory_db();
        let thread = create_thread(&conn, "t2", "分岐元").unwrap();
        add_message(&conn, &thread.id, "user", "ひとつめ");
        add_message(&conn, &thread.id, "assistant", "ふたつめ");
        let messages = list_messages(&conn, &thread.id).unwrap();
        let target = messages[0].clone();

        let branch = branch_thread(&conn, &thread.id, &target.id).unwrap();
        assert_eq!(list_messages(&conn, &branch.id).unwrap().len(), 1);
        assert_eq!(list_messages(&conn, &thread.id).unwrap().len(), 2);

        let second = messages[1].clone();
        delete_messages_from(&conn, &thread.id, &second.id).unwrap();
        assert_eq!(list_messages(&conn, &thread.id).unwrap().len(), 1);
    }

    #[test]
    fn open_creates_a_writable_wal_database() {
        let dir = std::env::temp_dir().join(format!(
            "jarvis-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("jarvis.db");

        let conn = open(&path).unwrap();
        create_thread(&conn, "t1", "起動確認").unwrap();
        assert!(path.exists());
        drop(conn);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn usage_stats_aggregate_recent_events() {
        let conn = memory_db();
        record_usage(&conn, "t1", "gemini", "flash", 120, 100).unwrap();
        record_usage(&conn, "t1", "ollama", "qwen", 300, 50).unwrap();

        let stats = usage_stats(&conn).unwrap();
        assert_eq!(stats.all.requests, 2);
        assert_eq!(stats.all.characters, 150);
        assert_eq!(stats.by_provider.len(), 2);
    }
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
