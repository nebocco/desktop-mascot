mod images;
mod logging;
mod png;

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;
use tracing::{debug, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowPosition {
    x: i32,
    y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowSize {
    width: i32,
    height: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ImagePaths {
    typing1: String,
    typing2: String,
    idle: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct Settings {
    #[serde(rename = "windowPosition")]
    window_position: WindowPosition,
    #[serde(rename = "windowSize")]
    window_size: WindowSize,
    #[serde(rename = "animationSpeed")]
    animation_speed: i32,
    images: ImagePaths,
    opacity: f32,
    #[serde(rename = "alwaysOnTop")]
    always_on_top: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            window_position: WindowPosition { x: 100, y: 100 },
            window_size: WindowSize {
                width: 200,
                height: 200,
            },
            animation_speed: 200,
            images: ImagePaths {
                typing1: String::new(),
                typing2: String::new(),
                idle: String::new(),
            },
            opacity: 1.0,
            always_on_top: true,
        }
    }
}

/// Returns the settings file path, creating the config directory if needed.
fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    Ok(config_dir.join("settings.json"))
}

/// Parses the settings JSON, falling back to defaults when the file is
/// corrupted or unparsable so the app can always start.
fn parse_settings_or_default(contents: &str) -> Settings {
    // 設定ファイルが壊れていてもアプリが起動不能にならないよう、
    // パース失敗時はデフォルト設定で継続する
    serde_json::from_str(contents).unwrap_or_else(|_| Settings::default())
}

/// Replaces only the window position in the given settings JSON,
/// preserving every other field.
///
/// Fails instead of falling back to defaults when the contents cannot be
/// parsed. Unlike reading, writing back a default would destroy a file
/// the user could still repair by hand.
fn settings_json_with_position(contents: &str, x: i32, y: i32) -> Result<String, String> {
    let mut settings = if contents.trim().is_empty() {
        Settings::default()
    } else {
        serde_json::from_str(contents)
            .map_err(|e| format!("Refusing to overwrite unparsable settings file: {}", e))?
    };
    settings.window_position = WindowPosition { x, y };
    serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let settings_path = settings_path(&app)?;

    if settings_path.exists() {
        let contents = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings file: {}", e))?;

        let settings = parse_settings_or_default(&contents);
        debug!(path = ?settings_path, ?settings, "loaded settings from file");
        Ok(settings)
    } else {
        debug!(path = ?settings_path, "settings file missing; using defaults");
        Ok(Settings::default())
    }
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let settings_path = settings_path(&app)?;
    debug!(path = ?settings_path, ?settings, "saving settings");

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&settings_path, json).map_err(|e| format!("Failed to write settings file: {}", e))?;

    // 画像は選択された時点でコピー済みなので、保存が確定したこの時点で
    // 参照されなくなったファイルを片付ける
    let referenced = [
        settings.images.typing1.clone(),
        settings.images.typing2.clone(),
        settings.images.idle.clone(),
    ];
    if let Err(error) = images::prune_unreferenced_images(&app, &referenced) {
        warn!(%error, "failed to prune unreferenced images");
    }

    Ok(())
}

#[tauri::command]
fn reset_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let settings_path = settings_path(&app)?;

    if settings_path.exists() {
        fs::remove_file(&settings_path)
            .map_err(|e| format!("Failed to delete settings file: {}", e))?;
    }

    Ok(Settings::default())
}

/// Persists only the main window's position without touching other
/// settings, so unsaved edits in the settings window are not clobbered.
#[tauri::command]
fn save_window_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    let path = settings_path(&app)?;
    let contents = if path.exists() {
        fs::read_to_string(&path).map_err(|e| format!("Failed to read settings file: {}", e))?
    } else {
        String::new()
    };
    let json = settings_json_with_position(&contents, x, y)?;
    debug!(path = ?path, x, y, "persisting dragged window position");
    fs::write(&path, json).map_err(|e| format!("Failed to write settings file: {}", e))
}

/// Decides whether absolute window positioning works for a given Linux
/// windowing environment.
///
/// Wayland has no notion of absolute window coordinates: position requests
/// are silently ignored and reported positions are always (0, 0).
/// `GDK_BACKEND=x11` routes GTK through Xwayland, where positioning works.
fn positioning_supported_on_linux(
    wayland_display: Option<&str>,
    gdk_backend: Option<&str>,
) -> bool {
    if gdk_backend == Some("x11") {
        return true;
    }
    !matches!(wayland_display, Some(display) if !display.is_empty())
}

/// Reports whether the running windowing backend can set and read back
/// absolute window positions.
#[tauri::command]
fn supports_window_positioning() -> bool {
    if !cfg!(target_os = "linux") {
        return true;
    }
    let wayland_display = std::env::var("WAYLAND_DISPLAY").ok();
    let gdk_backend = std::env::var("GDK_BACKEND").ok();
    let supported =
        positioning_supported_on_linux(wayland_display.as_deref(), gdk_backend.as_deref());
    debug!(
        ?wayland_display,
        ?gdk_backend,
        supported,
        "window positioning capability"
    );
    supported
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();

    tauri::Builder::default()
        .setup(|app| {
            logging::log_window_environment(app.handle());
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            reset_settings,
            save_window_position,
            supports_window_positioning,
            images::register_image,
            images::load_image,
            logging::log_frontend
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_positioning_unsupported_under_wayland() {
        assert!(!positioning_supported_on_linux(Some("wayland-0"), None));
    }

    #[test]
    fn test_positioning_supported_when_gdk_backend_is_x11() {
        assert!(positioning_supported_on_linux(
            Some("wayland-0"),
            Some("x11")
        ));
    }

    #[test]
    fn test_positioning_supported_on_plain_x11_session() {
        assert!(positioning_supported_on_linux(None, None));
        assert!(positioning_supported_on_linux(Some(""), None));
    }

    #[test]
    fn test_window_position_default() {
        let settings = Settings::default();
        assert_eq!(settings.window_position.x, 100);
        assert_eq!(settings.window_position.y, 100);
    }

    #[test]
    fn test_window_size_default() {
        let settings = Settings::default();
        assert_eq!(settings.window_size.width, 200);
        assert_eq!(settings.window_size.height, 200);
    }

    #[test]
    fn test_animation_speed_default() {
        let settings = Settings::default();
        assert_eq!(settings.animation_speed, 200);
        assert!(settings.animation_speed >= 50 && settings.animation_speed <= 500);
    }

    #[test]
    fn test_opacity_default() {
        let settings = Settings::default();
        assert_eq!(settings.opacity, 1.0);
        assert!(settings.opacity >= 0.0 && settings.opacity <= 1.0);
    }

    #[test]
    fn test_always_on_top_default() {
        let settings = Settings::default();
        assert!(settings.always_on_top);
    }

    #[test]
    fn test_image_paths_default() {
        let settings = Settings::default();
        assert_eq!(settings.images.typing1, "");
        assert_eq!(settings.images.typing2, "");
        assert_eq!(settings.images.idle, "");
    }

    #[test]
    fn test_settings_serialization() {
        let settings = Settings::default();
        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains("windowPosition"));
        assert!(json.contains("windowSize"));
        assert!(json.contains("animationSpeed"));
        assert!(json.contains("alwaysOnTop"));
    }

    #[test]
    fn test_settings_deserialization() {
        let json = r#"{
            "windowPosition": {"x": 150, "y": 250},
            "windowSize": {"width": 300, "height": 300},
            "animationSpeed": 150,
            "images": {"typing1": "path1.png", "typing2": "path2.png", "idle": "idle.png"},
            "opacity": 0.8,
            "alwaysOnTop": false
        }"#;

        let settings: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.window_position.x, 150);
        assert_eq!(settings.window_position.y, 250);
        assert_eq!(settings.window_size.width, 300);
        assert_eq!(settings.window_size.height, 300);
        assert_eq!(settings.animation_speed, 150);
        assert_eq!(settings.images.typing1, "path1.png");
        assert_eq!(settings.images.typing2, "path2.png");
        assert_eq!(settings.images.idle, "idle.png");
        assert_eq!(settings.opacity, 0.8);
        assert!(!settings.always_on_top);
    }

    #[test]
    fn test_settings_round_trip() {
        let original = Settings {
            window_position: WindowPosition { x: 123, y: 456 },
            window_size: WindowSize {
                width: 250,
                height: 250,
            },
            animation_speed: 100,
            images: ImagePaths {
                typing1: "test1.png".to_string(),
                typing2: "test2.png".to_string(),
                idle: "idle.png".to_string(),
            },
            opacity: 0.5,
            always_on_top: false,
        };

        let json = serde_json::to_string(&original).unwrap();
        let deserialized: Settings = serde_json::from_str(&json).unwrap();

        assert_eq!(original.window_position.x, deserialized.window_position.x);
        assert_eq!(original.window_position.y, deserialized.window_position.y);
        assert_eq!(original.window_size.width, deserialized.window_size.width);
        assert_eq!(original.window_size.height, deserialized.window_size.height);
        assert_eq!(original.animation_speed, deserialized.animation_speed);
        assert_eq!(original.images.typing1, deserialized.images.typing1);
        assert_eq!(original.images.typing2, deserialized.images.typing2);
        assert_eq!(original.images.idle, deserialized.images.idle);
        assert_eq!(original.opacity, deserialized.opacity);
        assert_eq!(original.always_on_top, deserialized.always_on_top);
    }

    #[test]
    fn test_animation_speed_range_validation() {
        // アニメーション速度が仕様の範囲内であることを確認
        let min_speed = 50;
        let max_speed = 500;
        let default_speed = Settings::default().animation_speed;

        assert!(
            default_speed >= min_speed,
            "Default animation speed should be >= {}",
            min_speed
        );
        assert!(
            default_speed <= max_speed,
            "Default animation speed should be <= {}",
            max_speed
        );
    }

    #[test]
    fn test_capability_covers_settings_window_and_required_permissions() {
        // フロントエンドが使うTauri APIはケーパビリティで許可されていないと
        // 実行時に黙って失敗するため、契約テストで担保する
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities/default.json");
        let contents = fs::read_to_string(path).expect("failed to read capabilities/default.json");
        let capability: serde_json::Value =
            serde_json::from_str(&contents).expect("capabilities/default.json is not valid JSON");

        let windows: Vec<&str> = capability["windows"]
            .as_array()
            .expect("windows should be an array")
            .iter()
            .filter_map(|w| w.as_str())
            .collect();
        assert!(windows.contains(&"main"), "windows must include \"main\"");
        assert!(
            windows.contains(&"settings"),
            "windows must include \"settings\""
        );

        let permissions: Vec<String> = capability["permissions"]
            .as_array()
            .expect("permissions should be an array")
            .iter()
            .filter_map(|p| match p {
                serde_json::Value::String(s) => Some(s.clone()),
                serde_json::Value::Object(o) => o
                    .get("identifier")
                    .and_then(|i| i.as_str())
                    .map(String::from),
                _ => None,
            })
            .collect();

        for required in [
            "core:webview:allow-create-webview-window",
            "core:window:allow-start-dragging",
            "core:window:allow-show",
            "core:window:allow-set-focus",
            "core:window:allow-set-position",
            "core:window:allow-set-size",
            "core:window:allow-set-always-on-top",
            "dialog:default",
        ] {
            assert!(
                permissions.iter().any(|p| p == required),
                "permissions must include \"{}\"",
                required
            );
        }
    }

    #[test]
    fn test_parse_settings_empty_object_falls_back_to_defaults() {
        let settings = parse_settings_or_default("{}");
        let default = Settings::default();
        assert_eq!(settings.window_position.x, default.window_position.x);
        assert_eq!(settings.animation_speed, default.animation_speed);
        assert_eq!(settings.opacity, default.opacity);
        assert_eq!(settings.always_on_top, default.always_on_top);
    }

    #[test]
    fn test_parse_settings_broken_json_falls_back_to_defaults() {
        let settings = parse_settings_or_default("{ this is not json");
        assert_eq!(
            settings.animation_speed,
            Settings::default().animation_speed
        );
    }

    #[test]
    fn test_parse_settings_partial_json_fills_missing_fields_with_defaults() {
        // 将来のフィールド追加時に既存の設定ファイルが読めなくならないことを担保
        let settings = parse_settings_or_default(r#"{"animationSpeed": 300}"#);
        assert_eq!(settings.animation_speed, 300);
        assert_eq!(
            settings.window_position.x,
            Settings::default().window_position.x
        );
        assert_eq!(settings.opacity, Settings::default().opacity);
    }

    #[test]
    fn test_main_window_is_transparent() {
        // 透過ウィンドウはCSSだけでは実現できず、ウィンドウ自体の
        // transparent設定が必要なため、設定ファイルの契約テストで担保する
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json");
        let contents = fs::read_to_string(path).expect("failed to read tauri.conf.json");
        let conf: serde_json::Value =
            serde_json::from_str(&contents).expect("tauri.conf.json is not valid JSON");

        let windows = conf["app"]["windows"]
            .as_array()
            .expect("app.windows should be an array");
        let main_window = windows
            .iter()
            .find(|w| w["label"] == "main")
            .expect("main window config should exist");

        assert_eq!(
            main_window["transparent"],
            serde_json::Value::Bool(true),
            "main window must set \"transparent\": true"
        );
        assert_eq!(
            conf["app"]["macOSPrivateApi"],
            serde_json::Value::Bool(true),
            "app.macOSPrivateApi must be true for transparency on macOS"
        );
    }

    #[test]
    fn test_opacity_range_validation() {
        // 透明度が0.0-1.0の範囲内であることを確認
        let default_opacity = Settings::default().opacity;

        assert!(default_opacity >= 0.0, "Default opacity should be >= 0.0");
        assert!(default_opacity <= 1.0, "Default opacity should be <= 1.0");
    }

    #[test]
    fn test_settings_json_with_position_updates_only_position() {
        // 設定ウィンドウで編集中の他フィールドを上書きしないことを担保する
        let json = r#"{"animationSpeed": 300, "opacity": 0.5}"#;
        let result = settings_json_with_position(json, 42, 84).unwrap();
        let settings: Settings = serde_json::from_str(&result).unwrap();
        assert_eq!(settings.window_position.x, 42);
        assert_eq!(settings.window_position.y, 84);
        assert_eq!(settings.animation_speed, 300);
        assert_eq!(settings.opacity, 0.5);
    }

    #[test]
    fn test_settings_json_with_position_refuses_to_overwrite_broken_file() {
        // 壊れた設定ファイルをドラッグ操作でデフォルト値に潰さない。
        // 読み取り側と違い書き戻し側のフォールバックは破壊的なため中止する
        assert!(settings_json_with_position("{ this is not json", 1, 2).is_err());
    }

    #[test]
    fn test_settings_json_with_position_treats_blank_contents_as_new_file() {
        // 空白のみのファイルは「未作成」と同じ扱いにする
        let result = settings_json_with_position("   \n", 10, 20).unwrap();
        let settings: Settings = serde_json::from_str(&result).unwrap();
        assert_eq!(settings.window_position.x, 10);
    }

    #[test]
    fn test_settings_json_with_position_works_on_empty_contents() {
        // 設定ファイル未作成の状態でドラッグされてもデフォルト+新位置で保存できる
        let result = settings_json_with_position("", 10, 20).unwrap();
        let settings: Settings = serde_json::from_str(&result).unwrap();
        assert_eq!(settings.window_position.x, 10);
        assert_eq!(settings.window_position.y, 20);
        assert_eq!(
            settings.animation_speed,
            Settings::default().animation_speed
        );
    }
}
