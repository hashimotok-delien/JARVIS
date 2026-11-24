//! Native file and folder pickers.
//!
//! The Windows Forms dialogs that ship with PowerShell are used instead of an
//! extra dialog plugin so the bundle keeps a single, already-present runtime.

use tokio::process::Command;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn quote(value: &str) -> String {
    value.replace('\'', "''")
}

async fn run_picker(script: &str) -> Result<Option<String>, String> {
    let mut command = Command::new("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-STA", "-Command", script]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .await
        .map_err(|error| format!("選択ダイアログを開けません: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !detail.is_empty() {
            crate::log_message("WARN", "dialog", &detail);
        }
        return Err("選択ダイアログを開けませんでした".to_string());
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!path.is_empty()).then_some(path))
}

fn prelude() -> String {
    let mut script = String::from(
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n\
         Add-Type -AssemblyName System.Windows.Forms | Out-Null\n",
    );
    script.push_str("$dialog = New-Object System.Windows.Forms.");
    script
}

#[tauri::command]
pub async fn pick_file(
    title: Option<String>,
    filter: Option<String>,
    initial_dir: Option<String>,
) -> Result<Option<String>, String> {
    let title = title.unwrap_or_else(|| "ファイルを選択".to_string());
    let filter = filter.unwrap_or_else(|| "すべてのファイル (*.*)|*.*".to_string());

    let mut script = prelude();
    script.push_str("OpenFileDialog\n");
    script.push_str(&format!("$dialog.Title = '{}'\n", quote(&title)));
    script.push_str(&format!("$dialog.Filter = '{}'\n", quote(&filter)));
    script.push_str("$dialog.CheckFileExists = $true\n");
    if let Some(dir) = initial_dir.filter(|dir| !dir.trim().is_empty()) {
        script.push_str(&format!(
            "$dialog.InitialDirectory = '{}'\n",
            quote(dir.trim())
        ));
    }
    script.push_str(
        "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {\n\
         [Console]::Out.Write($dialog.FileName)\n}\n",
    );

    run_picker(&script).await
}

#[tauri::command]
pub async fn pick_folder(
    title: Option<String>,
    initial_dir: Option<String>,
) -> Result<Option<String>, String> {
    let title = title.unwrap_or_else(|| "フォルダを選択".to_string());

    let mut script = prelude();
    script.push_str("FolderBrowserDialog\n");
    script.push_str(&format!("$dialog.Description = '{}'\n", quote(&title)));
    script.push_str("$dialog.ShowNewFolderButton = $true\n");
    if let Some(dir) = initial_dir.filter(|dir| !dir.trim().is_empty()) {
        script.push_str(&format!("$dialog.SelectedPath = '{}'\n", quote(dir.trim())));
    }
    script.push_str(
        "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {\n\
         [Console]::Out.Write($dialog.SelectedPath)\n}\n",
    );

    run_picker(&script).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_quotes_are_escaped_for_powershell() {
        assert_eq!(quote("C:\\it's\\here"), "C:\\it''s\\here");
    }

    #[test]
    fn picker_scripts_use_the_forms_dialogs() {
        let script = prelude();
        assert!(script.contains("System.Windows.Forms."));
        assert!(script.contains("UTF8"));
    }

    #[tokio::test]
    async fn picker_returns_utf8_path_from_stdout() {
        let script = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n\
                      [Console]::Out.Write('C:\\テスト\\updates')\n";
        let picked = run_picker(script).await.unwrap();

        assert_eq!(picked.as_deref(), Some("C:\\テスト\\updates"));
    }

    #[tokio::test]
    async fn picker_reports_no_selection_as_none() {
        let picked = run_picker("1 | Out-Null").await.unwrap();

        assert!(picked.is_none());
    }
}
