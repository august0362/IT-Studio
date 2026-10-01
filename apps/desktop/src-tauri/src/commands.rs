use tauri::State;

use crate::sidecar::{SidecarStatus, SupervisorHandle, MAX_LINE_BYTES};

#[tauri::command]
pub async fn sidecar_send(
    line: String,
    supervisor: State<'_, SupervisorHandle>,
) -> Result<(), String> {
    validate_line(&line)?;
    supervisor.send_line(line).await
}

#[tauri::command]
pub fn sidecar_status(supervisor: State<'_, SupervisorHandle>) -> Result<SidecarStatus, String> {
    supervisor.status()
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
    use super::{validate_line, MAX_LINE_BYTES};

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
