use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use tauri::Manager;
use tracing::warn;

use crate::png::validate_png;

/// Maps an image slot name to its file name prefix inside the managed
/// images directory.
///
/// Restricting names to a fixed allow-list also prevents callers from
/// writing to arbitrary paths.
fn image_file_prefix(image_type: &str) -> Result<&'static str, String> {
    match image_type {
        "typing1" => Ok("typing1"),
        "typing2" => Ok("typing2"),
        "idle" => Ok("idle"),
        other => Err(format!("Unknown image type: {}", other)),
    }
}

/// Computes the FNV-1a 64-bit digest of `bytes`.
///
/// The digest only derives file names for locally chosen images, so a
/// non-cryptographic hash is enough and keeps the dependency list small.
fn content_hash(bytes: &[u8]) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut hash = OFFSET_BASIS;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

/// Builds the managed file name for an image slot from its content.
///
/// Naming files after their content instead of after the slot keeps a
/// selection that the user never saved from overwriting the image the
/// stored settings still point at.
fn managed_file_name(image_type: &str, bytes: &[u8]) -> Result<String, String> {
    let prefix = image_file_prefix(image_type)?;
    Ok(format!("{}-{:016x}.png", prefix, content_hash(bytes)))
}

/// Returns the file names in `existing` that no path in `referenced`
/// points at. Empty reference entries stand for unset slots.
fn unreferenced_image_files(existing: &[String], referenced: &[String]) -> Vec<String> {
    let kept: Vec<&str> = referenced
        .iter()
        .filter(|path| !path.is_empty())
        .filter_map(|path| Path::new(path).file_name().and_then(|name| name.to_str()))
        .collect();
    existing
        .iter()
        .filter(|name| !kept.contains(&name.as_str()))
        .cloned()
        .collect()
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
/// images directory under a content-derived name, returning the
/// destination path.
#[tauri::command]
pub fn register_image(
    app: tauri::AppHandle,
    image_type: String,
    source_path: String,
) -> Result<String, String> {
    let bytes = fs::read(&source_path).map_err(|e| format!("Failed to read image file: {}", e))?;
    validate_png(&bytes)?;
    let dest = images_dir(&app)?.join(managed_file_name(&image_type, &bytes)?);
    fs::write(&dest, &bytes).map_err(|e| format!("Failed to copy image file: {}", e))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Deletes managed image files that `referenced` no longer points at.
///
/// Registration writes a new file as soon as the user picks one, so
/// files the saved settings dropped would otherwise pile up forever.
pub fn prune_unreferenced_images(
    app: &tauri::AppHandle,
    referenced: &[String],
) -> Result<(), String> {
    let dir = images_dir(app)?;
    let entries =
        fs::read_dir(&dir).map_err(|e| format!("Failed to list images directory: {}", e))?;
    let existing: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_file())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    for name in unreferenced_image_files(&existing, referenced) {
        // 掃除の失敗は保存自体を失敗させる理由にならないため記録だけする
        if let Err(error) = fs::remove_file(dir.join(&name)) {
            warn!(file = %name, %error, "failed to delete unreferenced image");
        }
    }
    Ok(())
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
    fn test_image_file_prefix_maps_allowed_types() {
        assert_eq!(image_file_prefix("typing1"), Ok("typing1"));
        assert_eq!(image_file_prefix("typing2"), Ok("typing2"));
        assert_eq!(image_file_prefix("idle"), Ok("idle"));
    }

    #[test]
    fn test_content_hash_is_stable_and_content_dependent() {
        assert_eq!(content_hash(b"abc"), content_hash(b"abc"));
        assert_ne!(content_hash(b"abc"), content_hash(b"abd"));
    }

    #[test]
    fn test_managed_file_name_embeds_type_and_content_hash() {
        let name = managed_file_name("idle", b"abc").unwrap();
        assert!(name.starts_with("idle-"), "got {}", name);
        assert!(name.ends_with(".png"), "got {}", name);
        // 同じ内容なら同じ名前になり、無駄なコピーが増えない
        assert_eq!(name, managed_file_name("idle", b"abc").unwrap());
    }

    #[test]
    fn test_managed_file_name_differs_for_different_content() {
        // 内容が変われば別ファイルになるため、保存前の選択が既存画像を壊さない
        let old = managed_file_name("idle", b"old image").unwrap();
        let new = managed_file_name("idle", b"new image").unwrap();
        assert_ne!(old, new);
    }

    #[test]
    fn test_managed_file_name_rejects_unknown_type() {
        // 許可リスト外を拒否することで、任意ファイル名への書き込みを防ぐ
        assert!(managed_file_name("../evil", b"abc").is_err());
        assert!(managed_file_name("", b"abc").is_err());
    }

    #[test]
    fn test_unreferenced_image_files_lists_only_orphans() {
        let existing = vec![
            "idle-1111.png".to_string(),
            "idle-2222.png".to_string(),
            "typing1-3333.png".to_string(),
        ];
        let referenced = vec![
            "/data/images/idle-2222.png".to_string(),
            "/data/images/typing1-3333.png".to_string(),
        ];
        assert_eq!(
            unreferenced_image_files(&existing, &referenced),
            vec!["idle-1111.png".to_string()]
        );
    }

    #[test]
    fn test_unreferenced_image_files_ignores_empty_references() {
        // 未設定スロットは空文字列で届くため、誤って全削除しないことを確認する
        let existing = vec!["idle-1111.png".to_string()];
        let referenced = vec![String::new(), "".to_string()];
        assert_eq!(
            unreferenced_image_files(&existing, &referenced),
            vec!["idle-1111.png".to_string()]
        );
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
