import type { WindowPosition } from "./types/settings";

/**
 * How long after the app requests a window position the resulting move
 * events are attributed to that request rather than to a user drag.
 */
const ECHO_WINDOW_MS = 1000;

/**
 * Largest per-axis difference between a requested and a reported position
 * that is accepted as the window manager's coordinate offset.
 */
const MAX_OFFSET_PX = 200;

/**
 * Tells user drags apart from moves the app caused itself, and converts
 * dragged positions into coordinates that put the window back in the same
 * place when applied.
 */
export interface PositionTracker {
  /** Records that the app is about to move the window to `requested`. */
  expectMove(requested: WindowPosition, now: number): void;
  /**
   * Handles a reported window move. Returns the position to persist, or
   * null when the move was caused by the app and must not be persisted.
   */
  onMoved(reported: WindowPosition, now: number): WindowPosition | null;
}

/**
 * Creates a tracker with no known offset between requested and reported
 * positions.
 */
export function createPositionTracker(): PositionTracker {
  let offset: WindowPosition = { x: 0, y: 0 };
  let expected: { requested: WindowPosition; at: number } | null = null;

  return {
    expectMove(requested, now) {
      expected = { requested, at: now };
    },

    onMoved(reported, now) {
      if (expected && now - expected.at <= ECHO_WINDOW_MS) {
        // 枠のないウィンドウにも枠の幅を報告するウィンドウマネージャでは、
        // 指定した位置と報告される位置が枠の分だけずれる。このずれを覚えておく
        const candidate = {
          x: expected.requested.x - reported.x,
          y: expected.requested.y - reported.y,
        };
        if (
          Math.abs(candidate.x) <= MAX_OFFSET_PX &&
          Math.abs(candidate.y) <= MAX_OFFSET_PX
        ) {
          offset = candidate;
        }
        // アプリ自身が動かした結果を保存すると、適用のたびに位置がずれていく
        return null;
      }
      return { x: reported.x + offset.x, y: reported.y + offset.y };
    },
  };
}
