import { describe, expect, test } from "vitest";
import { createPositionTracker } from "../src/windowPosition";

/**
 * Returns a started tracker that has measured the offset (38, 59) from one
 * applied position, the way it happens at startup on WSLg.
 */
function calibratedTracker() {
  const tracker = createPositionTracker();
  tracker.expectMove({ x: 2649, y: 867 }, 1000);
  // ウィンドウマネージャは移動前の位置と移動後の位置を続けて報告する
  tracker.onMoved({ x: 40, y: 40 }, 1003);
  tracker.onMoved({ x: 2611, y: 808 }, 1015);
  tracker.start();
  return tracker;
}

describe("createPositionTracker", () => {
  test("ignores moves reported before it is started", () => {
    // 起動直後、設定を適用する前に届く初期配置の報告を保存しない
    const tracker = createPositionTracker();
    expect(tracker.onMoved({ x: 12, y: 34 }, 0)).toBeNull();

    tracker.start();
    expect(tracker.onMoved({ x: 500, y: 400 }, 5000)).toEqual({
      x: 500,
      y: 400,
    });
  });

  test("does not persist moves that echo a position the app just requested", () => {
    const tracker = createPositionTracker();
    tracker.expectMove({ x: 2649, y: 867 }, 1000);

    expect(tracker.onMoved({ x: 40, y: 40 }, 1003)).toBeNull();
    expect(tracker.onMoved({ x: 2611, y: 808 }, 1015)).toBeNull();
  });

  test("converts later drags into coordinates that restore the same spot", () => {
    const tracker = calibratedTracker();

    // 指定値と報告値の差(38, 59)を足した値を保存すれば、
    // 次に適用したときウィンドウは同じ場所に戻る
    expect(tracker.onMoved({ x: 300, y: 200 }, 5000)).toEqual({
      x: 338,
      y: 259,
    });
  });

  test("applies no correction where requested and reported positions agree", () => {
    const tracker = createPositionTracker();
    tracker.expectMove({ x: 100, y: 100 }, 1000);
    tracker.onMoved({ x: 100, y: 100 }, 1010);
    tracker.start();

    expect(tracker.onMoved({ x: 300, y: 200 }, 5000)).toEqual({
      x: 300,
      y: 200,
    });
  });

  test("does not persist the echoes of re-applying the current position", () => {
    const tracker = calibratedTracker();

    // 位置を変えずに保存した場合: 現在位置がもう一度報告される
    tracker.expectMove({ x: 2649, y: 867 }, 9000);
    expect(tracker.onMoved({ x: 2611, y: 808 }, 9003)).toBeNull();
    expect(tracker.onMoved({ x: 2611, y: 808 }, 9015)).toBeNull();
  });

  test("does not persist the echoes of applying a new position", () => {
    const tracker = calibratedTracker();

    tracker.expectMove({ x: 500, y: 500 }, 9000);
    expect(tracker.onMoved({ x: 2611, y: 808 }, 9003)).toBeNull();
    expect(tracker.onMoved({ x: 462, y: 441 }, 9015)).toBeNull();
  });

  test("persists a drag that starts right after a position was applied", () => {
    const tracker = calibratedTracker();
    tracker.expectMove({ x: 2649, y: 867 }, 9000);
    tracker.onMoved({ x: 2611, y: 808 }, 9003);

    // 保存の直後にマスコットを動かしても、ずれ幅を壊さず正しく保存する
    expect(tracker.onMoved({ x: 2641, y: 828 }, 9200)).toEqual({
      x: 2679,
      y: 887,
    });
    expect(tracker.onMoved({ x: 300, y: 200 }, 9900)).toEqual({
      x: 338,
      y: 259,
    });
  });

  test("needs a move only when the position differs from where the window is", () => {
    const tracker = calibratedTracker();
    expect(tracker.needsMove({ x: 2649, y: 867 })).toBe(false);
    expect(tracker.needsMove({ x: 500, y: 500 })).toBe(true);

    // ドラッグ後は、保存した座標が現在位置になる
    tracker.onMoved({ x: 300, y: 200 }, 5000);
    expect(tracker.needsMove({ x: 338, y: 259 })).toBe(false);
    expect(tracker.needsMove({ x: 2649, y: 867 })).toBe(true);
  });

  test("needs a move before any position was applied", () => {
    expect(createPositionTracker().needsMove({ x: 100, y: 100 })).toBe(true);
  });

  test("ignores an implausible offset but still does not persist the echo", () => {
    const tracker = createPositionTracker();
    tracker.expectMove({ x: 2000, y: 1000 }, 1000);
    expect(tracker.onMoved({ x: 0, y: 0 }, 1005)).toBeNull();
    tracker.start();

    expect(tracker.onMoved({ x: 300, y: 200 }, 5000)).toEqual({
      x: 300,
      y: 200,
    });
  });
});
