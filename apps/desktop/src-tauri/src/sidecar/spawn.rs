use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

use thiserror::Error;
use tokio::process::Command;

#[cfg(debug_assertions)]
pub fn resolve_data_dir(default_dir: PathBuf, override_dir: Option<OsString>) -> PathBuf {
    override_dir.map_or(default_dir, PathBuf::from)
}

#[cfg(not(debug_assertions))]
pub fn resolve_data_dir(default_dir: PathBuf, _override_dir: Option<OsString>) -> PathBuf {
    default_dir
}

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

#[cfg(test)]
mod tests {
    use super::resolve_data_dir;
    use std::{ffi::OsString, path::PathBuf};

    #[test]
    fn data_dir_resolution_respects_build_mode() {
        let default_dir = PathBuf::from("default-data");
        let resolved = resolve_data_dir(default_dir, Some(OsString::from("isolated-data")));

        if cfg!(debug_assertions) {
            assert_eq!(resolved, PathBuf::from("isolated-data"));
        } else {
            assert_eq!(resolved, PathBuf::from("default-data"));
        }
    }

    #[test]
    fn data_dir_resolution_uses_default_without_override() {
        let default_dir = PathBuf::from("default-data");
        assert_eq!(resolve_data_dir(default_dir.clone(), None), default_dir);
    }
}
