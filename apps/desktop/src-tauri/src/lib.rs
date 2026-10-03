mod commands;
mod sidecar;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Manager, RunEvent};

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let default_data_dir = app.path().app_data_dir()?;
            let data_dir = sidecar::spawn::resolve_data_dir(
                default_data_dir,
                std::env::var_os("ITSTUDIO_DATA_DIR"),
            );
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(data_dir.join("logs"))?;

            let supervisor = sidecar::SupervisorHandle::start(app.handle().clone(), data_dir);
            app.manage(supervisor);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::sidecar_send,
            commands::sidecar_status
        ]);

    match builder.build(tauri::generate_context!()) {
        Ok(app) => {
            let shutdown_started = AtomicBool::new(false);
            app.run(move |app_handle, event| {
                if let RunEvent::ExitRequested { api, code, .. } = event {
                    let is_shutdown_started = shutdown_started.load(Ordering::SeqCst);
                    if !should_intercept_exit(code, is_shutdown_started) {
                        return;
                    }

                    let Some(supervisor) = app_handle
                        .try_state::<sidecar::SupervisorHandle>()
                        .map(|state| state.inner().clone())
                    else {
                        return;
                    };

                    api.prevent_exit();
                    if !shutdown_started.swap(true, Ordering::SeqCst) {
                        let app = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            supervisor.shutdown().await;
                            app.exit(0);
                        });
                    }
                }
            });
        }
        Err(error) => log::error!("failed to initialize IT Studio desktop shell: {error}"),
    }
}

fn should_intercept_exit(code: Option<i32>, _shutdown_started: bool) -> bool {
    // A code marks an intentional programmatic exit; user exit requests have no code.
    code.is_none()
}

#[cfg(test)]
mod tests {
    use super::should_intercept_exit;

    #[test]
    fn intercepts_user_exit_before_shutdown_starts() {
        assert!(should_intercept_exit(None, false));
    }

    #[test]
    fn continues_intercepting_user_exit_while_shutdown_is_in_progress() {
        assert!(should_intercept_exit(None, true));
    }

    #[test]
    fn allows_programmatic_exit_after_shutdown() {
        assert!(!should_intercept_exit(Some(0), false));
        assert!(!should_intercept_exit(Some(0), true));
    }
}
