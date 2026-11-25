//! Local helper processes (Ollama, opencode web, ...) started by JARVIS.

use futures_util::future::join_all;
use serde::Serialize;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::models::{LocalService, Settings};
use crate::state::AppState;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub name: String,
    pub enabled: bool,
    pub running: bool,
    /// True when JARVIS spawned it and may stop it on exit.
    pub owned: bool,
    pub detail: String,
}

async fn healthy(url: &str) -> bool {
    let url = url.trim();
    if url.is_empty() {
        return false;
    }
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_millis(1500))
        .connect_timeout(Duration::from_millis(1000))
        .build()
    else {
        return false;
    };
    matches!(
        client.get(url).send().await,
        Ok(response) if response.status().as_u16() < 500
    )
}

fn owned_alive(app: &AppHandle, name: &str) -> bool {
    let state = app.state::<AppState>();
    let Ok(mut services) = state.services.lock() else {
        return false;
    };
    let Some(child) = services.get_mut(name) else {
        return false;
    };
    let alive = matches!(child.try_wait(), Ok(None));
    if !alive {
        services.remove(name);
    }
    alive
}

fn kill_tree(child: &mut Child) {
    let pid = child.id();
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command.creation_flags(CREATE_NO_WINDOW);
        let _ = command.status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Start a configured service. Returns a short human-readable result.
pub async fn start(app: &AppHandle, service: &LocalService) -> Result<String, String> {
    let name = service.name.trim();
    let command = service.command.trim();
    if name.is_empty() || command.is_empty() {
        return Err("サービス名とコマンドを入力してください".into());
    }

    if !service.health_url.is_empty() && healthy(&service.health_url).await {
        return Ok("すでに起動しています（外部プロセス）".into());
    }
    if owned_alive(app, name) {
        return Ok("すでに起動しています".into());
    }

    let mut process = Command::new(command);
    process
        .args(&service.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if !service.cwd.trim().is_empty() {
        process.current_dir(service.cwd.trim());
    }
    #[cfg(windows)]
    process.creation_flags(CREATE_NO_WINDOW);

    let child = process
        .spawn()
        .map_err(|error| format!("起動できません: {error}"))?;
    let pid = child.id();

    {
        let state = app.state::<AppState>();
        let Ok(mut services) = state.services.lock() else {
            return Err("状態ロックに失敗しました".into());
        };
        if let Some(mut previous) = services.remove(name) {
            kill_tree(&mut previous);
        }
        services.insert(name.to_string(), child);
    }

    if !service.health_url.is_empty() {
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            if healthy(&service.health_url).await {
                return Ok(format!("起動しました (PID {pid})"));
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        return Ok(format!(
            "起動しましたがヘルスチェック未応答です (PID {pid})"
        ));
    }

    Ok(format!("起動しました (PID {pid})"))
}

/// Stop a service if JARVIS spawned it. External processes are left alone.
pub fn stop(app: &AppHandle, name: &str) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let mut services = state
        .services
        .lock()
        .map_err(|_| "状態ロックに失敗しました".to_string())?;
    match services.remove(name) {
        Some(mut child) => {
            kill_tree(&mut child);
            Ok(true)
        }
        None => Ok(false),
    }
}

pub fn stop_all(app: &AppHandle) {
    // Services configured with `stop_on_exit = false` are detached instead.
    let settings = crate::commands::read_settings_from(app);
    let keep_running: Vec<String> = settings
        .services
        .iter()
        .filter(|service| !service.stop_on_exit)
        .map(|service| service.name.clone())
        .collect();

    let state = app.state::<AppState>();
    let Ok(mut services) = state.services.lock() else {
        return;
    };
    let children: Vec<(String, Child)> = services.drain().collect();
    drop(services);

    for (name, mut child) in children {
        if keep_running.contains(&name) {
            crate::log_message(
                "INFO",
                "service",
                &format!("leaving {name} running (stop_on_exit = false)"),
            );
            continue;
        }
        crate::log_message("INFO", "service", &format!("stopping {name}"));
        kill_tree(&mut child);
    }
}

pub async fn statuses(app: &AppHandle, settings: &Settings) -> Vec<ServiceStatus> {
    join_all(settings.services.iter().map(|service| async move {
        let owned = owned_alive(app, &service.name);
        let external = if !owned && !service.health_url.is_empty() {
            healthy(&service.health_url).await
        } else {
            false
        };
        let running = owned || external;
        let detail = if !service.enabled && !external {
            "無効".to_string()
        } else if owned {
            "JARVISが起動".to_string()
        } else if external {
            "外部で起動中".to_string()
        } else {
            "停止".to_string()
        };
        ServiceStatus {
            name: service.name.clone(),
            enabled: service.enabled,
            running,
            owned,
            detail,
        }
    }))
    .await
}

/// Start every enabled `auto_start` service in the background.
pub fn start_auto(app: &AppHandle) {
    let settings = crate::commands::read_settings_from(app);
    for service in settings
        .services
        .iter()
        .filter(|service| service.enabled && service.auto_start)
        .cloned()
    {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            match start(&handle, &service).await {
                Ok(detail) => crate::log_message(
                    "INFO",
                    "service",
                    &format!("{}: {detail}", service.name),
                ),
                Err(error) => crate::log_message(
                    "WARN",
                    "service",
                    &format!("{}: {error}", service.name),
                ),
            }
        });
    }
}
