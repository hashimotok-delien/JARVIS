//! Commands for managing local helper processes.

use tauri::{AppHandle, Manager};

use crate::models::LocalService;
use crate::services::{self, ServiceStatus};

#[tauri::command]
pub async fn list_local_services(app: AppHandle) -> Result<Vec<ServiceStatus>, String> {
    let settings = crate::commands::read_settings_from(&app);
    Ok(services::statuses(&app, &settings).await)
}

#[tauri::command]
pub async fn start_local_service(
    app: AppHandle,
    service: LocalService,
) -> Result<String, String> {
    services::start(&app, &service).await
}

#[tauri::command]
pub fn stop_local_service(app: AppHandle, name: String) -> Result<bool, String> {
    services::stop(&app, &name)
}

#[tauri::command]
pub async fn start_all_local_services(app: AppHandle) -> Result<usize, String> {
    let settings = crate::commands::read_settings_from(&app);
    let mut started = 0;
    for service in settings
        .services
        .iter()
        .filter(|service| service.enabled)
    {
        if services::start(&app, service).await.is_ok() {
            started += 1;
        }
    }
    Ok(started)
}

#[tauri::command]
pub fn stop_all_local_services(app: AppHandle) -> usize {
    let count = {
        let state = app.state::<crate::state::AppState>();
        state
            .services
            .lock()
            .map(|services| services.len())
            .unwrap_or(0)
    };
    services::stop_all(&app);
    count
}
