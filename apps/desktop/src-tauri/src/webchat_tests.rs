use super::{
    navigation_allowed, pane_label, plan_panes, profile_directory, retained_slots, safe_https_url,
    validate_bounds, validate_slot, PaneBounds, WebChatLink, WebChatPaneRequest,
};
use std::{collections::HashSet, path::Path};

fn links() -> Vec<WebChatLink> {
    vec![
        WebChatLink {
            id: "chatgpt".into(),
            name: "ChatGPT".into(),
            url: "https://chatgpt.com/".into(),
            enabled: true,
        },
        WebChatLink {
            id: "disabled".into(),
            name: "Disabled".into(),
            url: "https://disabled.example/".into(),
            enabled: false,
        },
    ]
}

#[test]
fn hidden_retained_slots_are_preserved_but_removed_layout_slots_are_closed() {
    let (planned, _) = plan_panes(&links(), &[pane(0, "chatgpt")]).expect("valid plan");
    assert_eq!(
        retained_slots(None, &planned).expect("old behavior"),
        HashSet::from([0])
    );
    assert_eq!(
        retained_slots(Some(&[0, 1]), &planned).expect("offscreen retained slot"),
        HashSet::from([0, 1])
    );
    assert!(retained_slots(Some(&[1]), &planned).is_err());
    assert!(retained_slots(Some(&[0, 0]), &planned).is_err());
    assert!(retained_slots(Some(&[0, 4]), &planned).is_err());
}

fn pane(slot: u8, link_id: &str) -> WebChatPaneRequest {
    WebChatPaneRequest {
        slot,
        link_id: link_id.into(),
        bounds: PaneBounds {
            x: 100.0,
            y: 200.0,
            width: 500.0,
            height: 300.0,
        },
    }
}

#[test]
fn accepts_only_public_https_without_credentials() {
    assert!(safe_https_url("https://chatgpt.com/new?q=hello").is_ok());
    assert!(safe_https_url("https://example.org:8443/chat").is_ok());
    for url in [
        "",
        "http://chatgpt.com/",
        "file:///C:/data",
        "javascript:alert(1)",
        "about:blank",
        "https://user:pass@chatgpt.com/",
        "https://user@chatgpt.com/",
        "https://localhost/",
        "https://foo.localhost/",
        "https://localhost./",
        "https://machine.local/",
        "https://host.internal/",
        "https://host.home.arpa/",
        "https://intranet/",
        "https://127.0.0.1/",
        "https://10.0.0.1/",
        "https://[::1]/",
        "https://2130706433/",
        "https://0x7f000001/",
        "https://example.org /",
        "https://example.org\n/",
        "https://bad_label.example/",
    ] {
        assert!(safe_https_url(url).is_err(), "must reject {url}");
    }
    assert!(safe_https_url(&format!("https://example.org/{}", "x".repeat(2048))).is_err());
}

#[test]
fn raw_and_normalized_unicode_urls_have_consistent_utf8_byte_bounds() {
    let accepted = format!("https://example.com/{}", "é".repeat(338));
    let url = safe_https_url(&accepted).expect("valid normalized URL at the byte limit");
    assert_eq!(url.as_str().len(), 2048);
    let origins = HashSet::from([url.origin().ascii_serialization()]);
    assert!(
        navigation_allowed(&url, &origins),
        "an already accepted saved URL must be allowed at navigation"
    );
    assert!(safe_https_url(&format!("{accepted}a")).is_err());
    let raw_too_long = format!("https://example.com/{}", "é".repeat(1025));
    assert!(raw_too_long.encode_utf16().count() < 2048);
    assert!(raw_too_long.len() > 2048);
    assert!(safe_https_url(&raw_too_long).is_err());
}

#[test]
fn unicode_and_custom_link_ids_remain_lookup_keys_with_no_path_restrictions() {
    for id in [
        "trò chuyện / mục #1".to_string(),
        "custom/id.with/punctuation".to_string(),
        "x".repeat(128),
    ] {
        let mut saved = links();
        saved[0].id = id.clone();
        assert!(plan_panes(&saved, &[pane(0, &id)]).is_ok());
        saved[1].id = id.clone();
        assert!(plan_panes(&saved, &[pane(0, &id)]).is_err());
    }
    let mut empty = links();
    empty[0].id.clear();
    assert!(plan_panes(&empty, &[pane(0, "")]).is_err());
}

#[test]
fn navigation_is_restricted_to_exact_enabled_saved_origins() {
    let (_, origins) = plan_panes(&links(), &[pane(0, "chatgpt")]).expect("valid plan");
    for url in [
        "https://chatgpt.com/",
        "https://chatgpt.com/conversation/123",
        "https://chatgpt.com:443/app",
    ] {
        assert!(navigation_allowed(
            &safe_https_url(url).expect("valid HTTPS"),
            &origins
        ));
    }
    for url in [
        "http://chatgpt.com/",
        "https://chatgpt.com:8443/",
        "https://evil.chatgpt.com/",
        "https://chatgpt.com.evil.example/",
        "https://accounts.google.com/",
        "https://disabled.example/",
    ] {
        assert!(!navigation_allowed(
            &tauri::Url::parse(url).expect("parse URL"),
            &origins
        ));
    }
    assert!(!navigation_allowed(
        &tauri::Url::parse("https://chatgpt.com/").expect("parse URL"),
        &HashSet::new()
    ));
}

#[test]
fn initial_panes_require_enabled_saved_link_ids_and_unique_slots() {
    let saved = links();
    assert!(plan_panes(&saved, &[pane(0, "chatgpt"), pane(3, "chatgpt")]).is_ok());
    assert!(plan_panes(&saved, &[]).is_ok());
    assert!(plan_panes(&saved, &[pane(0, "disabled")]).is_err());
    assert!(plan_panes(&saved, &[pane(0, "unknown")]).is_err());
    assert!(plan_panes(&saved, &[pane(0, "chatgpt"), pane(0, "chatgpt")]).is_err());
    assert!(plan_panes(&saved, &[pane(4, "chatgpt")]).is_err());
    let mut duplicate_links = links();
    duplicate_links[1].id = "chatgpt".into();
    assert!(plan_panes(&duplicate_links, &[pane(0, "chatgpt")]).is_err());
    let mut invalid_link = links();
    invalid_link[0].url = "https://localhost/".into();
    assert!(plan_panes(&invalid_link, &[pane(0, "chatgpt")]).is_err());
}

#[test]
fn rejects_invalid_slots_and_nonfinite_negative_or_empty_bounds() {
    for slot in 0..=3 {
        assert!(validate_slot(slot).is_ok());
    }
    for slot in [4, 255] {
        assert!(validate_slot(slot).is_err());
    }
    let valid = pane(0, "chatgpt").bounds;
    assert!(validate_bounds(valid).is_ok());
    for bounds in [
        PaneBounds {
            x: f64::NAN,
            ..valid
        },
        PaneBounds {
            y: f64::INFINITY,
            ..valid
        },
        PaneBounds { x: -1.0, ..valid },
        PaneBounds { y: -1.0, ..valid },
        PaneBounds {
            width: 0.0,
            ..valid
        },
        PaneBounds {
            height: -1.0,
            ..valid
        },
        PaneBounds {
            width: 32769.0,
            ..valid
        },
        PaneBounds {
            x: 32768.0,
            ..valid
        },
    ] {
        assert!(validate_bounds(bounds).is_err());
    }
}

#[test]
fn web_chat_profiles_are_separate_from_main_and_safe_for_reuse() {
    let root = Path::new("C:/app-data");
    let url = safe_https_url("https://chatgpt.com/").expect("valid URL");
    let directory = profile_directory(root, &url).expect("profile");
    assert_eq!(
        directory,
        root.join("webchat")
            .join("profile")
            .join("site-chatgpt.com")
    );
    assert!(directory.starts_with(root.join("webchat").join("profile")));
    assert_ne!(directory, root);
    assert_eq!(pane_label(3), "webchat-pane-3");
}

#[test]
fn valid_public_device_name_hosts_use_safe_windows_profile_paths() {
    let root = Path::new("C:/app-data");
    for host in ["con.com", "aux.example", "nul.org", "com1.example"] {
        let url = safe_https_url(&format!("https://{host}/")).expect("valid public DNS host");
        let directory = profile_directory(root, &url).expect("safe prefixed profile");
        assert_eq!(
            directory.file_name().expect("profile folder"),
            format!("site-{host}").as_str()
        );
    }
}

#[test]
fn maximum_dns_hosts_get_short_stable_distinct_windows_profile_components() {
    let root = Path::new("C:/app-data");
    let label = "a".repeat(63);
    let host = format!("{label}.{label}.{label}.{}", "a".repeat(61));
    assert_eq!(host.len(), 253);
    let url =
        safe_https_url(&format!("https://{host}/")).expect("valid maximum-length public host");
    let profile = profile_directory(root, &url).expect("short safe profile");
    assert!(
        profile
            .file_name()
            .expect("folder")
            .to_str()
            .expect("ASCII folder")
            .len()
            <= 128
    );
    assert_eq!(
        profile_directory(root, &url).expect("stable profile"),
        profile
    );
    let changed_host = format!("{}b", &host[..host.len() - 1]);
    let changed = safe_https_url(&format!("https://{changed_host}/")).expect("second valid host");
    assert_ne!(
        profile_directory(root, &changed).expect("distinct profile"),
        profile
    );
}

#[test]
fn all_children_have_an_empty_capability_set() {
    let capability: serde_json::Value =
        serde_json::from_str(include_str!("../capabilities/default.json"))
            .expect("valid capability");
    assert!(
        capability.get("windows").is_none(),
        "window-level permissions would include child webviews"
    );
    assert!(
        capability.get("remote").is_none(),
        "remote pages must never gain capabilities"
    );
    let webviews = capability["webviews"]
        .as_array()
        .expect("explicit webview labels");
    assert_eq!(webviews, &vec![serde_json::json!("main")]);
    for slot in 0..4 {
        assert!(!webviews
            .iter()
            .any(|value| value.as_str() == Some(pane_label(slot).as_str())));
    }
}
