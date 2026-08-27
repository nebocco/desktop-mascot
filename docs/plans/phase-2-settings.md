# フェーズ2: 設定機能の実装 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定ウィンドウで登録した画像・透明度・位置・サイズ・alwaysOnTopが、検証・永続化を経てメインウィンドウに実際に反映される状態にする。

**Architecture:** 画像の検証（PNGシグネチャ+IHDR解析）・アプリ管理ディレクトリへのコピー・base64変換はすべてRust側のTauriコマンドに集約する。設定ウィンドウはSave成功時に`settings-updated`イベントをemitし、メインウィンドウがそれを受けてウィンドウプロパティとマスコット表示を更新する。メインウィンドウのドラッグ位置は`save_window_position`コマンドで位置のみ永続化し、`position-changed`イベントで設定ウィンドウのフォームに反映する。

**Tech Stack:** Tauri 2 (Rust), Vue 3 + PrimeVue, vitest + @vue/test-utils, cargo test。新規依存は`base64`クレートのみ。

**Spec:** `docs/specs/phase-2-settings.md`

## Global Constraints

- **コミットは必ずユーザーに可否を確認し、承認を得てから行う**（リポジトリのワークフロー規約）
- ドキュメントコメント（rustdoc/JSDoc）は英語、インラインコメントは日本語
- コード内コメントで外部文書・チケット番号を参照しない（「フェーズ2」「Task 3」等は禁止。pre-commitフックが検出する）
- コミット前に`just format`を実行し、`just lint`（clippy `-D warnings` + Biome）が通ること
- 新しいTauriプラグインは追加しない。Rustの新規依存は`base64`のみ
- 画像はPNGのみ対応。幅・高さのいずれかが512pxを超える画像は拒否
- Rustの`Settings`構造体と`src/types/settings.ts`の型は常に同期を保つ
- テストコマンド: Rustは`cd src-tauri && cargo test`、フロントは`pnpm vitest run <file>`

---

### Task 0: 作業ブランチの作成

**Files:** なし（gitのみ）

- [ ] **Step 1: developから作業ブランチを切る**

```bash
git checkout develop && git pull && git checkout -b feature/phase-2-settings
```

---

### Task 1: PNG検証モジュール（Rust）

**Files:**
- Create: `src-tauri/src/png.rs`
- Modify: `src-tauri/src/lib.rs`（`mod png;`を先頭付近に追加）

**Interfaces:**
- Consumes: なし
- Produces: `png::validate_png(bytes: &[u8]) -> Result<(u32, u32), String>`（成功時は`(width, height)`、失敗時はユーザー向け英語メッセージ）、`png::MAX_DIMENSION: u32 = 512`

- [ ] **Step 1: 失敗するテストを書く**

`src-tauri/src/png.rs`を作成し、実装は空のままテストだけ書く（`validate_png`が未定義なのでコンパイルエラーになることを確認するため、まずテスト部分のみ）:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Builds the fixed-size prefix of a PNG file (signature + IHDR).
    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        // ビット深度・カラータイプ等。寸法検証には使わないためダミー値でよい
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes
    }

    #[test]
    fn test_accepts_png_at_max_dimension() {
        assert_eq!(validate_png(&png_header(512, 512)), Ok((512, 512)));
    }

    #[test]
    fn test_accepts_small_png() {
        assert_eq!(validate_png(&png_header(1, 1)), Ok((1, 1)));
    }

    #[test]
    fn test_rejects_too_wide_png() {
        let err = validate_png(&png_header(513, 100)).unwrap_err();
        assert!(err.contains("513x100"), "message should include dimensions: {}", err);
    }

    #[test]
    fn test_rejects_too_tall_png() {
        assert!(validate_png(&png_header(100, 513)).is_err());
    }

    #[test]
    fn test_rejects_non_png_bytes() {
        assert!(validate_png(b"GIF89a not a png at all......").is_err());
    }

    #[test]
    fn test_rejects_truncated_file() {
        assert!(validate_png(&[0x89, 0x50, 0x4E, 0x47]).is_err());
    }

    #[test]
    fn test_rejects_zero_dimension() {
        assert!(validate_png(&png_header(0, 100)).is_err());
    }
}
```

`src-tauri/src/lib.rs`の先頭（`use serde::...`の上）に追加:

```rust
mod png;
```

- [ ] **Step 2: テストが失敗（コンパイルエラー）することを確認**

Run: `cd src-tauri && cargo test png::`
Expected: FAIL（`validate_png`未定義のコンパイルエラー）

- [ ] **Step 3: 最小実装を書く**

`src-tauri/src/png.rs`のテストモジュールの上に追加:

```rust
/// Maximum allowed width/height in pixels for mascot images.
pub const MAX_DIMENSION: u32 = 512;

const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/// Validates PNG bytes and returns `(width, height)` on success.
///
/// Only the signature and the IHDR header are inspected; full decoding is
/// unnecessary because the webview performs the actual rendering.
pub fn validate_png(bytes: &[u8]) -> Result<(u32, u32), String> {
    // PNGは先頭にシグネチャ8バイト+IHDRチャンク(長さ4+種別4+幅4+高さ4)が
    // 固定で並ぶため、最低24バイトを要求する
    if bytes.len() < 24 || bytes[..8] != PNG_SIGNATURE {
        return Err("The selected file is not a PNG image".to_string());
    }
    if &bytes[12..16] != b"IHDR" {
        return Err("The selected file is not a valid PNG image".to_string());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().expect("slice length is 4"));
    let height = u32::from_be_bytes(bytes[20..24].try_into().expect("slice length is 4"));
    if width == 0 || height == 0 {
        return Err("The selected file is not a valid PNG image".to_string());
    }
    if width > MAX_DIMENSION || height > MAX_DIMENSION {
        return Err(format!(
            "Image is {}x{}px; both dimensions must be at most {}px",
            width, height, MAX_DIMENSION
        ));
    }
    Ok((width, height))
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd src-tauri && cargo test png::`
Expected: PASS（7件）

- [ ] **Step 5: フォーマット・lint後、ユーザーにコミット可否を確認し、承認後にコミット**

```bash
just format && just lint
git add src-tauri/src/png.rs src-tauri/src/lib.rs
git commit -m "Add PNG signature and dimension validation"
```

---

### Task 2: 画像登録・読み込みコマンド（Rust）

**Files:**
- Create: `src-tauri/src/images.rs`
- Modify: `src-tauri/Cargo.toml`（`base64`追加）
- Modify: `src-tauri/src/lib.rs`（`mod images;`追加、`invoke_handler`にコマンド登録）

**Interfaces:**
- Consumes: `png::validate_png(&[u8]) -> Result<(u32, u32), String>`
- Produces: Tauriコマンド`register_image(imageType: string, sourcePath: string) -> string`（コピー先絶対パスを返す）、`load_image(path: string) -> string`（base64文字列を返す）。フロントからは`invoke("register_image", { imageType, sourcePath })` / `invoke("load_image", { path })`で呼ぶ

- [ ] **Step 1: base64クレートを追加**

`src-tauri/Cargo.toml`の`[dependencies]`に追加:

```toml
base64 = "0.22"
```

- [ ] **Step 2: 失敗するテストを書く**

`src-tauri/src/images.rs`を作成し、テストモジュールを書く:

```rust
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
```

`src-tauri/src/lib.rs`に追加:

```rust
mod images;
```

- [ ] **Step 3: テストが失敗（コンパイルエラー）することを確認**

Run: `cd src-tauri && cargo test images::`
Expected: FAIL（`image_file_name` / `ensure_within`未定義）

- [ ] **Step 4: 実装を書く**

`src-tauri/src/images.rs`のテストモジュールの上に追加:

```rust
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
    let bytes =
        fs::read(&source_path).map_err(|e| format!("Failed to read image file: {}", e))?;
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
```

`src-tauri/src/lib.rs`の`invoke_handler`を更新:

```rust
.invoke_handler(tauri::generate_handler![
    get_settings,
    save_settings,
    reset_settings,
    images::register_image,
    images::load_image
])
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd src-tauri && cargo test`
Expected: PASS（images::の5件を含む全件）

- [ ] **Step 6: フォーマット・lint後、ユーザーにコミット可否を確認し、承認後にコミット**

```bash
just format && just lint
git add src-tauri/src/images.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Add image registration and loading commands"
```

---

### Task 3: 位置のみ保存するコマンド（Rust）

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: 既存の`parse_settings_or_default(&str) -> Settings`、`settings_path(&AppHandle)`
- Produces: Tauriコマンド`save_window_position(x: i32, y: i32)`。フロントからは`invoke("save_window_position", { x, y })`で呼ぶ

- [ ] **Step 1: 失敗するテストを書く**

`src-tauri/src/lib.rs`の`tests`モジュールに追加:

```rust
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
fn test_settings_json_with_position_works_on_empty_contents() {
    // 設定ファイル未作成の状態でドラッグされてもデフォルト+新位置で保存できる
    let result = settings_json_with_position("", 10, 20).unwrap();
    let settings: Settings = serde_json::from_str(&result).unwrap();
    assert_eq!(settings.window_position.x, 10);
    assert_eq!(settings.window_position.y, 20);
    assert_eq!(settings.animation_speed, Settings::default().animation_speed);
}
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd src-tauri && cargo test settings_json_with_position`
Expected: FAIL（`settings_json_with_position`未定義）

- [ ] **Step 3: 実装を書く**

`src-tauri/src/lib.rs`の`parse_settings_or_default`の下に追加:

```rust
/// Replaces only the window position in the given settings JSON,
/// preserving every other field.
fn settings_json_with_position(contents: &str, x: i32, y: i32) -> Result<String, String> {
    let mut settings = parse_settings_or_default(contents);
    settings.window_position = WindowPosition { x, y };
    serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))
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
    fs::write(&path, json).map_err(|e| format!("Failed to write settings file: {}", e))
}
```

`invoke_handler`に`save_window_position`を追加:

```rust
.invoke_handler(tauri::generate_handler![
    get_settings,
    save_settings,
    reset_settings,
    save_window_position,
    images::register_image,
    images::load_image
])
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 5: フォーマット・lint後、ユーザーにコミット可否を確認し、承認後にコミット**

```bash
just format && just lint
git add src-tauri/src/lib.rs
git commit -m "Add position-only save command for window drags"
```

---

### Task 4: ケーパビリティの拡張（Rust契約テスト）

**Files:**
- Modify: `src-tauri/src/lib.rs`（既存の`test_capability_covers_settings_window_and_required_permissions`）
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: なし
- Produces: メインウィンドウで`setPosition` / `setSize` / `setAlwaysOnTop`が呼べる権限

- [ ] **Step 1: 契約テストを更新して失敗させる**

`src-tauri/src/lib.rs`の契約テスト内、`for required in [...]`の配列に3件追加:

```rust
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
```

Run: `cd src-tauri && cargo test test_capability_covers`
Expected: FAIL（`core:window:allow-set-position`が無い）

- [ ] **Step 2: capabilities/default.jsonに権限を追加**

`permissions`配列に追加:

```json
"core:window:allow-set-position",
"core:window:allow-set-size",
"core:window:allow-set-always-on-top"
```

（イベントのemit/listenは`core:default`に含まれる`core:event:default`で許可済みのため追加不要）

- [ ] **Step 3: テストが通ることを確認**

Run: `cd src-tauri && cargo test test_capability_covers`
Expected: PASS

- [ ] **Step 4: ユーザーにコミット可否を確認し、承認後にコミット**

```bash
git add src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "Allow window position, size, and always-on-top control"
```

---

### Task 5: 画像読み込みヘルパーとイベント名定数（フロントエンド）

**Files:**
- Create: `src/images.ts`
- Modify: `src/constants.ts`
- Test: `tests/images.test.ts`

**Interfaces:**
- Consumes: Tauriコマンド`load_image(path: string) -> string`（base64）
- Produces: `loadImageDataUrl(path: string): Promise<string | null>`（空パス・読み込み失敗時はnull）、定数`SETTINGS_UPDATED_EVENT = "settings-updated"`、`POSITION_CHANGED_EVENT = "position-changed"`

- [ ] **Step 1: 失敗するテストを書く**

`tests/images.test.ts`を作成:

```typescript
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { loadImageDataUrl } from "../src/images";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

describe("loadImageDataUrl", () => {
  test("returns null for an empty path without calling the backend", async () => {
    expect(await loadImageDataUrl("")).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("returns a PNG data URL on success", async () => {
    invokeMock.mockResolvedValue("QUJD");
    const url = await loadImageDataUrl("/data/images/idle.png");
    expect(invokeMock).toHaveBeenCalledWith("load_image", {
      path: "/data/images/idle.png",
    });
    expect(url).toBe("data:image/png;base64,QUJD");
  });

  test("returns null when the backend fails", async () => {
    invokeMock.mockRejectedValue(new Error("outside managed dir"));
    expect(await loadImageDataUrl("/etc/passwd")).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run tests/images.test.ts`
Expected: FAIL（`../src/images`が存在しない）

- [ ] **Step 3: 実装を書く**

`src/images.ts`を作成:

```typescript
import { invoke } from "@tauri-apps/api/core";

/**
 * Loads a managed image file and returns it as a data URL, or null when
 * the path is empty or the file cannot be read.
 */
export async function loadImageDataUrl(path: string): Promise<string | null> {
  if (!path) {
    return null;
  }
  try {
    const base64 = await invoke<string>("load_image", { path });
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    // 画像が消えていても表示側はプレースホルダーで継続する
    console.error("Failed to load image:", error);
    return null;
  }
}
```

`src/constants.ts`に追加:

```typescript
/**
 * Event emitted by the settings window after settings are saved,
 * carrying the full Settings object as payload.
 */
export const SETTINGS_UPDATED_EVENT = "settings-updated";

/**
 * Event emitted by the main window after it is dragged, carrying the new
 * WindowPosition as payload.
 */
export const POSITION_CHANGED_EVENT = "position-changed";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run tests/images.test.ts`
Expected: PASS（3件）

- [ ] **Step 5: フォーマット・lint後、ユーザーにコミット可否を確認し、承認後にコミット**

```bash
just format && just lint
git add src/images.ts src/constants.ts tests/images.test.ts
git commit -m "Add image data URL loader and window event constants"
```

---

### Task 6: 画像スロットコンポーネント（フロントエンド）

**Files:**
- Create: `src/components/ImageSlot.vue`
- Test: `tests/ImageSlot.test.ts`

**Interfaces:**
- Consumes: `loadImageDataUrl`、Tauriコマンド`register_image`、`@tauri-apps/plugin-dialog`の`open`
- Produces: `ImageSlot`コンポーネント。props: `label: string`、`imageType: "typing1" | "typing2" | "idle"`、`modelValue: string`（画像パス）。emits: `update:modelValue`（登録成功時にコピー先パス、Clear時に空文字）、`error`（検証失敗メッセージ）

- [ ] **Step 1: 失敗するテストを書く**

`tests/ImageSlot.test.ts`を作成:

```typescript
import { flushPromises, mount } from "@vue/test-utils";
import PrimeVue from "primevue/config";
import Button from "primevue/button";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import ImageSlot from "../src/components/ImageSlot.vue";

const invokeMock = vi.mocked(invoke);
const openMock = vi.mocked(open);

function mountSlot(modelValue = "") {
  return mount(ImageSlot, {
    props: { label: "Idle Image", imageType: "idle" as const, modelValue },
    global: {
      plugins: [PrimeVue],
      // vitest設定の自動インポートに依存しないよう明示登録する
      components: { Button },
    },
  });
}

function findButtonByLabel(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper
    .findAll("button")
    .find((b) => b.text().includes(label));
  if (!button) {
    throw new Error(`button with label "${label}" not found`);
  }
  return button;
}

beforeEach(() => {
  invokeMock.mockReset();
  openMock.mockReset();
});

describe("ImageSlot preview", () => {
  test("shows a placeholder when no image is set", async () => {
    const wrapper = mountSlot("");
    await flushPromises();
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.text()).toContain("No image");
  });

  test("shows a preview image when a path is set", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "load_image") return "QUJD";
      return undefined;
    });
    const wrapper = mountSlot("/data/images/idle.png");
    await flushPromises();
    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("data:image/png;base64,QUJD");
  });
});

describe("ImageSlot selection", () => {
  test("registers the chosen file and emits the stored path", async () => {
    openMock.mockResolvedValue("/home/user/pic.png");
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "register_image") return "/data/images/idle.png";
      if (cmd === "load_image") return "QUJD";
      return undefined;
    });

    const wrapper = mountSlot("");
    await flushPromises();
    await findButtonByLabel(wrapper, "Select").trigger("click");
    await flushPromises();

    expect(invokeMock).toHaveBeenCalledWith("register_image", {
      imageType: "idle",
      sourcePath: "/home/user/pic.png",
    });
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
      "/data/images/idle.png",
    ]);
  });

  test("emits an error message when validation fails", async () => {
    openMock.mockResolvedValue("/home/user/huge.png");
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "register_image") {
        throw "Image is 600x600px; both dimensions must be at most 512px";
      }
      return undefined;
    });

    const wrapper = mountSlot("");
    await flushPromises();
    await findButtonByLabel(wrapper, "Select").trigger("click");
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.emitted("error")?.at(-1)?.[0]).toContain("600x600");
  });

  test("does nothing when the dialog is cancelled", async () => {
    openMock.mockResolvedValue(null);
    const wrapper = mountSlot("");
    await flushPromises();
    await findButtonByLabel(wrapper, "Select").trigger("click");
    await flushPromises();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "register_image",
      expect.anything(),
    );
  });
});

describe("ImageSlot clear", () => {
  test("emits an empty path on clear", async () => {
    invokeMock.mockImplementation(async () => "QUJD");
    const wrapper = mountSlot("/data/images/idle.png");
    await flushPromises();
    await findButtonByLabel(wrapper, "Clear").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([""]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run tests/ImageSlot.test.ts`
Expected: FAIL（`ImageSlot.vue`が存在しない）

- [ ] **Step 3: コンポーネントを実装する**

`src/components/ImageSlot.vue`を作成:

```vue
<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ref, watchEffect } from "vue";
import { loadImageDataUrl } from "../images";

const props = defineProps<{
  label: string;
  imageType: "typing1" | "typing2" | "idle";
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  error: [message: string];
}>();

const previewUrl = ref<string | null>(null);

// パスが変わるたびにプレビューを読み直す
watchEffect(async () => {
  previewUrl.value = await loadImageDataUrl(props.modelValue);
});

async function selectImage() {
  const selected = await open({
    multiple: false,
    filters: [{ name: "PNG Image", extensions: ["png"] }],
  });
  if (typeof selected !== "string") {
    return;
  }
  try {
    // 検証とアプリ管理ディレクトリへのコピーはRust側が行う
    const storedPath = await invoke<string>("register_image", {
      imageType: props.imageType,
      sourcePath: selected,
    });
    emit("update:modelValue", storedPath);
  } catch (error) {
    emit("error", String(error));
  }
}

function clearImage() {
  emit("update:modelValue", "");
}
</script>

<template>
  <div class="image-slot">
    <span class="image-slot-label">{{ label }}</span>
    <div class="image-slot-body">
      <img
        v-if="previewUrl"
        class="image-preview"
        :src="previewUrl"
        :alt="`${label} preview`"
      />
      <span v-else class="image-placeholder">No image</span>
      <div class="image-slot-actions">
        <Button label="Select" @click="selectImage" />
        <Button
          label="Clear"
          severity="secondary"
          :disabled="!modelValue"
          @click="clearImage"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-slot {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.image-slot-label {
  font-weight: 500;
  color: #666;
}

.image-slot-body {
  display: flex;
  align-items: center;
  gap: 10px;
}

.image-preview {
  width: 64px;
  height: 64px;
  object-fit: contain;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
}

.image-placeholder {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #999;
  border: 1px dashed #ccc;
  border-radius: 4px;
}

.image-slot-actions {
  display: flex;
  gap: 10px;
}
</style>
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run tests/ImageSlot.test.ts`
Expected: PASS（6件）

- [ ] **Step 5: フォーマット・lint後、ユーザーにコミット可否を確認し、承認後にコミット**

```bash
just format && just lint
git add src/components/ImageSlot.vue tests/ImageSlot.test.ts
git commit -m "Add image slot component with preview and validation errors"
```

---

### Task 7: 設定ウィンドウの統合（フロントエンド）

**Files:**
- Modify: `src/SettingsWindow.vue`
- Test: `tests/SettingsWindow.test.ts`（追加）

**Interfaces:**
- Consumes: `ImageSlot`コンポーネント、定数`SETTINGS_UPDATED_EVENT` / `POSITION_CHANGED_EVENT`、`@tauri-apps/api/event`の`emit` / `listen`
- Produces: Save成功時に`settings-updated`イベント（ペイロード: `Settings`）をemit。`position-changed`イベント（ペイロード: `WindowPosition`）を受けて位置フォームを更新

- [ ] **Step 1: 失敗するテストを書く**

`tests/SettingsWindow.test.ts`に、まずモックを追加（既存の`vi.mock`群の並びに）:

```typescript
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { emit as emitEvent, listen } from "@tauri-apps/api/event";

const emitEventMock = vi.mocked(emitEvent);
const listenMock = vi.mocked(listen);
```

既存の`beforeEach`に`emitEventMock.mockReset();`と`listenMock.mockClear();`を追加した上で、describeを2つ追加:

```typescript
describe("SettingsWindow save event", () => {
  test("emits settings-updated with the saved settings", async () => {
    const wrapper = mountSettingsWindow();
    await flushPromises();

    await findButtonByLabel(wrapper, "Save Settings").trigger("click");
    await flushPromises();

    expect(emitEventMock).toHaveBeenCalledWith(
      "settings-updated",
      expect.objectContaining({ animationSpeed: 200 }),
    );
  });

  test("does not emit when saving fails", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return createDefaultSettings();
      if (cmd === "save_settings") throw new Error("disk full");
      return undefined;
    });

    const wrapper = mountSettingsWindow();
    await flushPromises();

    await findButtonByLabel(wrapper, "Save Settings").trigger("click");
    await flushPromises();

    expect(emitEventMock).not.toHaveBeenCalled();
  });
});

describe("SettingsWindow position sync", () => {
  test("updates the position form when position-changed arrives", async () => {
    const wrapper = mountSettingsWindow();
    await flushPromises();

    const call = listenMock.mock.calls.find(
      ([eventName]) => eventName === "position-changed",
    );
    expect(call, "should listen for position-changed").toBeDefined();
    const handler = call?.[1] as (event: {
      payload: { x: number; y: number };
    }) => void;

    handler({ payload: { x: 321, y: 654 } });
    await flushPromises();

    const xInput = wrapper.find<HTMLInputElement>("#position-x");
    expect(xInput.element.value).toBe("321");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run tests/SettingsWindow.test.ts`
Expected: 新規テストがFAIL（emitされない、listenされない）。既存テストはPASSのまま

- [ ] **Step 3: SettingsWindow.vueを修正する**

script setupの変更点:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { emit as emitEvent, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onMounted, onUnmounted, ref } from "vue";
import { POSITION_CHANGED_EVENT, SETTINGS_UPDATED_EVENT } from "./constants";
import type { Settings, WindowPosition } from "./types/settings";
import { createDefaultSettings, sanitizeSettings } from "./types/settings";
```

（`@tauri-apps/plugin-dialog`のimportと`selectImage`関数は`ImageSlot`に移ったため削除する）

`saveSettings`を変更（保存成功後にemit）:

```typescript
async function saveSettings() {
  isSaving.value = true;
  try {
    // InputNumberの空入力によるnullを保存前に補完する
    settings.value = sanitizeSettings(settings.value);
    await invoke("save_settings", { settings: settings.value });
    // メインウィンドウは保存済みの設定だけを反映する
    await emitEvent(SETTINGS_UPDATED_EVENT, settings.value);
    showStatus("Settings saved");
  } catch (error) {
    showStatus(`Failed to save settings: ${error}`, true);
  } finally {
    isSaving.value = false;
  }
}
```

`onMounted`を変更し、`position-changed`の購読を追加:

```typescript
let unlistenPosition: UnlistenFn | undefined;

onMounted(async () => {
  await loadSettings();
  // メインウィンドウのドラッグ結果をフォームへ即時反映する
  unlistenPosition = await listen<WindowPosition>(POSITION_CHANGED_EVENT, (event) => {
    settings.value.windowPosition = event.payload;
  });
});

onUnmounted(() => {
  unlistenPosition?.();
});
```

templateの画像セクションを`ImageSlot`に置き換え:

```vue
<div class="settings-section">
  <h2>Mascot Images</h2>
  <div class="image-settings">
    <ImageSlot
      v-for="slot in imageSlots"
      :key="slot.key"
      v-model="settings.images[slot.key]"
      :label="slot.label"
      :image-type="slot.key"
      @error="(message) => showStatus(message, true)"
    />
  </div>
</div>
```

（`ImageSlot`は`unplugin-vue-components`が自動インポートする。`.image-item` / `.image-input-group`のスタイルと、既存テスト`SettingsWindow image inputs`の`#image-*`入力欄は不要になるため削除する）

- [ ] **Step 4: 既存テストの調整**

`tests/SettingsWindow.test.ts`の`SettingsWindow image inputs`describeを、新しいUIに合わせて置き換える:

```typescript
describe("SettingsWindow image inputs", () => {
  test("renders an image slot for each image type", async () => {
    const wrapper = mountSettingsWindow();
    await flushPromises();

    const labels = ["Typing Image 1", "Typing Image 2", "Idle Image"];
    for (const label of labels) {
      expect(wrapper.text()).toContain(label);
    }
    expect(wrapper.findAll(".image-slot")).toHaveLength(3);
  });
});
```

（`ImageSlot`が内部で使う`Button`は自動インポートに任せ、テストのmount設定は既存のまま。もし`Button`が解決されない場合は`global.components`に`Button`を追加する）

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm vitest run tests/SettingsWindow.test.ts`
Expected: PASS（全件）

- [ ] **Step 6: フォーマット・lint後、ユーザーにコミット可否を確認し、承認後にコミット**

```bash
just format && just lint
git add src/SettingsWindow.vue tests/SettingsWindow.test.ts
git commit -m "Wire settings window to image slots and window events"
```

---

### Task 8: ウィンドウ設定適用モジュール（フロントエンド）

**Files:**
- Create: `src/windowSettings.ts`
- Test: `tests/windowSettings.test.ts`

**Interfaces:**
- Consumes: `@tauri-apps/api/window`の`getCurrentWindow` / `PhysicalPosition` / `LogicalSize`
- Produces: `applyWindowSettings(settings: Settings): Promise<void>`（位置・サイズ・alwaysOnTopをネイティブウィンドウに適用）

- [ ] **Step 1: 失敗するテストを書く**

`tests/windowSettings.test.ts`を作成:

```typescript
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => {
  class PhysicalPosition {
    constructor(
      public x: number,
      public y: number,
    ) {}
  }
  class LogicalSize {
    constructor(
      public width: number,
      public height: number,
    ) {}
  }
  return { getCurrentWindow: vi.fn(), PhysicalPosition, LogicalSize };
});

import { getCurrentWindow } from "@tauri-apps/api/window";
import { createDefaultSettings } from "../src/types/settings";
import { applyWindowSettings } from "../src/windowSettings";

const getCurrentWindowMock = vi.mocked(getCurrentWindow);

const windowStub = {
  setPosition: vi.fn(),
  setSize: vi.fn(),
  setAlwaysOnTop: vi.fn(),
};

beforeEach(() => {
  windowStub.setPosition.mockReset();
  windowStub.setSize.mockReset();
  windowStub.setAlwaysOnTop.mockReset();
  // biome-ignore lint/suspicious/noExplicitAny: テストではウィンドウの一部メソッドだけを模倣する
  getCurrentWindowMock.mockReturnValue(windowStub as any);
});

describe("applyWindowSettings", () => {
  test("applies position, size, and always-on-top", async () => {
    const settings = createDefaultSettings();
    settings.windowPosition = { x: 10, y: 20 };
    settings.windowSize = { width: 300, height: 400 };
    settings.alwaysOnTop = false;

    await applyWindowSettings(settings);

    expect(windowStub.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ x: 10, y: 20 }),
    );
    expect(windowStub.setSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 300, height: 400 }),
    );
    expect(windowStub.setAlwaysOnTop).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run tests/windowSettings.test.ts`
Expected: FAIL（`../src/windowSettings`が存在しない）

- [ ] **Step 3: 実装を書く**

`src/windowSettings.ts`を作成:

```typescript
import {
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import type { Settings } from "./types/settings";

/**
 * Applies persisted settings to the current native window.
 */
export async function applyWindowSettings(settings: Settings): Promise<void> {
  const window = getCurrentWindow();
  // 位置はドラッグ時のonMovedイベントが返す物理座標と単位を揃え、
  // サイズはtauri.conf.jsonの論理サイズ指定と単位を揃える
  await window.setPosition(
    new PhysicalPosition(settings.windowPosition.x, settings.windowPosition.y),
  );
  await window.setSize(
    new LogicalSize(settings.windowSize.width, settings.windowSize.height),
  );
  await window.setAlwaysOnTop(settings.alwaysOnTop);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run tests/windowSettings.test.ts`
Expected: PASS

- [ ] **Step 5: フォーマット・lint後、ユーザーにコミット可否を確認し、承認後にコミット**

```bash
just format && just lint
git add src/windowSettings.ts tests/windowSettings.test.ts
git commit -m "Add native window settings applier"
```

---

### Task 9: メインウィンドウの統合（フロントエンド）

**Files:**
- Create: `src/debounce.ts`
- Modify: `src/App.vue`
- Test: `tests/debounce.test.ts`、`tests/App.test.ts`（追加）

**Interfaces:**
- Consumes: `applyWindowSettings`、`loadImageDataUrl`、`SETTINGS_UPDATED_EVENT` / `POSITION_CHANGED_EVENT`、Tauriコマンド`get_settings` / `save_window_position`、`getCurrentWindow().onMoved`
- Produces: 起動時とイベント受信時の設定反映、ドラッグ後の位置永続化

- [ ] **Step 1: debounceの失敗するテストを書く**

`tests/debounce.test.ts`を作成:

```typescript
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { debounce } from "../src/debounce";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("debounce", () => {
  test("runs only once after rapid calls, with the last arguments", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);

    debounced(1);
    debounced(2);
    debounced(3);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  test("runs again for calls after the wait period", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);

    debounced("a");
    vi.advanceTimersByTime(500);
    debounced("b");
    vi.advanceTimersByTime(500);

    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run tests/debounce.test.ts`
Expected: FAIL（`../src/debounce`が存在しない）

- [ ] **Step 3: debounceを実装する**

`src/debounce.ts`を作成:

```typescript
/**
 * Returns a debounced version of `fn` that runs only after `waitMs`
 * milliseconds have passed without another call.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}
```

Run: `pnpm vitest run tests/debounce.test.ts`
Expected: PASS

- [ ] **Step 4: App.vueの失敗するテストを書く**

`tests/App.test.ts`のモックを拡充する。ファイル冒頭のモック群を以下に置き換え:

```typescript
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: {
    getByLabel: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

vi.mock("../src/windowSettings", () => ({
  applyWindowSettings: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "../src/App.vue";
import { createDefaultSettings } from "../src/types/settings";
import { applyWindowSettings } from "../src/windowSettings";

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const getCurrentWindowMock = vi.mocked(getCurrentWindow);
const applyWindowSettingsMock = vi.mocked(applyWindowSettings);

const windowStub = {
  onMoved: vi.fn(),
};

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockClear();
  applyWindowSettingsMock.mockReset();
  windowStub.onMoved.mockReset();
  windowStub.onMoved.mockResolvedValue(() => {});
  // biome-ignore lint/suspicious/noExplicitAny: テストではウィンドウの一部メソッドだけを模倣する
  getCurrentWindowMock.mockReturnValue(windowStub as any);
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "get_settings") return createDefaultSettings();
    return undefined;
  });
});
```

既存の2つのdescribe（`App drag region`）はそのまま残し、以下を追加:

```typescript
describe("App settings application", () => {
  test("applies window settings on startup", async () => {
    mount(App);
    await flushPromises();

    expect(invokeMock).toHaveBeenCalledWith("get_settings");
    expect(applyWindowSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ animationSpeed: 200 }),
    );
  });

  test("shows the idle image when one is registered", async () => {
    const settings = createDefaultSettings();
    settings.images.idle = "/data/images/idle.png";
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return settings;
      if (cmd === "load_image") return "QUJD";
      return undefined;
    });

    const wrapper = mount(App);
    await flushPromises();

    const img = wrapper.find("img.mascot-image");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("data:image/png;base64,QUJD");
    // 画像もドラッグ領域として機能する必要がある
    expect(img.attributes("data-tauri-drag-region")).toBeDefined();
    expect(wrapper.find(".mascot-placeholder").exists()).toBe(false);
  });

  test("keeps the placeholder when no idle image is registered", async () => {
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.find("img.mascot-image").exists()).toBe(false);
    expect(wrapper.find(".mascot-placeholder").exists()).toBe(true);
  });

  test("re-applies settings when settings-updated arrives", async () => {
    mount(App);
    await flushPromises();

    const call = listenMock.mock.calls.find(
      ([eventName]) => eventName === "settings-updated",
    );
    expect(call, "should listen for settings-updated").toBeDefined();
    const handler = call?.[1] as (event: { payload: unknown }) => void;

    const updated = createDefaultSettings();
    updated.opacity = 0.5;
    handler({ payload: updated });
    await flushPromises();

    expect(applyWindowSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ opacity: 0.5 }),
    );
  });
});

describe("App drag position persistence", () => {
  test("saves the position after the window stops moving", async () => {
    // fake timers有効中はflushPromisesが進まないため、マウント完了後に有効化する
    mount(App);
    await flushPromises();
    expect(windowStub.onMoved).toHaveBeenCalled();
    const handler = windowStub.onMoved.mock.calls[0][0] as (event: {
      payload: { x: number; y: number };
    }) => void;

    vi.useFakeTimers();
    try {

      handler({ payload: { x: 5, y: 6 } });
      handler({ payload: { x: 7, y: 8 } });
      expect(invokeMock).not.toHaveBeenCalledWith(
        "save_window_position",
        expect.anything(),
      );

      await vi.advanceTimersByTimeAsync(500);
      expect(invokeMock).toHaveBeenCalledWith("save_window_position", {
        x: 7,
        y: 8,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 5: テストが失敗することを確認**

Run: `pnpm vitest run tests/App.test.ts`
Expected: 新規describeがFAIL（既存のdrag regionテストはPASSのまま）

- [ ] **Step 6: App.vueを修正する**

script setupを以下に置き換え:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { emit as emitEvent, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { onMounted, onUnmounted, ref } from "vue";
import {
  POSITION_CHANGED_EVENT,
  SETTINGS_UPDATED_EVENT,
  SETTINGS_WINDOW_URL,
} from "./constants";
import { debounce } from "./debounce";
import { loadImageDataUrl } from "./images";
import type { Settings } from "./types/settings";
import { applyWindowSettings } from "./windowSettings";

const mascotUrl = ref<string | null>(null);
const mascotOpacity = ref(1);

// 設定をメインウィンドウの見た目とネイティブプロパティに反映する
async function applySettings(settings: Settings) {
  mascotOpacity.value = settings.opacity;
  mascotUrl.value = await loadImageDataUrl(settings.images.idle);
  await applyWindowSettings(settings);
}

const unlisteners: Array<() => void> = [];

onMounted(async () => {
  try {
    const settings = await invoke<Settings>("get_settings");
    await applySettings(settings);
  } catch (error) {
    console.error("Failed to load settings:", error);
  }

  unlisteners.push(
    await listen<Settings>(SETTINGS_UPDATED_EVENT, (event) => {
      applySettings(event.payload);
    }),
  );

  // ドラッグ中はonMovedが連続発火するため、静止後に一度だけ保存する
  const savePosition = debounce(async (x: number, y: number) => {
    try {
      await invoke("save_window_position", { x, y });
      await emitEvent(POSITION_CHANGED_EVENT, { x, y });
    } catch (error) {
      console.error("Failed to save window position:", error);
    }
  }, 500);
  unlisteners.push(
    await getCurrentWindow().onMoved((event) => {
      savePosition(event.payload.x, event.payload.y);
    }),
  );
});

onUnmounted(() => {
  for (const unlisten of unlisteners) {
    unlisten();
  }
});

// 設定ウィンドウを開く
async function openSettings() {
  const settingsWindow = await WebviewWindow.getByLabel("settings");

  if (settingsWindow) {
    await settingsWindow.show();
    await settingsWindow.setFocus();
  } else {
    new WebviewWindow("settings", {
      url: SETTINGS_WINDOW_URL,
      title: "Settings",
      width: 600,
      height: 500,
      resizable: true,
    });
  }
}

// 右クリックでメニューを表示
function handleContextMenu(_event: MouseEvent) {
  openSettings();
}
```

templateのマスコット表示部分を変更（`.mascot-container`の中身）:

```vue
<div class="mascot-container" data-tauri-drag-region :style="{ opacity: mascotOpacity }">
  <img
    v-if="mascotUrl"
    class="mascot-image"
    :src="mascotUrl"
    alt="Mascot"
    data-tauri-drag-region
  />
  <div v-else class="mascot-placeholder" data-tauri-drag-region>
    <!-- マスコット画像が未登録の間のプレースホルダー -->
    <div class="mascot-text" data-tauri-drag-region>🐱</div>
  </div>
  <button type="button" class="settings-btn" @click="openSettings">
    設定
  </button>
</div>
```

styleに追加:

```css
.mascot-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}
```

- [ ] **Step 7: 既存のdrag regionテストの調整**

`tests/App.test.ts`の`all full-size elements carry data-tauri-drag-region`テストは、プレースホルダー表示時（デフォルト）のセレクタを対象にしているためそのまま通るはず。`mount(App)`が非同期初期化を伴うようになるため、各既存テストの`mount(App)`直後に`await flushPromises();`を追加し、テスト関数を`async`にする。

- [ ] **Step 8: テストが通ることを確認**

Run: `pnpm vitest run tests/App.test.ts tests/debounce.test.ts`
Expected: PASS（全件）

- [ ] **Step 9: フォーマット・lint後、ユーザーにコミット可否を確認し、承認後にコミット**

```bash
just format && just lint
git add src/App.vue src/debounce.ts tests/App.test.ts tests/debounce.test.ts
git commit -m "Apply settings to main window and persist drag position"
```

---

### Task 10: 仕上げと動作確認

**Files:**
- Modify: `docs/tasks.md`（フェーズ2の完了項目にチェック）
- Modify: `CLAUDE.md`（必要ならKey locationsに`src-tauri/src/images.rs` / `png.rs`等を追記）

**Interfaces:**
- Consumes: これまでの全タスクの成果物
- Produces: フェーズ2完了状態のブランチ

- [ ] **Step 1: 全テスト・型チェック・lintを実行して緑を確認**

```bash
pnpm test && pnpm build && just lint
```

Expected: すべて成功（`pnpm test`はcargo test + vitest、`pnpm build`はvue-tscの型チェックを含む）

- [ ] **Step 2: 実機での動作確認**

`pnpm tauri dev`はGUIを伴うため、ユーザーに以下の確認を依頼する:

1. 設定ウィンドウでPNG画像（512px以下）を登録→プレビューが出る
2. 513px以上のPNGや非PNGを選択→エラーメッセージが表示される
3. Save→メインウィンドウにアイドル画像・透明度・位置・サイズが反映される
4. メインウィンドウをドラッグ→設定ウィンドウの位置フォームが追従し、再起動後も位置が復元される
5. Reset→両ウィンドウが初期状態に戻る

- [ ] **Step 3: ドキュメントを更新**

`docs/tasks.md`のフェーズ2各項目、およびフェーズ1の未チェック項目（実装済みのもの）に`[x]`を付ける。`CLAUDE.md`のKey locationsに新モジュール（`src-tauri/src/png.rs`、`src-tauri/src/images.rs`、`src/components/ImageSlot.vue`、`src/windowSettings.ts`）を1行ずつ追記する。

- [ ] **Step 4: ユーザーにコミット可否を確認し、承認後にコミット**

```bash
git add docs/tasks.md CLAUDE.md
git commit -m "Mark phase 2 tasks complete and update key locations"
```

- [ ] **Step 5: ブランチの統合**

superpowers:finishing-a-development-branchスキルを使用し、PR作成（`develop`向け）等の統合方法をユーザーと決める。
