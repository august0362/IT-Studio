mod line_codec;
pub(crate) mod spawn;

use std::{
    path::PathBuf,
    process::Stdio,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use line_codec::{LineCodec, LineCodecError};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStdin},
    sync::{mpsc, oneshot},
    time::{sleep, timeout},
};

const RESTART_WINDOW: Duration = Duration::from_secs(5 * 60);
const MAX_RESTARTS_IN_WINDOW: usize = 5;
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
pub const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
const SHUTDOWN_LINE: &str =
    "{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"system.shutdown\",\"params\":{}}";

#[derive(Clone, Copy, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    pub running: bool,
    pub ready: bool,
    pub restarts: u32,
}

#[derive(Clone)]
pub struct SupervisorHandle {
    control: mpsc::Sender<Control>,
    status: Arc<Mutex<SidecarStatus>>,
}

enum Control {
    Send(String, oneshot::Sender<Result<(), String>>),
    Shutdown(oneshot::Sender<()>),
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FatalPayload {
    message: String,
    log_dir: PathBuf,
}

impl SupervisorHandle {
    pub fn start(app: AppHandle, data_dir: PathBuf) -> Self {
        let (control, receiver) = mpsc::channel(64);
        let status = Arc::new(Mutex::new(SidecarStatus::default()));
        let handle = Self {
            control,
            status: Arc::clone(&status),
        };
        tauri::async_runtime::spawn(supervise(app, data_dir, receiver, status));
        handle
    }

    pub async fn send_line(&self, line: String) -> Result<(), String> {
        let (reply, response) = oneshot::channel();
        self.control
            .send(Control::Send(line, reply))
            .await
            .map_err(|_| "sidecar supervisor is unavailable".to_string())?;
        response
            .await
            .map_err(|_| "sidecar supervisor stopped before writing the message".to_string())?
    }

    pub fn status(&self) -> Result<SidecarStatus, String> {
        self.status
            .lock()
            .map(|status| *status)
            .map_err(|_| "sidecar status is unavailable".to_string())
    }

    pub async fn shutdown(&self) {
        let (reply, response) = oneshot::channel();
        if self.control.send(Control::Shutdown(reply)).await.is_ok() {
            let _ = response.await;
        }
    }
}

async fn supervise(
    app: AppHandle,
    data_dir: PathBuf,
    mut control: mpsc::Receiver<Control>,
    status: Arc<Mutex<SidecarStatus>>,
) {
    let mut restart_times = Vec::new();

    loop {
        let child_result = spawn::command(&app, &data_dir)
            .map_err(|error| error.to_string())
            .map(|mut command| {
                command
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                command
            });
        let child_result = match child_result {
            Ok(mut command) => command.spawn().map_err(|error| error.to_string()),
            Err(error) => Err(error),
        };

        match child_result {
            Ok(child) => match run_child(&app, child, &mut control, &status).await {
                ChildExit::Requested => return,
                ChildExit::Unexpected(reason) => {
                    log::warn!("sidecar exited unexpectedly: {reason}");
                }
            },
            Err(error) => {
                log::error!("failed to spawn sidecar: {error}");
                update_status(&app, &status, |current| {
                    current.running = false;
                    current.ready = false;
                });
            }
        }

        let next_restart_count = match status.lock() {
            Ok(current) => current.restarts.saturating_add(1),
            Err(_) => {
                log::error!("sidecar status lock is poisoned; stopping supervision");
                return;
            }
        };
        let delay = restart_delay(next_restart_count);
        log::info!("restarting sidecar in {} seconds", delay.as_secs());
        if !wait_before_restart(delay, &mut control).await {
            return;
        }

        let now = Instant::now();
        restart_times.retain(|started| match now.checked_duration_since(*started) {
            Some(age) => age <= RESTART_WINDOW,
            None => true,
        });
        if !restart_limit_allows(&restart_times, now) {
            emit_fatal(&app, &data_dir);
            return;
        }
        restart_times.push(now);

        match status.lock() {
            Ok(mut current) => {
                current.restarts = next_restart_count;
                let snapshot = *current;
                drop(current);
                emit_status(&app, snapshot);
            }
            Err(_) => {
                log::error!("sidecar status lock is poisoned; stopping supervision");
                return;
            }
        }
    }
}

enum ChildExit {
    Requested,
    Unexpected(String),
}

async fn run_child(
    app: &AppHandle,
    mut child: Child,
    control: &mut mpsc::Receiver<Control>,
    status: &Arc<Mutex<SidecarStatus>>,
) -> ChildExit {
    let Some(mut stdin) = child.stdin.take() else {
        log::error!("sidecar stdin pipe is unavailable");
        terminate_child(&mut child).await;
        return ChildExit::Unexpected("missing stdin pipe".to_string());
    };
    let Some(stdout) = child.stdout.take() else {
        log::error!("sidecar stdout pipe is unavailable");
        terminate_child(&mut child).await;
        return ChildExit::Unexpected("missing stdout pipe".to_string());
    };
    let Some(stderr) = child.stderr.take() else {
        log::error!("sidecar stderr pipe is unavailable");
        terminate_child(&mut child).await;
        return ChildExit::Unexpected("missing stderr pipe".to_string());
    };

    update_status(app, status, |current| {
        current.running = true;
        current.ready = false;
    });

    let stdout_task = tokio::spawn(read_stdout(stdout, app.clone(), Arc::clone(status)));
    let stderr_task = tokio::spawn(read_stderr(stderr));

    let exit = loop {
        tokio::select! {
            result = child.wait() => {
                break match result {
                    Ok(status) => ChildExit::Unexpected(format!("process status {status}")),
                    Err(error) => {
                        log::error!("failed waiting for sidecar process: {error}");
                        terminate_child(&mut child).await;
                        ChildExit::Unexpected(format!("wait failed: {error}"))
                    },
                };
            }
            message = control.recv() => {
                match message {
                    Some(Control::Send(line, reply)) => {
                        let result = write_line(&mut stdin, &line).await;
                        let failed = result.is_err();
                        let _ = reply.send(result);
                        if failed {
                            terminate_child(&mut child).await;
                            break ChildExit::Unexpected("failed writing to sidecar stdin".to_string());
                        }
                    }
                    Some(Control::Shutdown(reply)) => {
                        let _ = write_line(&mut stdin, SHUTDOWN_LINE).await;
                        if !matches!(timeout(SHUTDOWN_TIMEOUT, child.wait()).await, Ok(Ok(_))) {
                            log::warn!("sidecar did not exit cleanly within the shutdown timeout");
                            terminate_child(&mut child).await;
                        }
                        let _ = reply.send(());
                        break ChildExit::Requested;
                    }
                    None => {
                        log::warn!("sidecar control channel closed; shutting down child");
                        terminate_child(&mut child).await;
                        break ChildExit::Requested;
                    }
                }
            }
        }
    };

    update_status(app, status, |current| {
        current.running = false;
        current.ready = false;
    });
    if let Err(error) = stdout_task.await {
        log::warn!("sidecar stdout reader stopped: {error}");
    }
    if let Err(error) = stderr_task.await {
        log::warn!("sidecar stderr reader stopped: {error}");
    }
    exit
}

async fn terminate_child(child: &mut Child) {
    if let Ok(Some(_)) = child.try_wait() {
        return;
    }
    if let Err(error) = child.kill().await {
        log::warn!("failed to kill sidecar process: {error}");
    }
    if let Err(error) = child.wait().await {
        log::warn!("failed to reap sidecar process: {error}");
    }
}

async fn write_line(stdin: &mut ChildStdin, line: &str) -> Result<(), String> {
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|error| format!("failed to write to sidecar stdin: {error}"))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|error| format!("failed to terminate sidecar message: {error}"))?;
    stdin
        .flush()
        .await
        .map_err(|error| format!("failed to flush sidecar stdin: {error}"))
}

async fn read_stdout<R>(reader: R, app: AppHandle, status: Arc<Mutex<SidecarStatus>>)
where
    R: AsyncRead + Unpin,
{
    read_lines(reader, |line| {
        if is_ready_notification(&line) {
            update_status(&app, &status, |current| {
                if current.running {
                    current.ready = true;
                }
            });
        }
        if let Err(error) = app.emit("sidecar://message", line) {
            log::error!("failed to emit sidecar message: {error}");
        }
    })
    .await;
}

async fn read_stderr<R>(reader: R)
where
    R: AsyncRead + Unpin,
{
    read_lines(reader, log_sidecar_stderr).await;
}

async fn read_lines<R, F>(mut reader: R, mut on_line: F)
where
    R: AsyncRead + Unpin,
    F: FnMut(String),
{
    let mut codec = LineCodec::default();
    let mut chunk = [0_u8; 8192];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) => break,
            Ok(read) => {
                for line in codec.push(&chunk[..read]) {
                    match line {
                        Ok(line) => on_line(line),
                        Err(error) => log_codec_error(error),
                    }
                }
            }
            Err(error) => {
                log::error!("failed reading sidecar pipe: {error}");
                break;
            }
        }
    }
    if let Some(line) = codec.finish() {
        match line {
            Ok(line) => on_line(line),
            Err(error) => log_codec_error(error),
        }
    }
}

fn log_codec_error(error: LineCodecError) {
    log::error!("discarded sidecar output: {error}");
}

fn is_ready_notification(line: &str) -> bool {
    serde_json::from_str::<Value>(line)
        .ok()
        .and_then(|value| {
            value
                .get("method")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .is_some_and(|method| method == "system.ready")
}

fn log_sidecar_stderr(line: String) {
    let level = serde_json::from_str::<Value>(&line)
        .ok()
        .and_then(|value| value.get("level").cloned());
    match level {
        Some(Value::Number(level)) => match level.as_u64() {
            Some(10) => log::trace!("sidecar: {line}"),
            Some(20) => log::debug!("sidecar: {line}"),
            Some(30) => log::info!("sidecar: {line}"),
            Some(40) => log::warn!("sidecar: {line}"),
            Some(50 | 60) => log::error!("sidecar: {line}"),
            _ => log::info!("sidecar: {line}"),
        },
        Some(Value::String(level)) => match level.to_ascii_lowercase().as_str() {
            "trace" => log::trace!("sidecar: {line}"),
            "debug" => log::debug!("sidecar: {line}"),
            "warn" | "warning" => log::warn!("sidecar: {line}"),
            "error" | "fatal" => log::error!("sidecar: {line}"),
            _ => log::info!("sidecar: {line}"),
        },
        _ => log::info!("sidecar: {line}"),
    }
}

fn update_status<F>(app: &AppHandle, status: &Arc<Mutex<SidecarStatus>>, update: F)
where
    F: FnOnce(&mut SidecarStatus),
{
    match status.lock() {
        Ok(mut current) => {
            let previous = *current;
            update(&mut current);
            if previous != *current {
                let snapshot = *current;
                drop(current);
                emit_status(app, snapshot);
            }
        }
        Err(_) => log::error!("sidecar status lock is poisoned"),
    }
}

fn emit_status(app: &AppHandle, status: SidecarStatus) {
    if let Err(error) = app.emit("sidecar://status", status) {
        log::error!("failed to emit sidecar status: {error}");
    }
}

fn emit_fatal(app: &AppHandle, data_dir: &std::path::Path) {
    let payload = FatalPayload {
        message: "Sidecar restarted more than 5 times within 5 minutes".to_string(),
        log_dir: data_dir.join("logs"),
    };
    if let Err(error) = app.emit("sidecar://fatal", payload) {
        log::error!("failed to emit sidecar fatal event: {error}");
    }
}

async fn wait_before_restart(delay: Duration, control: &mut mpsc::Receiver<Control>) -> bool {
    let timer = sleep(delay);
    tokio::pin!(timer);
    loop {
        tokio::select! {
            biased;
            message = control.recv() => match message {
                Some(Control::Send(_, reply)) => {
                    let _ = reply.send(Err("sidecar is restarting".to_string()));
                }
                Some(Control::Shutdown(reply)) => {
                    let _ = reply.send(());
                    return false;
                }
                None => return false,
            },
            _ = &mut timer => return true,
        }
    }
}

fn restart_delay(restart_count: u32) -> Duration {
    let exponent = restart_count.saturating_sub(1).min(4);
    Duration::from_secs(1_u64 << exponent)
}

fn restart_limit_allows(history: &[Instant], now: Instant) -> bool {
    let recent = history
        .iter()
        .filter(|started| match now.checked_duration_since(**started) {
            Some(age) => age <= RESTART_WINDOW,
            None => true,
        })
        .count();
    recent < MAX_RESTARTS_IN_WINDOW
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{restart_delay, restart_limit_allows};

    #[test]
    fn restart_backoff_doubles_and_caps_at_sixteen_seconds() {
        let actual: Vec<_> = (1..=7)
            .map(|count| restart_delay(count).as_secs())
            .collect();
        assert_eq!(actual, vec![1, 2, 4, 8, 16, 16, 16]);
    }

    #[test]
    fn restart_limit_allows_five_and_rejects_the_sixth_within_five_minutes() {
        let now = Instant::now();
        let five_recent: Vec<_> = (0..5)
            .map(|minutes| now - Duration::from_secs(minutes * 30))
            .collect();
        assert!(!restart_limit_allows(&five_recent, now));
        assert!(restart_limit_allows(&five_recent[..4], now));
    }

    #[test]
    fn restart_limit_discards_entries_older_than_five_minutes() {
        let now = Instant::now();
        let history = [now - Duration::from_secs(301)];
        assert!(restart_limit_allows(&history, now));
    }
}
