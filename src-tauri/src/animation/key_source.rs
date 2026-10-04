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
        // macOSでメインスレッド以外から listen すると、キー押下時にクラッシュする。
        // 回避のため、メインスレッドではないことを rdev に伝える
        #[cfg(target_os = "macos")]
        rdev::set_is_main_thread(false);

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
