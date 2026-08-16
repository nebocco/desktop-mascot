use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use tauri::Manager;

use crate::png::validate_png;

/// Maps an image slot name to its fixed file name inside the managed
/// images directory.
///
/// Restricting names to a fixed allow-list also prevents callers from
/// writing to arbitrary paths.
fn image_file_name(image_type: &str) -> Result<&'static str, String> {
    match image_type {
        "typing1" => Ok("typing1.png"),
        "typing2" => Ok("typing2.png"),
        "idle" => Ok("idle.png"),
        other => Err(format!("Unknown image type: {}", other)),
    }
}

/// Returns the managed images directory, creating it if needed.
fn images_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get data directory: {}", e))?;
    let dir = data_dir.join("images");
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create images directory: {}", e))?;
    }
    Ok(dir)
}

/// Canonicalizes `path` and ensures the result stays inside `dir`.
fn ensure_within(dir: &Path, path: &Path) -> Result<PathBuf, String> {
    let canonical_dir = dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve images directory: {}", e))?;
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve image path: {}", e))?;
    if canonical.starts_with(&canonical_dir) {
        Ok(canonical)
    } else {
        Err("Image path is outside the managed images directory".to_string())
    }
}

/// Validates the image at `source_path` and copies it into the managed
/// images directory under a fixed name, returning the destination path.
#[tauri::command]
pub fn register_image(
    app: tauri::AppHandle,
    image_type: String,
    source_path: String,
) -> Result<String, String> {
    let file_name = image_file_name(&image_type)?;
    let bytes = fs::read(&source_path).map_err(|e| format!("Failed to read image file: {}", e))?;
    validate_png(&bytes)?;
    let dest = images_dir(&app)?.join(file_name);
    fs::write(&dest, &bytes).map_err(|e| format!("Failed to copy image file: {}", e))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Reads a managed image file and returns its contents as base64.
#[tauri::command]
pub fn load_image(app: tauri::AppHandle, path: String) -> Result<String, String> {
    // 管理ディレクトリ外の任意ファイル読み出しを防ぐ
    let dir = images_dir(&app)?;
    let canonical = ensure_within(&dir, Path::new(&path))?;
    let bytes = fs::read(&canonical).map_err(|e| format!("Failed to read image file: {}", e))?;
    Ok(STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_image_file_name_maps_allowed_types() {
        assert_eq!(image_file_name("typing1"), Ok("typing1.png"));
        assert_eq!(image_file_name("typing2"), Ok("typing2.png"));
        assert_eq!(image_file_name("idle"), Ok("idle.png"));
    }

    #[test]
    fn test_image_file_name_rejects_unknown_type() {
        // 許可リスト外を拒否することで、任意ファイル名への書き込みを防ぐ
        assert!(image_file_name("../evil").is_err());
        assert!(image_file_name("").is_err());
    }

    #[test]
    fn test_ensure_within_accepts_file_inside_dir() {
        let base = std::env::temp_dir().join("desktop-mascot-test-inside");
        fs::create_dir_all(&base).unwrap();
        let file = base.join("a.png");
        fs::write(&file, b"x").unwrap();
        assert!(ensure_within(&base, &file).is_ok());
    }

    #[test]
    fn test_ensure_within_rejects_file_outside_dir() {
        let base = std::env::temp_dir().join("desktop-mascot-test-outside");
        let dir = base.join("images");
        fs::create_dir_all(&dir).unwrap();
        let outside = base.join("secret.txt");
        fs::write(&outside, b"x").unwrap();
        // "../"で抜けるパスもcanonicalizeで解決された上で拒否される
        let sneaky = dir.join("..").join("secret.txt");
        assert!(ensure_within(&dir, &sneaky).is_err());
    }

    #[test]
    fn test_ensure_within_rejects_missing_file() {
        let base = std::env::temp_dir().join("desktop-mascot-test-missing");
        fs::create_dir_all(&base).unwrap();
        assert!(ensure_within(&base, &base.join("no-such-file.png")).is_err());
    }
}
