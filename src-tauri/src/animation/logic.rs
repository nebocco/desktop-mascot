//! Pure state transitions for the mascot animation. No I/O and no clock
//! access: callers pass the current time in.

use super::{AnimationConfig, AnimationState, Frame};
use std::time::{Duration, Instant};

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
