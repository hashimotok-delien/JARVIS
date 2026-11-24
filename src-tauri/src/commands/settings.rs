use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, State};

use crate::db;
use crate::events;
use crate::models::{Settings, SettingsPayload};
use crate::state::AppState;

#[tauri::command]
pub fn get_settings(app: AppHandle) -> SettingsPayload {
    crate::commands::settings_payload(&app)
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<SettingsPayload, String> {
    let settings = settings.sanitized();
    {
        let conn = crate::commands::lock_db(&state)?;
        db::save_settings(&conn, &settings)?;
    }
    crate::commands::app::apply_hud_options(&app, &settings);
    events::emit(&app, events::SETTINGS_CHANGED, settings.clone());
    Ok(crate::commands::settings_payload(&app))
}

#[tauri::command]
pub fn set_gemini_key(
    app: AppHandle,
    state: State<'_, AppState>,
    key: Option<String>,
) -> Result<SettingsPayload, String> {
    {
        let conn = crate::commands::lock_db(&state)?;
        db::set_secret(&conn, "gemini_api_key", key.as_deref())?;
    }
    let payload = crate::commands::settings_payload(&app);
    events::emit(&app, events::SETTINGS_CHANGED, payload.settings.clone());
    Ok(payload)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCheck {
    pub id: String,
    pub label: String,
    pub ok: bool,
    pub detail: String,
}

async fn probe(
    client: &reqwest::Client,
    url: &str,
    key: Option<&str>,
    model: &str,
) -> (bool, String) {
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": "ping" }],
        "stream": false,
        "max_tokens": 8,
    });
    let mut request = client.post(url).json(&body);
    if let Some(key) = key {
        request = request.bearer_auth(key);
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                (true, format!("OK ({status})"))
            } else {
                let text = response.text().await.unwrap_or_default();
                let detail: String = text.chars().take(160).collect();
                crate::log_message(
                    "WARN",
                    "provider",
                    &format!("connection test failed: {status} {detail}"),
                );
                (false, format!("{status} {detail}"))
            }
        }
        Err(error) => {
            crate::log_message(
                "ERROR",
                "provider",
                &format!("connection test request failed: {error}"),
            );
            (false, error.to_string())
        }
    }
}

#[tauri::command]
pub async fn test_providers(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ProviderCheck>, String> {
    let settings = crate::commands::read_settings(&state);
    let key = {
        let conn = crate::commands::lock_db(&state)?;
        db::get_secret(&conn, "gemini_api_key")
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let gemini_url = format!("{}/chat/completions", settings.providers.gemini_base_url);
    let ollama_url = format!("{}/v1/chat/completions", settings.providers.ollama_base_url);

    let (gemini, ollama) = tokio::join!(
        probe(
            &client,
            &gemini_url,
            key.as_deref(),
            &settings.providers.gemini_model
        ),
        probe(&client, &ollama_url, None, &settings.providers.ollama_model)
    );

    let _ = app;

    Ok(vec![
        ProviderCheck {
            id: "gemini".into(),
            label: "Gemini".into(),
            ok: gemini.0,
            detail: if key.is_none() {
                "APIキー未設定".into()
            } else {
                gemini.1
            },
        },
        ProviderCheck {
            id: "ollama".into(),
            label: "Ollama".into(),
            ok: ollama.0,
            detail: ollama.1,
        },
    ])
}
