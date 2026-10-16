use std::{
    collections::{BTreeMap, HashSet},
    net::IpAddr,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, RwLock,
    },
};

use serde::Deserialize;
use tauri::{
    webview::{NewWindowResponse, WebviewBuilder},
    AppHandle, LogicalPosition, LogicalSize, Manager, State, Url, Webview, WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

use crate::commands::require_main_webview;

const MAX_PANES: usize = 6;
const MAX_LINKS: usize = 40;
const MAX_BOUND: f64 = 32_768.0;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebChatLink {
    id: String,
    name: String,
    url: String,
    enabled: bool,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaneBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebChatPaneRequest {
    slot: u8,
    link_id: String,
    bounds: PaneBounds,
}

struct PlannedPane {
    url: Url,
    bounds: PaneBounds,
}

struct ActivePane {
    url: String,
    in_view: bool,
    bounds: PaneBounds,
}

pub struct WebChatState {
    panes: Mutex<BTreeMap<u8, ActivePane>>,
    allowed_origins: Arc<RwLock<HashSet<String>>>,
    visible: AtomicBool,
}

impl Default for WebChatState {
    fn default() -> Self {
        Self {
            panes: Mutex::new(BTreeMap::new()),
            allowed_origins: Arc::new(RwLock::new(HashSet::new())),
            visible: AtomicBool::new(true),
        }
    }
}

// These commands run asynchronously: add_child waits on the UI thread on Windows.
#[tauri::command]
pub async fn webchat_sync(
    webview: Webview,
    app: AppHandle,
    state: State<'_, WebChatState>,
    links: Vec<WebChatLink>,
    panes: Vec<WebChatPaneRequest>,
    active_slots: Option<Vec<u8>>,
) -> Result<(), String> {
    require_main_webview(webview.label())?;
    let (planned, origins) = plan_panes(&links, &panes)?;
    let retained = retained_slots(active_slots.as_deref(), &planned)?;
    let window = app
        .get_window("main")
        .ok_or("The main window is unavailable.")?;
    let scale = window
        .scale_factor()
        .map_err(|_| "Unable to read the window scale.")?;
    let viewport = window
        .inner_size()
        .map_err(|_| "Unable to read the window size.")?
        .to_logical::<f64>(scale);
    if planned.values().any(|pane| {
        pane.bounds.x + pane.bounds.width > viewport.width + 1.0
            || pane.bounds.y + pane.bounds.height > viewport.height + 1.0
    }) {
        return Err("Web-chat pane bounds must stay inside the app window.".into());
    }
    let mut active = state.panes.lock().await;
    let removed: Vec<u8> = active
        .iter()
        .filter(|(slot, pane)| {
            !retained.contains(slot)
                || Url::parse(&pane.url).map_or(true, |url| !navigation_allowed(&url, &origins))
        })
        .map(|(slot, _)| *slot)
        .collect();
    *state
        .allowed_origins
        .write()
        .map_err(|_| "The navigation guard is unavailable.")? = origins;
    for slot in removed {
        close_pane(&app, slot)?;
        active.remove(&slot);
    }
    for (slot, pane) in active.iter_mut() {
        if !planned.contains_key(slot) {
            pane.in_view = false;
            if let Some(child) = app.get_webview(&pane_label(*slot)) {
                child
                    .hide()
                    .map_err(|_| "Unable to hide an offscreen web-chat pane.")?;
            }
        }
    }
    for (slot, pane) in planned {
        let label = pane_label(slot);
        let changed = active
            .get(&slot)
            .is_some_and(|active| active.url != pane.url.as_str());
        if changed {
            close_pane(&app, slot)?;
            active.remove(&slot);
        }
        if let Some(child) = app.get_webview(&label) {
            child
                .set_position(LogicalPosition::new(pane.bounds.x, pane.bounds.y))
                .map_err(|_| "Unable to position a web-chat pane.")?;
            child
                .set_size(LogicalSize::new(pane.bounds.width, pane.bounds.height))
                .map_err(|_| "Unable to resize a web-chat pane.")?;
        } else {
            let profile = profile_directory(
                &app.path()
                    .app_data_dir()
                    .map_err(|_| "The app data directory is unavailable.")?,
                &pane.url,
            )?;
            std::fs::create_dir_all(&profile)
                .map_err(|_| "Unable to create the separate web-chat profile.")?;
            let allowed = Arc::clone(&state.allowed_origins);
            let popup_app = app.clone();
            let builder = WebviewBuilder::new(&label, WebviewUrl::External(pane.url.clone()))
                .data_directory(profile)
                .focused(false)
                .devtools(false)
                .disable_drag_drop_handler()
                .on_navigation(move |url| {
                    allowed
                        .read()
                        .is_ok_and(|origins| navigation_allowed(url, &origins))
                })
                .on_new_window(move |url, _features| {
                    if safe_https_url(url.as_str()).is_ok() {
                        let app = popup_app.clone();
                        tauri::async_runtime::spawn(async move {
                            if app
                                .opener()
                                .open_url(url.to_string(), None::<&str>)
                                .is_err()
                            {
                                log::warn!(
                                    "Unable to open a web-chat popup in the external browser."
                                );
                            }
                        });
                    }
                    NewWindowResponse::Deny
                });
            window
                .add_child(
                    builder,
                    LogicalPosition::new(pane.bounds.x, pane.bounds.y),
                    LogicalSize::new(pane.bounds.width, pane.bounds.height),
                )
                .map_err(|_| "Unable to create an isolated web-chat pane. Try Open in browser.")?;
        }
        if let Some(child) = app.get_webview(&label) {
            if state.visible.load(Ordering::SeqCst) {
                child
                    .show()
                    .map_err(|_| "Unable to show a web-chat pane.")?;
            } else {
                child
                    .hide()
                    .map_err(|_| "Unable to hide a web-chat pane.")?;
            }
        }
        active.insert(
            slot,
            ActivePane {
                url: pane.url.to_string(),
                in_view: true,
                bounds: pane.bounds,
            },
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn webchat_raise(
    webview: Webview,
    app: AppHandle,
    state: State<'_, WebChatState>,
    pane_id: u8,
) -> Result<(), String> {
    require_main_webview(webview.label())?;
    validate_slot(pane_id)?;
    let active = state.panes.lock().await;
    let pane = active.get(&pane_id).ok_or("raise target not found")?;
    #[cfg(windows)]
    {
        let window = app
            .get_webview_window("main")
            .ok_or("The main window is unavailable.")?;
        let hwnd = window
            .hwnd()
            .map_err(|_| "The main window HWND is unavailable.")?;
        let scale = window
            .scale_factor()
            .map_err(|_| "Unable to read the window scale.")?;
        let target = Rect {
            x: (pane.bounds.x * scale).round() as i32,
            y: (pane.bounds.y * scale).round() as i32,
            width: (pane.bounds.width * scale).round() as i32,
            height: (pane.bounds.height * scale).round() as i32,
        };
        zorder::raise(hwnd, target)?;
    }
    #[cfg(not(windows))]
    let _ = (app, pane);
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[cfg(windows)]
mod zorder {
    use super::Rect;
    use windows::Win32::{
        Foundation::{HWND, LPARAM, RECT},
        Graphics::Gdi::MapWindowPoints,
        UI::WindowsAndMessaging::{
            EnumChildWindows, GetClassNameW, GetParent, GetWindowRect, SetWindowPos, HWND_TOP,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        },
    };

    struct Collector {
        main: HWND,
        candidates: Vec<(isize, Rect)>,
    }

    pub fn pick_by_bounds(candidates: &[(isize, Rect)], target: Rect, tol: i32) -> Option<isize> {
        let mut matches = candidates.iter().filter(|(_, rect)| {
            (rect.x - target.x).abs() <= tol
                && (rect.y - target.y).abs() <= tol
                && (rect.width - target.width).abs() <= tol
                && (rect.height - target.height).abs() <= tol
        });
        let hwnd = matches.next()?.0;
        if matches.next().is_some() {
            None
        } else {
            Some(hwnd)
        }
    }

    pub fn raise(main: HWND, target: Rect) -> Result<(), String> {
        let mut collector = Collector {
            main,
            candidates: Vec::new(),
        };
        unsafe {
            let _ = EnumChildWindows(
                Some(main),
                Some(collect),
                LPARAM((&mut collector as *mut Collector) as isize),
            );
        }
        let hwnd =
            pick_by_bounds(&collector.candidates, target, 2).ok_or("raise target not found")?;
        unsafe {
            SetWindowPos(
                HWND(hwnd as *mut _),
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
        }
        .map_err(|_| "Unable to raise web-chat pane".to_string())
    }

    unsafe extern "system" fn collect(hwnd: HWND, data: LPARAM) -> windows::core::BOOL {
        let collector = unsafe { &mut *(data.0 as *mut Collector) };
        if unsafe { GetParent(hwnd) }.map_or(true, |parent| parent != collector.main) {
            return windows::core::BOOL(1);
        }
        let mut class = [0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, &mut class) };
        if len > 0
            && String::from_utf16_lossy(&class[..len as usize]).starts_with("Chrome_WidgetWin")
        {
            let mut rect = RECT::default();
            if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
                let mut points = [
                    windows::Win32::Foundation::POINT {
                        x: rect.left,
                        y: rect.top,
                    },
                    windows::Win32::Foundation::POINT {
                        x: rect.right,
                        y: rect.bottom,
                    },
                ];
                unsafe {
                    MapWindowPoints(None, Some(collector.main), &mut points);
                }
                collector.candidates.push((
                    hwnd.0 as isize,
                    Rect {
                        x: points[0].x,
                        y: points[0].y,
                        width: points[1].x - points[0].x,
                        height: points[1].y - points[0].y,
                    },
                ));
            }
        }
        windows::core::BOOL(1)
    }
}

#[tauri::command]
pub async fn webchat_set_visible(
    webview: Webview,
    app: AppHandle,
    state: State<'_, WebChatState>,
    visible: bool,
) -> Result<(), String> {
    require_main_webview(webview.label())?;
    let active = state.panes.lock().await;
    state.visible.store(visible, Ordering::SeqCst);
    for (slot, pane) in active.iter() {
        if let Some(child) = app.get_webview(&pane_label(*slot)) {
            if visible && pane.in_view {
                child
                    .show()
                    .map_err(|_| "Unable to show a web-chat pane.")?;
            } else {
                child
                    .hide()
                    .map_err(|_| "Unable to hide a web-chat pane.")?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn webchat_reload(
    webview: Webview,
    app: AppHandle,
    state: State<'_, WebChatState>,
    slot: u8,
) -> Result<(), String> {
    require_main_webview(webview.label())?;
    validate_slot(slot)?;
    let active = state.panes.lock().await;
    if !active.contains_key(&slot) {
        return Err("This web-chat pane is not open.".into());
    }
    app.get_webview(&pane_label(slot))
        .ok_or("This web-chat pane is unavailable.")?
        .reload()
        .map_err(|_| "Unable to reload the web-chat pane.".into())
}

#[tauri::command]
pub async fn webchat_set_pane_visible(
    webview: Webview,
    app: AppHandle,
    state: State<'_, WebChatState>,
    slot: u8,
    visible: bool,
) -> Result<(), String> {
    require_main_webview(webview.label())?;
    validate_slot(slot)?;
    let active = state.panes.lock().await;
    if !active.contains_key(&slot) {
        return Err("This web-chat pane is not open.".into());
    }
    let child = app
        .get_webview(&pane_label(slot))
        .ok_or("This web-chat pane is unavailable.")?;
    if visible { child.show() } else { child.hide() }
        .map_err(|_| "Unable to change web-chat pane visibility.".into())
}

#[tauri::command]
pub async fn webchat_close_all(
    webview: Webview,
    app: AppHandle,
    state: State<'_, WebChatState>,
) -> Result<(), String> {
    require_main_webview(webview.label())?;
    let mut active = state.panes.lock().await;
    *state
        .allowed_origins
        .write()
        .map_err(|_| "The navigation guard is unavailable.")? = HashSet::new();
    let slots: Vec<u8> = active.keys().copied().collect();
    for slot in slots {
        close_pane(&app, slot)?;
        active.remove(&slot);
    }
    state.visible.store(true, Ordering::SeqCst);
    Ok(())
}

fn retained_slots(
    active_slots: Option<&[u8]>,
    planned: &BTreeMap<u8, PlannedPane>,
) -> Result<HashSet<u8>, String> {
    let Some(slots) = active_slots else {
        return Ok(planned.keys().copied().collect());
    };
    if slots.len() > MAX_PANES {
        return Err("Web chat supports at most six active slots.".into());
    }
    let mut retained = HashSet::new();
    for slot in slots {
        validate_slot(*slot)?;
        if !retained.insert(*slot) {
            return Err("Active web-chat slots must be unique.".into());
        }
    }
    if planned.keys().any(|slot| !retained.contains(slot)) {
        return Err("Visible web-chat panes must be included in active slots.".into());
    }
    Ok(retained)
}

fn close_pane(app: &AppHandle, slot: u8) -> Result<(), String> {
    if let Some(child) = app.get_webview(&pane_label(slot)) {
        child
            .close()
            .map_err(|_| "Unable to close a web-chat pane.")?;
    }
    Ok(())
}

fn pane_label(slot: u8) -> String {
    format!("webchat-pane-{slot}")
}

fn validate_slot(slot: u8) -> Result<(), String> {
    if usize::from(slot) >= MAX_PANES {
        return Err("Web-chat pane slots must be between 0 and 5.".into());
    }
    Ok(())
}

fn validate_bounds(bounds: PaneBounds) -> Result<(), String> {
    if [bounds.x, bounds.y, bounds.width, bounds.height]
        .iter()
        .any(|value| !value.is_finite() || *value > MAX_BOUND)
        || bounds.x < 0.0
        || bounds.y < 0.0
        || bounds.width <= 0.0
        || bounds.height <= 0.0
        || bounds.x + bounds.width > MAX_BOUND
        || bounds.y + bounds.height > MAX_BOUND
    {
        return Err(
            "Web-chat bounds require finite non-negative positions and positive sizes.".into(),
        );
    }
    Ok(())
}

fn plan_panes(
    links: &[WebChatLink],
    panes: &[WebChatPaneRequest],
) -> Result<(BTreeMap<u8, PlannedPane>, HashSet<String>), String> {
    if links.len() > MAX_LINKS || panes.len() > MAX_PANES {
        return Err("Web chat supports at most 40 saved links and six panes.".into());
    }
    let mut saved = BTreeMap::new();
    let mut origins = HashSet::new();
    let mut ids = HashSet::new();
    for link in links {
        if link.id.is_empty()
            || link.name.trim().is_empty()
            || link.name.encode_utf16().count() > 40
            || !ids.insert(link.id.as_str())
        {
            return Err("Saved web-chat links need unique valid ids and names.".into());
        }
        if link.enabled {
            let url = safe_https_url(&link.url)?;
            origins.insert(url.origin().ascii_serialization());
            saved.insert(link.id.as_str(), url);
        }
    }
    let mut planned = BTreeMap::new();
    for pane in panes {
        validate_slot(pane.slot)?;
        validate_bounds(pane.bounds)?;
        let url = saved
            .get(pane.link_id.as_str())
            .ok_or("Select an enabled saved HTTPS web-chat link.")?;
        if planned
            .insert(
                pane.slot,
                PlannedPane {
                    url: url.clone(),
                    bounds: pane.bounds,
                },
            )
            .is_some()
        {
            return Err("Web-chat pane slots must be unique.".into());
        }
    }
    Ok((planned, origins))
}

fn safe_https_url(value: &str) -> Result<Url, String> {
    let invalid = || "Use a public HTTPS URL without credentials or local/IP hosts.".to_string();
    if value.is_empty()
        || value.len() > 2048
        || value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err(invalid());
    }
    let url = Url::parse(value).map_err(|_| invalid())?;
    if url.as_str().len() > 2048 {
        return Err(invalid());
    }
    let host = url.host_str().ok_or_else(invalid)?.trim_end_matches('.');
    let ip_host = host.trim_matches(['[', ']']).parse::<IpAddr>().is_ok();
    let labels_valid = host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
    });
    let local = !host.contains('.')
        || host == "localhost"
        || [".localhost", ".local", ".internal", ".lan", ".home.arpa"]
            .iter()
            .any(|suffix| host.ends_with(suffix));
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || ip_host
        || local
        || host.len() > 253
        || !labels_valid
    {
        return Err(invalid());
    }
    Ok(url)
}

fn navigation_allowed(url: &Url, origins: &HashSet<String>) -> bool {
    safe_https_url(url.as_str()).is_ok() && origins.contains(&url.origin().ascii_serialization())
}

fn profile_directory(app_data: &Path, url: &Url) -> Result<PathBuf, String> {
    let host = url.host_str().ok_or("The web-chat host is unavailable.")?;
    // Hosts passed here are DNS-only and already validated, never file-system paths.
    if !host
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-'))
    {
        return Err("The web-chat profile host is invalid.".into());
    }
    // Prefixes avoid Windows device names; long DNS names need a shorter path component.
    let folder = if host.len() <= 120 {
        format!("site-{host}")
    } else {
        // Fixed FNV-1a 64-bit constants keep these profile names stable across versions.
        let suffix = host
            .as_bytes()
            .iter()
            .fold(0xcbf29ce484222325_u64, |hash, byte| {
                (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
            });
        format!("site-{}-{suffix:016x}", &host[..100])
    };
    Ok(app_data.join("webchat").join("profile").join(folder))
}

#[cfg(test)]
#[path = "webchat_tests.rs"]
mod tests;
