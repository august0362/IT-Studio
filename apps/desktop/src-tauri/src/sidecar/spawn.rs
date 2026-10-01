use std::path::Path;

use thiserror::Error;
use tokio::process::Command;

#[derive(Debug, Error)]
pub enum SpawnError {
    #[cfg(debug_assertions)]
    #[error("could not resolve the repository root from CARGO_MANIFEST_DIR")]
    RepositoryRoot,
    #[cfg(not(debug_assertions))]
    #[error("packaged sidecar not implemented (M9)")]
    PackagedSidecar,
}

#[cfg(debug_assertions)]
pub fn command(data_dir: &Path) -> Result<Command, SpawnError> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repository_root = manifest_dir
        .ancestors()
        .nth(3)
        .ok_or(SpawnError::RepositoryRoot)?;
    let entrypoint = repository_root
        .join("apps")
        .join("sidecar")
        .join("src")
        .join("main.ts");

    let mut command = Command::new("node");
    command
        .current_dir(repository_root)
        .arg("--import")
        .arg("tsx")
        .arg(entrypoint)
        .env("ITSTUDIO_DATA_DIR", data_dir)
        .env("ITSTUDIO_LOG_LEVEL", "info");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.as_std_mut().creation_flags(0x0800_0000);
    }

    Ok(command)
}

#[cfg(not(debug_assertions))]
pub fn command(_data_dir: &Path) -> Result<Command, SpawnError> {
    Err(SpawnError::PackagedSidecar)
}
