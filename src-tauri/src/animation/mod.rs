//! Keyboard-driven mascot animation: key detection, frame state machine,
//! and the background loop that tells the main window which frame to show.

pub mod key_source;
pub mod logic;
pub mod runner;

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
