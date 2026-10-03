use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

use tauri::AppHandle;
#[cfg(not(debug_assertions))]
use tauri::Manager;
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
    #[cfg(any(not(debug_assertions), test))]
    #[error("could not locate bundled sidecar at {0}")]
    MissingPackagedSidecar(PathBuf),
}

#[cfg(any(not(debug_assertions), test))]
const PACKAGED_SIDECAR: &str = "itstudio-sidecar.exe";

#[cfg(any(not(debug_assertions), test))]
pub fn resolve_packaged_sidecar(resource_dir: &Path) -> Result<PathBuf, SpawnError> {
    let sidecar = resource_dir.join(PACKAGED_SIDECAR);
    if sidecar.is_file() {
        Ok(sidecar)
    } else {
        Err(SpawnError::MissingPackagedSidecar(sidecar))
    }
}

#[cfg(debug_assertions)]
pub fn command(_app: &AppHandle, data_dir: &Path) -> Result<Command, SpawnError> {
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
pub fn command(app: &AppHandle, data_dir: &Path) -> Result<Command, SpawnError> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|_| SpawnError::MissingPackagedSidecar(PathBuf::from(PACKAGED_SIDECAR)))?;
    let executable = resolve_packaged_sidecar(&resource_dir)?;
    let mut command = Command::new(executable);
    command
        .env("ITSTUDIO_DATA_DIR", data_dir)
        .env("ITSTUDIO_LOG_LEVEL", "info");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.as_std_mut().creation_flags(0x0800_0000);
    }

    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::{resolve_data_dir, resolve_packaged_sidecar, SpawnError};
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

    #[test]
    fn resolves_sidecar_in_installed_resource_directory() {
        let resource_dir =
            std::env::temp_dir().join(format!("itstudio-sidecar-layout-{}", std::process::id()));
        std::fs::create_dir_all(&resource_dir).expect("create resource fixture");
        let sidecar = resource_dir.join("itstudio-sidecar.exe");
        std::fs::write(&sidecar, b"fixture").expect("write sidecar fixture");

        assert_eq!(
            resolve_packaged_sidecar(&resource_dir).expect("resolve staged sidecar"),
            sidecar
        );

        std::fs::remove_dir_all(resource_dir).expect("remove resource fixture");
    }

    #[test]
    fn missing_packaged_sidecar_returns_clear_error() {
        let resource_dir =
            std::env::temp_dir().join(format!("itstudio-sidecar-missing-{}", std::process::id()));
        let error = resolve_packaged_sidecar(&resource_dir).expect_err("sidecar is absent");
        assert!(matches!(error, SpawnError::MissingPackagedSidecar(_)));
        assert!(error
            .to_string()
            .contains("could not locate bundled sidecar"));
    }
}
