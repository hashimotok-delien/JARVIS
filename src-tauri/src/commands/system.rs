//! Lightweight host telemetry for the HUD dashboard.

use serde::Serialize;
use std::sync::Mutex;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    /// CPU load in percent (0..100).
    pub cpu: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub disk_used: u64,
    pub disk_total: u64,
    pub uptime_secs: u64,
}

/// Previous (idle, kernel, user) sample; the delta gives the load.
static CPU_SAMPLE: Mutex<Option<(u64, u64, u64)>> = Mutex::new(None);

#[cfg(windows)]
fn filetime_ticks(value: &windows_sys::Win32::Foundation::FILETIME) -> u64 {
    ((value.dwHighDateTime as u64) << 32) | value.dwLowDateTime as u64
}

#[cfg(windows)]
fn cpu_times() -> Option<(u64, u64, u64)> {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::GetSystemTimes;

    let mut idle = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let mut kernel = idle;
    let mut user = idle;
    let ok = unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) };
    if ok == 0 {
        return None;
    }
    Some((
        filetime_ticks(&idle),
        filetime_ticks(&kernel),
        filetime_ticks(&user),
    ))
}

#[cfg(windows)]
fn cpu_usage() -> f32 {
    let Some(current) = cpu_times() else {
        return 0.0;
    };
    let mut guard = match CPU_SAMPLE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let Some(previous) = guard.replace(current) else {
        return 0.0;
    };

    let idle = current.0.saturating_sub(previous.0);
    let kernel = current.1.saturating_sub(previous.1);
    let user = current.2.saturating_sub(previous.2);
    // Kernel time already includes idle time.
    let total = kernel.saturating_add(user);
    if total == 0 {
        return 0.0;
    }
    let busy = total.saturating_sub(idle);
    (busy as f32 / total as f32 * 100.0).clamp(0.0, 100.0)
}

#[cfg(windows)]
fn memory() -> (u64, u64) {
    use windows_sys::Win32::System::SystemInformation::{
        GlobalMemoryStatusEx, MEMORYSTATUSEX,
    };

    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return (0, 0);
    }
    (
        status.ullTotalPhys.saturating_sub(status.ullAvailPhys),
        status.ullTotalPhys,
    )
}

#[cfg(windows)]
fn disk() -> (u64, u64) {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    // Use the drive the app lives on, e.g. "D:\".
    let root = std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.components()
                .next()
                .map(|component| {
                    format!("{}\\", component.as_os_str().to_string_lossy())
                })
        })
        .unwrap_or_else(|| "C:\\".to_string());
    let wide: Vec<u16> = root
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let mut free_to_caller: u64 = 0;
    let mut total: u64 = 0;
    let mut free_total: u64 = 0;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_to_caller,
            &mut total,
            &mut free_total,
        )
    };
    if ok == 0 || total == 0 {
        return (0, 0);
    }
    (total.saturating_sub(free_to_caller), total)
}

#[cfg(windows)]
fn uptime_secs() -> u64 {
    use windows_sys::Win32::System::SystemInformation::GetTickCount64;
    unsafe { GetTickCount64() / 1000 }
}

#[tauri::command]
pub fn system_stats() -> SystemStats {
    #[cfg(windows)]
    {
        let (mem_used, mem_total) = memory();
        let (disk_used, disk_total) = disk();
        SystemStats {
            cpu: cpu_usage(),
            mem_used,
            mem_total,
            disk_used,
            disk_total,
            uptime_secs: uptime_secs(),
        }
    }
    #[cfg(not(windows))]
    {
        SystemStats::default()
    }
}
