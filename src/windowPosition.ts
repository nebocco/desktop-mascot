import type { WindowPosition } from "./types/settings";

/**
 * How long after the app requests a window position the resulting move
 * events may still arrive.
 */
const ECHO_WINDOW_MS = 500;

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
  /**
   * Whether applying `position` would move the window. Re-applying the
   * position the window is already at is skipped, so that saving unrelated
   * settings never opens a period in which moves are attributed to the app.
   */
  needsMove(position: WindowPosition): boolean;
  /** Records that the app is about to move the window to `requested`. */
  expectMove(requested: WindowPosition, now: number): void;
  /**
   * Starts treating unexplained moves as user drags. Until then they are
   * ignored, because the window manager's initial placement is not a drag.
   */
  start(): void;
  /**
   * Handles a reported window move. Returns the position to persist, or
   * null when the move must not be persisted.
   */
  onMoved(reported: WindowPosition, now: number): WindowPosition | null;
}

function samePosition(a: WindowPosition, b: WindowPosition): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Creates a tracker that has not been started and knows no offset between
 * requested and reported positions.
 */
export function createPositionTracker(): PositionTracker {
  let started = false;
  // 枠のないウィンドウにも枠の幅を報告するウィンドウマネージャでは、
  // 指定した位置と報告される位置が枠の分だけずれる。nullは未計測を表す
  let offset: WindowPosition | null = null;
  let measured: WindowPosition | null = null;
  let expected: { requested: WindowPosition; at: number } | null = null;
  let lastReported: WindowPosition | null = null;
  // 適用すればウィンドウが今の場所に来る座標。最後に指定した値か、
  // 最後にドラッグで保存した値
  let current: WindowPosition | null = null;

  // 計測中に見た最後の値を、ずれ幅として確定する
  function settleMeasurement() {
    if (measured) {
      offset = measured;
      measured = null;
    }
  }

  // アプリ自身が動かした結果かどうか。保存すると適用のたびに位置がずれていく
  function isEcho(reported: WindowPosition, now: number): boolean {
    if (!expected) {
      return false;
    }
    const elapsed = now - expected.at;
    if (elapsed < 0 || elapsed > ECHO_WINDOW_MS) {
      return false;
    }
    const candidate = {
      x: expected.requested.x - reported.x,
      y: expected.requested.y - reported.y,
    };
    if (offset === null) {
      // 未計測の間は、移動前の位置と移動後の位置が続けて報告されるため、
      // 妥当な範囲に収まる最後の値を採用する
      if (
        Math.abs(candidate.x) <= MAX_OFFSET_PX &&
        Math.abs(candidate.y) <= MAX_OFFSET_PX
      ) {
        measured = candidate;
      }
      return true;
    }
    // 計測済みなら値で見分ける。時間だけで判断すると、適用の直後に
    // 始まったドラッグを取り違えてしまう
    const isStale =
      lastReported !== null && samePosition(reported, lastReported);
    return isStale || samePosition(candidate, offset);
  }

  return {
    needsMove(position) {
      return current === null || !samePosition(position, current);
    },

    expectMove(requested, now) {
      settleMeasurement();
      expected = { requested, at: now };
      current = requested;
    },

    start() {
      started = true;
    },

    onMoved(reported, now) {
      const echo = isEcho(reported, now);
      lastReported = reported;
      if (echo || !started) {
        return null;
      }
      settleMeasurement();
      current = {
        x: reported.x + (offset?.x ?? 0),
        y: reported.y + (offset?.y ?? 0),
      };
      return current;
    },
  };
}
