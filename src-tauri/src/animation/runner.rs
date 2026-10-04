//! Background loop that turns key notifications into frame changes.

use super::logic::{next_wait, on_key, on_timeout};
use super::{AnimationConfig, AnimationState, Frame};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Timing parameters shared between the loop and the settings commands.
pub type SharedConfig = Arc<Mutex<AnimationConfig>>;

/// Replaces the timing parameters the loop uses from its next step on.
pub fn update_config(shared: &SharedConfig, config: AnimationConfig) {
    *lock(shared) = config;
}

fn lock(shared: &SharedConfig) -> std::sync::MutexGuard<'_, AnimationConfig> {
    // 値は丸ごと差し替えるだけなので、他スレッドがパニックしていても中身は壊れていない
    shared
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
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
