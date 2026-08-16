use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;

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

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let settings_path = config_dir.join("settings.json");

    if settings_path.exists() {
        let contents = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings file: {}", e))?;

        serde_json::from_str(&contents).map_err(|e| format!("Failed to parse settings: {}", e))
    } else {
        Ok(Settings::default())
    }
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let settings_path = config_dir.join("settings.json");

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&settings_path, json).map_err(|e| format!("Failed to write settings file: {}", e))?;

    Ok(())
}

#[tauri::command]
fn reset_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;

    let settings_path = config_dir.join("settings.json");

    if settings_path.exists() {
        fs::remove_file(&settings_path)
            .map_err(|e| format!("Failed to delete settings file: {}", e))?;
    }

    Ok(Settings::default())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_settings,
            save_settings,
            reset_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_opacity_range_validation() {
        // 透明度が0.0-1.0の範囲内であることを確認
        let default_opacity = Settings::default().opacity;

        assert!(default_opacity >= 0.0, "Default opacity should be >= 0.0");
        assert!(default_opacity <= 1.0, "Default opacity should be <= 1.0");
    }
}
