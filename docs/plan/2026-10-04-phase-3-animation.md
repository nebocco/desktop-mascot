# フェーズ3: アニメーション機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** キーボード入力をグローバルに検知し、打鍵に合わせてマスコットが2枚の画像を交互に表示し、入力が止まるとアイドル画像に戻るようにする。

**Architecture:** Rust側に `src-tauri/src/animation/` を新設する。キー検知（`key_source.rs`）がチャネルへ通知を流し、常駐スレッド（`runner.rs`）が純粋関数（`logic.rs`）で次のフレームを決め、変化したときだけ `animation-frame` イベントをメインウィンドウへ送る。フロントは読み込み済みの3枚から表示する画像を選ぶだけにする。

**Tech Stack:** Tauri 2 / Rust（`rdev` 系のキー検知クレート、`std::sync::mpsc`）/ Vue 3 + TypeScript / Vitest / PrimeVue

**Spec:** `docs/spec/2026-10-04-phase-3-animation.md`

## Global Constraints

- 対象OSは Windows・macOS・Linux(X11)
- 後方互換とデータ移行は行わない。既存の `settings.json` を読めるようにするためのコードやテストは書かない
- キー検知から外に出すのは「キーが押された」という事実だけ。キーの種類は保持もログ出力もしない
- `animationSpeed` は 50〜500ms（デフォルト200ms）、`idleTimeout` は 300〜5000ms（デフォルト1000ms）
- イベント名は `animation-frame`、ペイロードは `"idle"` / `"typing1"` / `"typing2"`
- 差し替えのための抽象（トレイトなど）は作らない
- rustdoc / JSDoc は英語、インラインコメントは日本語。コメントに計画上の記号（`Task 2`、`Phase 3`、`Step` など）や `docs/...` のパスを書かない（`check-comment-refs` フックが拒否する）
- pre-commit フックはテストを実行しない。各タスクのコミット前に、そのタスクのテストコマンドを手動で実行する
- `CLAUDE.md` にある `--features dev-tools` は存在しない。Rustのテストは `cargo test --manifest-path src-tauri/Cargo.toml` で実行する
- `src-tauri/` を含むコミットは clippy が走るので、タイムアウトを10分取る

## Review Focus

どのタスクのテストでも自然には通らないが、利用者が踏みやすい条件。各行のテストは担当タスクに入れてある。

1. **`settings.json` に範囲外の値（0、負数、巨大な値）が入っている** → 範囲内に丸めて動く（Task 1 `config_from_millis_clamps_out_of_range_values`）
2. **キー検知が開始できない、または途中で止まる（Wayland、macOSの権限なし）** → アプリは落ちず、表示はidleに戻る（Task 2 `emits_idle_when_key_source_disconnects_mid_typing`）
3. **typing画像が未登録** → そのフレームではidle画像を表示する（Task 6 `falls back to the idle image`）
4. **`animationSpeed` より速い連打や押しっぱなし** → フレームは変わらないが、アイドル復帰は先延ばしになる（Task 1 `key_within_frame_min_keeps_frame_but_extends_activity`）
5. **入力中に設定を保存する** → 再起動なしで新しい速度が効く（Task 2 `picks_up_config_changes_between_keys`）

## File Structure

| ファイル | 変更 | 責務 |
|---|---|---|
| `src-tauri/src/animation/mod.rs` | 新規 | 型（`Frame` / `AnimationConfig` / `AnimationState`）とイベント名 |
| `src-tauri/src/animation/logic.rs` | 新規 | 状態遷移の純粋関数 |
| `src-tauri/src/animation/runner.rs` | 新規 | 常駐ループと共有設定 |
| `src-tauri/src/animation/key_source.rs` | 新規 | キー検知クレートの呼び出し |
| `src-tauri/src/lib.rs` | 変更 | `Settings.idle_timeout`、起動時の配線、保存・リセット時の設定更新 |
| `src-tauri/Cargo.toml` | 変更 | キー検知クレートの追加 |
| `src/animation.ts` | 新規 | フレーム名から表示画像を選ぶ純粋関数 |
| `src/types/settings.ts` | 変更 | `idleTimeout` |
| `src/constants.ts` | 変更 | `ANIMATION_FRAME_EVENT` |
| `src/App.vue` | 変更 | 3枚の読み込みとフレームイベントの購読 |
| `src/SettingsWindow.vue` | 変更 | Idle Timeout スライダー |

---

### Task 1: アニメーションの型と状態遷移

**Files:**
- Create: `src-tauri/src/animation/mod.rs`
- Create: `src-tauri/src/animation/logic.rs`
- Modify: `src-tauri/src/lib.rs:1-3`

**Interfaces:**
- Produces:
  - `animation::Frame`（`Idle` / `Typing1` / `Typing2`、`Copy`、小文字でシリアライズ）
  - `animation::AnimationConfig { frame_min: Duration, idle_timeout: Duration }`（`Copy`）
  - `animation::AnimationState { frame, last_switch_at: Instant, last_key_at: Instant }`（`Copy`）、`AnimationState::idle(now: Instant) -> Self`
  - `animation::ANIMATION_FRAME_EVENT: &str = "animation-frame"`
  - `animation::logic::config_from_millis(animation_speed: i32, idle_timeout: i32) -> AnimationConfig`
  - `animation::logic::on_key(state, now: Instant, config) -> AnimationState`
  - `animation::logic::on_timeout(state, now: Instant, config) -> AnimationState`
  - `animation::logic::next_wait(state, now: Instant, config) -> Option<Duration>`

- [ ] **Step 1: モジュールを宣言する**

`src-tauri/src/lib.rs` の先頭の `mod` 宣言に追加する。配線が入るまで未使用の項目で clippy が落ちないよう、このモジュールだけ `pub` にする（Task 5 で `mod` に戻す）。

```rust
pub mod animation;
mod images;
mod logging;
mod png;
```

- [ ] **Step 2: 型を書く**

`src-tauri/src/animation/mod.rs`:

```rust
//! Keyboard-driven mascot animation: key detection, frame state machine,
//! and the background loop that tells the main window which frame to show.

pub mod logic;

use serde::Serialize;
use std::time::{Duration, Instant};

/// Name of the event carrying the frame the main window should display.
pub const ANIMATION_FRAME_EVENT: &str = "animation-frame";

/// Image the main window should currently display.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Frame {
    Idle,
    Typing1,
    Typing2,
}

/// Timing parameters derived from the user's settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AnimationConfig {
    /// Minimum time a typing frame stays on screen before the next key
    /// press may switch it.
    pub frame_min: Duration,
    /// Time without key presses after which the mascot returns to idle.
    pub idle_timeout: Duration,
}

/// Snapshot of the animation at one point in time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AnimationState {
    pub frame: Frame,
    pub last_switch_at: Instant,
    pub last_key_at: Instant,
}

impl AnimationState {
    /// Returns the state the animation starts in.
    pub fn idle(now: Instant) -> Self {
        AnimationState {
            frame: Frame::Idle,
            last_switch_at: now,
            last_key_at: now,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_serializes_to_the_lowercase_names_the_frontend_expects() {
        assert_eq!(serde_json::to_string(&Frame::Idle).unwrap(), "\"idle\"");
        assert_eq!(
            serde_json::to_string(&Frame::Typing1).unwrap(),
            "\"typing1\""
        );
        assert_eq!(
            serde_json::to_string(&Frame::Typing2).unwrap(),
            "\"typing2\""
        );
    }
}
```

- [ ] **Step 3: 失敗するテストを書く**

`src-tauri/src/animation/logic.rs`（この時点ではテストだけ）:

```rust
//! Pure state transitions for the mascot animation. No I/O and no clock
//! access: callers pass the current time in.

use super::{AnimationConfig, AnimationState, Frame};
use std::time::{Duration, Instant};

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(value: u64) -> Duration {
        Duration::from_millis(value)
    }

    fn config() -> AnimationConfig {
        AnimationConfig {
            frame_min: ms(200),
            idle_timeout: ms(1000),
        }
    }

    #[test]
    fn key_from_idle_shows_typing1_immediately() {
        let t0 = Instant::now();
        let state = on_key(AnimationState::idle(t0), t0 + ms(1), config());
        assert_eq!(state.frame, Frame::Typing1);
        assert_eq!(state.last_switch_at, t0 + ms(1));
        assert_eq!(state.last_key_at, t0 + ms(1));
    }

    #[test]
    fn key_within_frame_min_keeps_frame_but_extends_activity() {
        let t0 = Instant::now();
        let typing = on_key(AnimationState::idle(t0), t0, config());
        let state = on_key(typing, t0 + ms(100), config());
        assert_eq!(state.frame, Frame::Typing1);
        assert_eq!(state.last_switch_at, t0);
        assert_eq!(state.last_key_at, t0 + ms(100));

        // 連打で復帰が先延ばしになるので、最初のキーから1000ms経っても戻らない
        let later = on_timeout(state, t0 + ms(1050), config());
        assert_eq!(later.frame, Frame::Typing1);
    }

    #[test]
    fn key_after_frame_min_alternates_typing_frames() {
        let t0 = Instant::now();
        let first = on_key(AnimationState::idle(t0), t0, config());
        let second = on_key(first, t0 + ms(200), config());
        let third = on_key(second, t0 + ms(400), config());
        assert_eq!(second.frame, Frame::Typing2);
        assert_eq!(third.frame, Frame::Typing1);
    }

    #[test]
    fn timeout_returns_to_idle_only_after_idle_timeout() {
        let t0 = Instant::now();
        let typing = on_key(AnimationState::idle(t0), t0, config());
        assert_eq!(
            on_timeout(typing, t0 + ms(999), config()).frame,
            Frame::Typing1
        );
        assert_eq!(
            on_timeout(typing, t0 + ms(1000), config()).frame,
            Frame::Idle
        );
    }

    #[test]
    fn timeout_leaves_idle_untouched() {
        let t0 = Instant::now();
        let idle = AnimationState::idle(t0);
        assert_eq!(on_timeout(idle, t0 + ms(5000), config()), idle);
    }

    #[test]
    fn next_wait_is_none_while_idle() {
        let t0 = Instant::now();
        assert_eq!(next_wait(AnimationState::idle(t0), t0, config()), None);
    }

    #[test]
    fn next_wait_is_the_time_left_until_idle() {
        let t0 = Instant::now();
        let typing = on_key(AnimationState::idle(t0), t0, config());
        assert_eq!(next_wait(typing, t0 + ms(300), config()), Some(ms(700)));
        assert_eq!(next_wait(typing, t0 + ms(2000), config()), Some(ms(0)));
    }

    #[test]
    fn config_from_millis_keeps_values_inside_the_range() {
        assert_eq!(
            config_from_millis(200, 1000),
            AnimationConfig {
                frame_min: ms(200),
                idle_timeout: ms(1000),
            }
        );
    }

    #[test]
    fn config_from_millis_clamps_out_of_range_values() {
        assert_eq!(
            config_from_millis(0, -5),
            AnimationConfig {
                frame_min: ms(50),
                idle_timeout: ms(300),
            }
        );
        assert_eq!(
            config_from_millis(9999, 99_999),
            AnimationConfig {
                frame_min: ms(500),
                idle_timeout: ms(5000),
            }
        );
    }
}
```

- [ ] **Step 4: テストが失敗することを確認する**

Run: `cargo test --manifest-path src-tauri/Cargo.toml animation::`
Expected: コンパイルエラー（`on_key` / `on_timeout` / `next_wait` / `config_from_millis` が見つからない）

- [ ] **Step 5: 実装を書く**

`src-tauri/src/animation/logic.rs` の `use` と `#[cfg(test)]` の間に追加する。

```rust
const ANIMATION_SPEED_RANGE_MS: (i32, i32) = (50, 500);
const IDLE_TIMEOUT_RANGE_MS: (i32, i32) = (300, 5000);

/// Builds the timing parameters from the raw settings values, clamping
/// each into its supported range.
pub fn config_from_millis(animation_speed: i32, idle_timeout: i32) -> AnimationConfig {
    // 設定ファイルは手で編集できるため、保存された値をそのまま信用しない
    let clamp = |value: i32, (min, max): (i32, i32)| {
        Duration::from_millis(u64::from(value.clamp(min, max).unsigned_abs()))
    };
    AnimationConfig {
        frame_min: clamp(animation_speed, ANIMATION_SPEED_RANGE_MS),
        idle_timeout: clamp(idle_timeout, IDLE_TIMEOUT_RANGE_MS),
    }
}

/// Returns the state after a key press at `now`.
pub fn on_key(state: AnimationState, now: Instant, config: AnimationConfig) -> AnimationState {
    let since_switch = now.saturating_duration_since(state.last_switch_at);
    let frame = match state.frame {
        Frame::Idle => Frame::Typing1,
        Frame::Typing1 if since_switch >= config.frame_min => Frame::Typing2,
        Frame::Typing2 if since_switch >= config.frame_min => Frame::Typing1,
        current => current,
    };
    AnimationState {
        frame,
        last_switch_at: if frame == state.frame {
            state.last_switch_at
        } else {
            now
        },
        last_key_at: now,
    }
}

/// Returns the state after time has passed without a key press.
pub fn on_timeout(state: AnimationState, now: Instant, config: AnimationConfig) -> AnimationState {
    let since_key = now.saturating_duration_since(state.last_key_at);
    if state.frame == Frame::Idle || since_key < config.idle_timeout {
        return state;
    }
    AnimationState {
        frame: Frame::Idle,
        last_switch_at: now,
        last_key_at: state.last_key_at,
    }
}

/// Returns how long to wait for the next key press before the idle
/// timeout must be checked, or `None` when only a key press can change
/// the state.
pub fn next_wait(state: AnimationState, now: Instant, config: AnimationConfig) -> Option<Duration> {
    if state.frame == Frame::Idle {
        return None;
    }
    let since_key = now.saturating_duration_since(state.last_key_at);
    Some(config.idle_timeout.saturating_sub(since_key))
}
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `cargo test --manifest-path src-tauri/Cargo.toml animation::`
Expected: 10 passed

- [ ] **Step 7: コミットする**

```bash
git add src-tauri/src/lib.rs src-tauri/src/animation/
git commit -m "Add animation frame state machine"
```

---

### Task 2: 常駐ループ

**Files:**
- Create: `src-tauri/src/animation/runner.rs`
- Modify: `src-tauri/src/animation/mod.rs`（`pub mod runner;` を追加）

**Interfaces:**
- Consumes: Task 1 の `Frame` / `AnimationConfig` / `AnimationState` / `logic::{on_key, on_timeout, next_wait}`
- Produces:
  - `animation::runner::SharedConfig`（`Arc<Mutex<AnimationConfig>>`）
  - `animation::runner::update_config(shared: &SharedConfig, config: AnimationConfig)`
  - `animation::runner::run(keys: Receiver<()>, config: SharedConfig, emit: impl FnMut(Frame))`（送信側がすべて破棄されるまでブロックする）

- [ ] **Step 1: モジュールを宣言する**

`src-tauri/src/animation/mod.rs` の `pub mod logic;` の下に追加する。

```rust
pub mod runner;
```

- [ ] **Step 2: 失敗するテストを書く**

`src-tauri/src/animation/runner.rs`（この時点ではテストだけ）:

```rust
//! Background loop that turns key notifications into frame changes.

use super::logic::{next_wait, on_key, on_timeout};
use super::{AnimationConfig, AnimationState, Frame};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    fn shared(frame_min_ms: u64, idle_timeout_ms: u64) -> SharedConfig {
        Arc::new(Mutex::new(AnimationConfig {
            frame_min: Duration::from_millis(frame_min_ms),
            idle_timeout: Duration::from_millis(idle_timeout_ms),
        }))
    }

    /// Runs the loop on its own thread and returns the key sender, the
    /// emitted frames, and the thread handle.
    fn start(
        config: SharedConfig,
    ) -> (
        mpsc::Sender<()>,
        mpsc::Receiver<Frame>,
        thread::JoinHandle<()>,
    ) {
        let (key_tx, key_rx) = mpsc::channel();
        let (frame_tx, frame_rx) = mpsc::channel();
        let handle = thread::spawn(move || {
            run(key_rx, config, move |frame| {
                frame_tx.send(frame).unwrap();
            });
        });
        (key_tx, frame_rx, handle)
    }

    #[test]
    fn alternates_on_keys_and_returns_to_idle_after_the_timeout() {
        let (keys, frames, handle) = start(shared(0, 30));
        keys.send(()).unwrap();
        keys.send(()).unwrap();
        // アイドル復帰(30ms)を待つ。復帰の判定だけは実時間に依存する
        thread::sleep(Duration::from_millis(200));
        drop(keys);
        handle.join().unwrap();

        assert_eq!(
            frames.try_iter().collect::<Vec<_>>(),
            vec![Frame::Typing1, Frame::Typing2, Frame::Idle]
        );
    }

    #[test]
    fn emits_idle_when_key_source_disconnects_mid_typing() {
        let (keys, frames, handle) = start(shared(0, 5000));
        keys.send(()).unwrap();
        drop(keys);
        handle.join().unwrap();

        assert_eq!(
            frames.try_iter().collect::<Vec<_>>(),
            vec![Frame::Typing1, Frame::Idle]
        );
    }

    #[test]
    fn emits_nothing_when_key_source_never_delivers() {
        let (keys, frames, handle) = start(shared(0, 5000));
        drop(keys);
        handle.join().unwrap();

        assert_eq!(frames.try_iter().count(), 0);
    }

    #[test]
    fn picks_up_config_changes_between_keys() {
        // 最初の設定では2打目でフレームが変わらない(最低表示時間が10秒)
        let config = shared(10_000, 5000);
        let (keys, frames, handle) = start(config.clone());
        keys.send(()).unwrap();
        assert_eq!(
            frames.recv_timeout(Duration::from_secs(1)).unwrap(),
            Frame::Typing1
        );

        update_config(
            &config,
            AnimationConfig {
                frame_min: Duration::ZERO,
                idle_timeout: Duration::from_millis(5000),
            },
        );
        keys.send(()).unwrap();
        assert_eq!(
            frames.recv_timeout(Duration::from_secs(1)).unwrap(),
            Frame::Typing2
        );

        drop(keys);
        handle.join().unwrap();
    }
}
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cargo test --manifest-path src-tauri/Cargo.toml animation::runner`
Expected: コンパイルエラー（`SharedConfig` / `run` / `update_config` が見つからない）

- [ ] **Step 4: 実装を書く**

`src-tauri/src/animation/runner.rs` の `use` と `#[cfg(test)]` の間に追加する。

```rust
/// Timing parameters shared between the loop and the settings commands.
pub type SharedConfig = Arc<Mutex<AnimationConfig>>;

/// Replaces the timing parameters the loop uses from its next step on.
pub fn update_config(shared: &SharedConfig, config: AnimationConfig) {
    *lock(shared) = config;
}

fn lock(shared: &SharedConfig) -> std::sync::MutexGuard<'_, AnimationConfig> {
    // 値は丸ごと差し替えるだけなので、他スレッドがパニックしていても中身は壊れていない
    shared.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Runs the animation until every key sender is dropped, calling `emit`
/// each time the displayed frame changes.
pub fn run(keys: Receiver<()>, config: SharedConfig, mut emit: impl FnMut(Frame)) {
    let mut state = AnimationState::idle(Instant::now());
    loop {
        let wait = next_wait(state, Instant::now(), *lock(&config));
        let received = match wait {
            Some(wait) => keys.recv_timeout(wait),
            None => keys.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };

        // 待っている間に設定が保存されている場合があるので、読み直す
        let current = *lock(&config);
        let now = Instant::now();
        let next = match received {
            Ok(()) => on_key(state, now, current),
            Err(RecvTimeoutError::Timeout) => on_timeout(state, now, current),
            Err(RecvTimeoutError::Disconnected) => break,
        };
        if next.frame != state.frame {
            emit(next.frame);
        }
        state = next;
    }

    // キー検知が止まったら、打鍵中の画像を出したままにしない
    if state.frame != Frame::Idle {
        emit(Frame::Idle);
    }
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cargo test --manifest-path src-tauri/Cargo.toml animation::`
Expected: 14 passed

- [ ] **Step 6: コミットする**

```bash
git add src-tauri/src/animation/
git commit -m "Add animation runner loop"
```

---

### Task 3: キー検知

**Files:**
- Create: `src-tauri/src/animation/key_source.rs`
- Modify: `src-tauri/src/animation/mod.rs`（`pub mod key_source;` を追加）
- Modify: `src-tauri/Cargo.toml`
- Modify: `docs/spec/2026-10-04-phase-3-animation.md`（「ライブラリの選定」節に結果を追記）

**Interfaces:**
- Produces: `animation::key_source::spawn(sender: std::sync::mpsc::Sender<()>)`（検知スレッドを起動してすぐ戻る。検知が止まると `sender` が破棄される）

- [ ] **Step 1: ライブラリを選ぶ**

候補は crates.io の `rdev` と、その派生版（`rdev` を fork したリポジトリを git 依存で使う形）。次を調べる。

- crates.io の `rdev` の最新バージョンと最終リリース日
- `rdev` のリポジトリの issue で、macOS でメインスレッド以外から `listen` を呼ぶとキー押下時にクラッシュする問題が、最新リリースで直っているか
- 直っていない場合、その修正を含む派生版があるか

選定基準: Windows・macOS・Linux(X11) の3つで `listen` が動くこと。crates.io 版が基準を満たすならそれを使う。満たさない場合だけ派生版を git 依存で使う。

**3つのOSで動くものが見つからなければ、ここで作業を止めて報告する。** 以降のステップに進まない。

- [ ] **Step 2: 依存を追加する**

crates.io 版を選んだ場合:

```bash
cargo add rdev --manifest-path src-tauri/Cargo.toml
```

派生版を選んだ場合は、`src-tauri/Cargo.toml` の `[dependencies]` に、選んだリポジトリとコミットを固定して書く。

```toml
rdev = { git = "<選んだリポジトリのURL>", rev = "<選んだコミットのSHA>" }
```

- [ ] **Step 3: モジュールを宣言する**

`src-tauri/src/animation/mod.rs` の `pub mod logic;` の上に追加する。

```rust
pub mod key_source;
```

- [ ] **Step 4: 実装を書く**

`src-tauri/src/animation/key_source.rs`:

```rust
//! Global key press detection. Only the fact that some key was pressed
//! leaves this module; which key it was is discarded here.

use std::sync::mpsc::Sender;
use tracing::warn;

/// Starts listening for key presses system-wide on a background thread,
/// sending one notification per press.
///
/// When listening cannot start or stops, the sender is dropped, which
/// tells the receiving side that no more key presses will arrive.
pub fn spawn(sender: Sender<()>) {
    std::thread::spawn(move || {
        let result = rdev::listen(move |event| {
            if matches!(event.event_type, rdev::EventType::KeyPress(_)) {
                // 受信側が終了していても検知スレッドは止めない
                let _ = sender.send(());
            }
        });
        if let Err(error) = result {
            // Waylandや、macOSで入力監視の権限がない場合はここに来る
            warn!(?error, "global key listener stopped; mascot stays idle");
        }
    });
}
```

- [ ] **Step 5: ビルドとテストが通ることを確認する**

Run: `cargo test --manifest-path src-tauri/Cargo.toml animation::`
Expected: 14 passed（このタスクで自動テストは増えない。OSのフックに依存するため）

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: 警告なし

システムライブラリの不足でビルドが失敗した場合は、不足しているパッケージ名を添えて作業を止め、報告する（`sudo` が必要なため）。

- [ ] **Step 6: 選定結果を spec に追記する**

`docs/spec/2026-10-04-phase-3-animation.md` の「ライブラリの選定」節の末尾に、次の見出しで追記する。

```markdown
### 選定結果

- 採用: （クレート名、バージョンまたはリポジトリとコミット）
- 理由: （Step 1 で確認した事実を1〜3行で）
- 未確認: Windows と macOS での実機動作（開発環境がWSLgのため）
```

- [ ] **Step 7: コミットする**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/animation/ docs/spec/2026-10-04-phase-3-animation.md
git commit -m "Add global key press detection"
```

---

### Task 4: `idleTimeout` 設定

**Files:**
- Modify: `src-tauri/src/lib.rs`（`Settings` 構造体、`Default`、テスト）
- Modify: `src/types/settings.ts`
- Modify: `src/SettingsWindow.vue:117-128` の直後
- Test: `tests/settings.test.ts`, `tests/SettingsWindow.test.ts`

**Interfaces:**
- Produces:
  - Rust: `Settings.idle_timeout: i32`（JSON上は `idleTimeout`、デフォルト1000）
  - TS: `Settings.idleTimeout: number`（デフォルト1000）

- [ ] **Step 1: 失敗するテストを書く（Rust）**

`src-tauri/src/lib.rs` の `mod tests` 内、`test_animation_speed_default` の下に追加する。

```rust
    #[test]
    fn test_idle_timeout_default() {
        assert_eq!(Settings::default().idle_timeout, 1000);
    }

    #[test]
    fn test_idle_timeout_uses_camel_case_in_json() {
        let json = serde_json::to_string(&Settings::default()).unwrap();
        assert!(json.contains("\"idleTimeout\":1000"));
    }
```

- [ ] **Step 2: 失敗するテストを書く（TS）**

`tests/settings.test.ts` の `describe("createDefaultSettings", ...)` 内に追加する。

```ts
  test("defaults the idle timeout to one second", () => {
    expect(createDefaultSettings().idleTimeout).toBe(1000);
  });
```

同じファイルの `describe("sanitizeSettings", ...)` 内に追加する。

```ts
  test("replaces a null idle timeout with the default", () => {
    const nulled = {
      ...createDefaultSettings(),
      idleTimeout: null,
    } as unknown as ReturnType<typeof createDefaultSettings>;

    expect(sanitizeSettings(nulled).idleTimeout).toBe(1000);
  });
```

`tests/SettingsWindow.test.ts` の末尾に追加する。

```ts
describe("SettingsWindow idle timeout", () => {
  test("shows the idle timeout and saves it with the settings", async () => {
    const wrapper = mountSettingsWindow();
    await flushPromises();

    expect(wrapper.text()).toContain("Idle Timeout (ms): 1000");

    await findButtonByLabel(wrapper, "Save Settings").trigger("click");
    await flushPromises();

    expect(invokeMock).toHaveBeenCalledWith("save_settings", {
      settings: expect.objectContaining({ idleTimeout: 1000 }),
    });
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_idle_timeout`
Expected: コンパイルエラー（`idle_timeout` フィールドがない）

Run: `pnpm exec vitest run tests/settings.test.ts tests/SettingsWindow.test.ts`
Expected: 追加した3件が FAIL

- [ ] **Step 4: Rust 側を実装する**

`src-tauri/src/lib.rs` の `Settings` 構造体で、`animation_speed` の下にフィールドを追加する。

```rust
    #[serde(rename = "idleTimeout")]
    idle_timeout: i32,
```

`impl Default for Settings` で、`animation_speed: 200,` の下に追加する。

```rust
            idle_timeout: 1000,
```

`test_settings_round_trip` は `Settings` をリテラルで組み立てているので、`animation_speed: 100,` の下に `idle_timeout: 1500,` を足し、末尾のアサーションに次を加える。

```rust
        assert_eq!(original.idle_timeout, deserialized.idle_timeout);
```

- [ ] **Step 5: TS 側を実装する**

`src/types/settings.ts` の `Settings` インターフェースで、`animationSpeed` の下に追加する。

```ts
  idleTimeout: number; // milliseconds without key presses before returning to idle (300-5000)
```

`createDefaultSettings` で、`animationSpeed: 200,` の下に追加する。

```ts
    idleTimeout: 1000,
```

`sanitizeSettings` の戻り値で、`animationSpeed: num(...)` の下に追加する。

```ts
    idleTimeout: num(settings.idleTimeout, defaults.idleTimeout),
```

- [ ] **Step 6: スライダーを追加する**

`src/SettingsWindow.vue` の Animation Speed の `slider-container`（`</div>` で閉じた直後）に追加する。

```vue
      <div class="slider-container">
        <span class="slider-label"
          >Idle Timeout (ms): {{ settings.idleTimeout }}</span
        >
        <Slider
          v-model="settings.idleTimeout"
          aria-label="Idle Timeout"
          :min="300"
          :max="5000"
          :step="100"
        />
      </div>
```

- [ ] **Step 7: テストが通ることを確認する**

Run: `pnpm test`
Expected: Rust・フロントとも全件 PASS

- [ ] **Step 8: コミットする**

```bash
git add src-tauri/src/lib.rs src/types/settings.ts src/SettingsWindow.vue tests/settings.test.ts tests/SettingsWindow.test.ts
git commit -m "Add idle timeout setting"
```

---

### Task 5: バックエンドの配線

**Files:**
- Modify: `src-tauri/src/lib.rs`（`mod` 宣言、`use`、`get_settings`、`save_settings`、`reset_settings`、`run`、テスト）

**Interfaces:**
- Consumes:
  - `animation::ANIMATION_FRAME_EVENT`
  - `animation::logic::config_from_millis(animation_speed: i32, idle_timeout: i32) -> AnimationConfig`
  - `animation::runner::{SharedConfig, update_config, run}`
  - `animation::key_source::spawn(sender: Sender<()>)`
  - `Settings.idle_timeout: i32`
- Produces: メインウィンドウ宛てのイベント `animation-frame`（ペイロードは `"idle"` / `"typing1"` / `"typing2"`）

- [ ] **Step 1: 失敗するテストを書く**

`src-tauri/src/lib.rs` の `mod tests` 内に追加する。

```rust
    #[test]
    fn test_animation_config_uses_speed_and_idle_timeout_from_settings() {
        let settings = Settings {
            animation_speed: 120,
            idle_timeout: 2500,
            ..Settings::default()
        };
        let config = animation_config(&settings);
        assert_eq!(config.frame_min, std::time::Duration::from_millis(120));
        assert_eq!(config.idle_timeout, std::time::Duration::from_millis(2500));
    }
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_animation_config`
Expected: コンパイルエラー（`animation_config` が見つからない）

- [ ] **Step 3: 設定の読み込みを関数に切り出す**

起動時にも設定を読むので、`get_settings` の本体を関数にする。`get_settings` を次の2つに置き換える。

```rust
/// Reads the settings file, returning defaults when it does not exist.
fn load_settings(app: &tauri::AppHandle) -> Result<Settings, String> {
    let settings_path = settings_path(app)?;

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
fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    load_settings(&app)
}
```

- [ ] **Step 4: アニメーションの起動処理を書く**

ファイル先頭を次のように変える（`animation` を `pub` から外し、`use` を足す）。

```rust
mod animation;
mod images;
mod logging;
mod png;

use animation::runner::SharedConfig;
use animation::AnimationConfig;
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::{mpsc, Arc, Mutex};
use tauri::{Emitter, Manager};
use tracing::{debug, warn};
```

`load_settings` の上に追加する。

```rust
/// Derives the animation timing from the settings.
fn animation_config(settings: &Settings) -> AnimationConfig {
    animation::logic::config_from_millis(settings.animation_speed, settings.idle_timeout)
}
```

`run` 関数の上に追加する。

```rust
/// Starts key detection and the loop that tells the main window which
/// frame to show.
fn start_animation(app: &tauri::AppHandle) {
    let settings = load_settings(app).unwrap_or_else(|error| {
        warn!(%error, "failed to load settings for animation; using defaults");
        Settings::default()
    });
    let config: SharedConfig = Arc::new(Mutex::new(animation_config(&settings)));
    app.manage(config.clone());

    let (sender, receiver) = mpsc::channel();
    animation::key_source::spawn(sender);

    let handle = app.clone();
    std::thread::spawn(move || {
        animation::runner::run(receiver, config, |frame| {
            debug!(?frame, "animation frame changed");
            if let Err(error) = handle.emit_to("main", animation::ANIMATION_FRAME_EVENT, frame) {
                warn!(%error, "failed to emit animation frame");
            }
        });
        warn!("animation loop stopped; mascot stays idle");
    });
}
```

`run` の `setup` を次のようにする。

```rust
        .setup(|app| {
            logging::log_window_environment(app.handle());
            start_animation(app.handle());
            Ok(())
        })
```

- [ ] **Step 5: 保存とリセットで設定を反映する**

`save_settings` のシグネチャに引数を足し、`fs::write` の直後で共有設定を更新する。

```rust
#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    animation_state: tauri::State<SharedConfig>,
    settings: Settings,
) -> Result<(), String> {
    let settings_path = settings_path(&app)?;
    debug!(path = ?settings_path, ?settings, "saving settings");

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&settings_path, json).map_err(|e| format!("Failed to write settings file: {}", e))?;

    // 再起動なしで速度とアイドル復帰時間の変更を効かせる
    animation::runner::update_config(animation_state.inner(), animation_config(&settings));
```

（この下の画像の片付け処理と `Ok(())` は変えない。）

`reset_settings` を次のようにする。

```rust
#[tauri::command]
fn reset_settings(
    app: tauri::AppHandle,
    animation_state: tauri::State<SharedConfig>,
) -> Result<Settings, String> {
    let settings_path = settings_path(&app)?;

    if settings_path.exists() {
        fs::remove_file(&settings_path)
            .map_err(|e| format!("Failed to delete settings file: {}", e))?;
    }

    let settings = Settings::default();
    animation::runner::update_config(animation_state.inner(), animation_config(&settings));
    Ok(settings)
}
```

- [ ] **Step 6: テストと lint が通ることを確認する**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全件 PASS

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: 警告なし（`animation` を `mod` に戻しても未使用の項目が残っていないこと）

- [ ] **Step 7: コミットする**

```bash
git add src-tauri/src/lib.rs
git commit -m "Run the animation loop and apply saved timing settings"
```

---

### Task 6: フロントエンドの表示

**Files:**
- Create: `src/animation.ts`
- Modify: `src/constants.ts`
- Modify: `src/App.vue`
- Test: `tests/animation.test.ts`（新規）, `tests/App.test.ts`

**Interfaces:**
- Consumes: イベント `animation-frame`（ペイロードは `"idle"` / `"typing1"` / `"typing2"`）
- Produces:
  - `ANIMATION_FRAME_EVENT`（`src/constants.ts`）
  - `Frame` / `FrameImages` / `selectFrameImage(frame: Frame, images: FrameImages): string | null`（`src/animation.ts`）

- [ ] **Step 1: 失敗するテストを書く（純粋関数）**

`tests/animation.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { selectFrameImage } from "../src/animation";

const all = { idle: "idle-url", typing1: "t1-url", typing2: "t2-url" };

describe("selectFrameImage", () => {
  test("returns the image registered for the frame", () => {
    expect(selectFrameImage("idle", all)).toBe("idle-url");
    expect(selectFrameImage("typing1", all)).toBe("t1-url");
    expect(selectFrameImage("typing2", all)).toBe("t2-url");
  });

  test("falls back to the idle image when a typing image is missing", () => {
    const images = { idle: "idle-url", typing1: null, typing2: null };
    expect(selectFrameImage("typing1", images)).toBe("idle-url");
    expect(selectFrameImage("typing2", images)).toBe("idle-url");
  });

  test("returns null when the idle image is missing too", () => {
    const images = { idle: null, typing1: null, typing2: null };
    expect(selectFrameImage("idle", images)).toBeNull();
    expect(selectFrameImage("typing1", images)).toBeNull();
  });
});
```

- [ ] **Step 2: 失敗するテストを書く（App）**

`tests/App.test.ts` の import に追加する。

```ts
import { ANIMATION_FRAME_EVENT } from "../src/constants";
```

ファイル末尾に追加する。

```ts
describe("App animation", () => {
  function mockRegisteredImages() {
    const settings = createDefaultSettings();
    settings.images = {
      idle: "/data/images/idle.png",
      typing1: "/data/images/typing1.png",
      typing2: "/data/images/typing2.png",
    };
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_settings") return settings;
      if (cmd === "supports_window_positioning") return true;
      // 画像ごとに違うデータを返し、どの画像が表示されているかを区別できるようにする
      if (cmd === "load_image") return btoa((args as { path: string }).path);
      return undefined;
    });
  }

  function frameHandler() {
    const call = listenMock.mock.calls.find(
      ([name]) => name === ANIMATION_FRAME_EVENT,
    );
    if (!call) {
      throw new Error("animation-frame listener was not registered");
    }
    return call[1] as unknown as (event: { payload: string }) => void;
  }

  function dataUrl(path: string) {
    return `data:image/png;base64,${btoa(path)}`;
  }

  test("switches the image when an animation frame arrives", async () => {
    mockRegisteredImages();
    const wrapper = mount(App);
    await flushPromises();
    const emitFrame = frameHandler();

    expect(wrapper.find("img.mascot-image").attributes("src")).toBe(
      dataUrl("/data/images/idle.png"),
    );

    emitFrame({ payload: "typing1" });
    await flushPromises();
    expect(wrapper.find("img.mascot-image").attributes("src")).toBe(
      dataUrl("/data/images/typing1.png"),
    );

    emitFrame({ payload: "typing2" });
    await flushPromises();
    expect(wrapper.find("img.mascot-image").attributes("src")).toBe(
      dataUrl("/data/images/typing2.png"),
    );

    emitFrame({ payload: "idle" });
    await flushPromises();
    expect(wrapper.find("img.mascot-image").attributes("src")).toBe(
      dataUrl("/data/images/idle.png"),
    );
  });

  test("loads each image once, not on every frame", async () => {
    mockRegisteredImages();
    mount(App);
    await flushPromises();
    const emitFrame = frameHandler();

    emitFrame({ payload: "typing1" });
    emitFrame({ payload: "typing2" });
    await flushPromises();

    const loads = invokeMock.mock.calls.filter(([cmd]) => cmd === "load_image");
    expect(loads).toHaveLength(3);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `pnpm exec vitest run tests/animation.test.ts tests/App.test.ts`
Expected: `tests/animation.test.ts` は import 解決に失敗、`App animation` の2件は FAIL

- [ ] **Step 4: 純粋関数とイベント名を実装する**

`src/animation.ts`:

```ts
/**
 * Frame the backend asks the main window to display.
 */
export type Frame = "idle" | "typing1" | "typing2";

/**
 * Loaded image data URLs per frame; null when no image is registered.
 */
export type FrameImages = Record<Frame, string | null>;

/**
 * Picks the image to display for a frame, falling back to the idle image
 * when the frame has none. Returns null when nothing can be shown.
 */
export function selectFrameImage(
  frame: Frame,
  images: FrameImages,
): string | null {
  return images[frame] ?? images.idle;
}
```

`src/constants.ts` の末尾に追加する。

```ts

/**
 * Event emitted by the backend when the displayed animation frame
 * changes, carrying the frame name as payload.
 */
export const ANIMATION_FRAME_EVENT = "animation-frame";
```

- [ ] **Step 5: App.vue を実装する**

`src/App.vue` の import を次のように変える（`computed`、`ANIMATION_FRAME_EVENT`、`animation` を足す）。

```ts
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { Frame, FrameImages } from "./animation";
import { selectFrameImage } from "./animation";
import {
  ANIMATION_FRAME_EVENT,
  POSITION_CHANGED_EVENT,
  SETTINGS_UPDATED_EVENT,
  SETTINGS_WINDOW_URL,
} from "./constants";
```

`const mascotUrl = ref<string | null>(null);` を次に置き換える。

```ts
const frameImages = ref<FrameImages>({
  idle: null,
  typing1: null,
  typing2: null,
});
const currentFrame = ref<Frame>("idle");
const mascotUrl = computed(() =>
  selectFrameImage(currentFrame.value, frameImages.value),
);
```

`applySettings` の `mascotUrl.value = await loadImageDataUrl(settings.images.idle);` を次に置き換える。

```ts
  // フレームの切り替えで読み込みを待たせないよう、3枚とも先に読み込んでおく
  const [idle, typing1, typing2] = await Promise.all([
    loadImageDataUrl(settings.images.idle),
    loadImageDataUrl(settings.images.typing1),
    loadImageDataUrl(settings.images.typing2),
  ]);
  frameImages.value = { idle, typing1, typing2 };
```

`onMounted` 内、`SETTINGS_UPDATED_EVENT` の `unlisteners.push(...)` の直後（位置追跡の `if (!capabilities.positioning)` より前）に追加する。

```ts
  unlisteners.push(
    await listen<Frame>(ANIMATION_FRAME_EVENT, (event) => {
      currentFrame.value = event.payload;
    }),
  );
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `pnpm test:front`
Expected: 全件 PASS

Run: `pnpm build`
Expected: 型エラーなしでビルド成功

- [ ] **Step 7: コミットする**

```bash
git add src/animation.ts src/constants.ts src/App.vue tests/animation.test.ts tests/App.test.ts
git commit -m "Show animation frames in the main window"
```

---

### Task 7: 手動確認とドキュメントの更新

**Files:**
- Modify: `README.md`（「Linux環境での制約」節）
- Modify: `CLAUDE.md`（Key locations）
- Modify: `docs/tasks.md`（フェーズ3）

- [ ] **Step 1: 実機で動作を確認する（人が行う）**

エージェントはここで作業を止め、次の確認を依頼する。WSLg ではウィンドウを X11 で開かないと検知できないので `dev:x11` を使う。

Run: `pnpm dev:x11`

1. 設定ウィンドウで3枚の画像を登録して保存する
2. 設定ウィンドウの入力欄でキーを打つと、マスコットが2枚の画像を交互に表示する
3. 打つのをやめると、約1秒後に idle 画像へ戻る
4. キーを押しっぱなしにすると動き続ける
5. Animation Speed と Idle Timeout を変えて保存すると、再起動なしで反映される
6. typing 画像を1枚クリアして保存すると、そのフレームでは idle 画像が表示される

うまく動かない場合は、ターミナルに `animation frame changed` と `global key listener stopped` のどちらが出ているかを添えて報告してもらう。

- [ ] **Step 2: README に制約を書き足す**

`README.md` の「### WSLg」節の末尾（「## ドキュメント」の前）に追加する。

```markdown
### キーボード入力の検知

マスコットのアニメーションは、ほかのアプリへの入力も含めたキーボード入力を検知して動きます。環境によって次の制約があります。

- **Waylandセッション**: ほかのアプリへの入力は取得できません。Xwayland経由で動いているアプリへの入力にだけ反応します。
- **WSLg**: WSLg上のウィンドウへの入力にだけ反応します。Windows側のアプリへの入力は見えません。
- **macOS**: 入力監視の権限が必要です。許可するまでマスコットはアイドル表示のままです。

検知を開始できない場合もアプリは起動し、マスコットはアイドル画像を表示し続けます。
```

- [ ] **Step 3: CLAUDE.md の Key locations を更新する**

`CLAUDE.md` の Key locations の一覧で、`src/windowSettings.ts` の行の下に追加する。

```markdown
- `src-tauri/src/animation/` — keyboard-driven animation: global key detection (`key_source.rs`), pure frame state machine (`logic.rs`), and the background loop that emits `animation-frame` events (`runner.rs`)
- `src/animation.ts` — picks the image to display for the frame the backend reports
```

- [ ] **Step 4: tasks.md を更新する**

`docs/tasks.md` のフェーズ3で、「スムーズなトランジション実装」以外の11項目を `- [x]` にする。「スムーズなトランジション実装」は次のように書き換える。

```markdown
- [ ] スムーズなトランジション実装（フェーズ3ではスコープ外。即時切り替えを採用）
```

- [ ] **Step 5: コミットする**

```bash
git add README.md CLAUDE.md docs/tasks.md
git commit -m "Document phase 3 animation and its platform limits"
```
