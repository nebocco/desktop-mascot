import { describe, expect, test } from "vitest";
import { createPositionTracker } from "../src/windowPosition";

describe("createPositionTracker", () => {
  test("passes drags through unchanged before any calibration", () => {
    const tracker = createPositionTracker();
    expect(tracker.onMoved({ x: 500, y: 400 }, 0)).toEqual({ x: 500, y: 400 });
  });

  test("does not persist moves that echo a position the app just requested", () => {
    const tracker = createPositionTracker();
    tracker.expectMove({ x: 2649, y: 867 }, 1000);

    // ウィンドウマネージャは移動前の位置と移動後の位置を続けて報告する
    expect(tracker.onMoved({ x: 2649, y: 867 }, 1003)).toBeNull();
    expect(tracker.onMoved({ x: 2611, y: 808 }, 1015)).toBeNull();
  });

  test("converts later drags into coordinates that restore the same spot", () => {
    const tracker = createPositionTracker();
    tracker.expectMove({ x: 2649, y: 867 }, 1000);
    tracker.onMoved({ x: 2649, y: 867 }, 1003);
    tracker.onMoved({ x: 2611, y: 808 }, 1015);

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

    expect(tracker.onMoved({ x: 300, y: 200 }, 5000)).toEqual({
      x: 300,
      y: 200,
    });
  });

  test("treats a move after the echo window as a drag", () => {
    const tracker = createPositionTracker();
    tracker.expectMove({ x: 100, y: 100 }, 1000);

    expect(tracker.onMoved({ x: 300, y: 200 }, 2001)).toEqual({
      x: 300,
      y: 200,
    });
  });

  test("ignores an implausible offset but still does not persist the echo", () => {
    const tracker = createPositionTracker();
    tracker.expectMove({ x: 2000, y: 1000 }, 1000);

    // 起動直後など、指定とかけ離れた位置が一時的に報告されることがある
    expect(tracker.onMoved({ x: 0, y: 0 }, 1005)).toBeNull();
    expect(tracker.onMoved({ x: 300, y: 200 }, 5000)).toEqual({
      x: 300,
      y: 200,
    });
  });
});
