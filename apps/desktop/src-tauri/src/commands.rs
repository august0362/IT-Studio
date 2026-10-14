use tauri::{State, Webview};

use crate::sidecar::{SidecarStatus, SupervisorHandle, MAX_LINE_BYTES};

#[tauri::command]
pub async fn sidecar_send(
    line: String,
    webview: Webview,
    supervisor: State<'_, SupervisorHandle>,
) -> Result<(), String> {
    require_main_webview(webview.label())?;
    validate_line(&line)?;
    supervisor.send_line(line).await
}

#[tauri::command]
pub async fn sidecar_status(
    webview: Webview,
    supervisor: State<'_, SupervisorHandle>,
) -> Result<SidecarStatus, String> {
    require_main_webview(webview.label())?;
    supervisor.status()
}

pub(crate) fn require_main_webview(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err("This command is available only to the main app webview.".to_string())
    }
}

fn validate_line(line: &str) -> Result<(), String> {
    if line.len() > MAX_LINE_BYTES {
        return Err("sidecar message exceeds the 8 MiB limit".to_string());
    }
    if line.contains('\n') {
        return Err("sidecar message must contain exactly one line".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{require_main_webview, validate_line, MAX_LINE_BYTES};

    #[test]
    fn child_webviews_cannot_access_sidecar_or_management_commands() {
        assert!(require_main_webview("main").is_ok());
        for label in ["webchat-pane-0", "webchat-pane-1", "main-other", ""] {
            assert!(require_main_webview(label).is_err());
        }
    }

    #[test]
    fn send_validation_accepts_a_line_at_the_limit() {
        assert!(validate_line(&"a".repeat(MAX_LINE_BYTES)).is_ok());
    }

    #[test]
    fn send_validation_rejects_lines_over_the_limit() {
        assert!(validate_line(&"a".repeat(MAX_LINE_BYTES + 1)).is_err());
    }

    #[test]
    fn send_validation_rejects_embedded_newlines() {
        assert!(validate_line("{\"method\":\"x\"}\n{}").is_err());
    }
}
