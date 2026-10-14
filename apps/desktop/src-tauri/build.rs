fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "sidecar_send",
            "sidecar_status",
            "webchat_sync",
            "webchat_reload",
            "webchat_set_visible",
            "webchat_close_all",
        ]),
    ))
    .expect("failed to build the desktop command permission manifest");
}
