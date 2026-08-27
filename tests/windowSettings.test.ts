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
  // 適用後の実測値ログのために読み戻すAPI
  outerPosition: vi.fn(),
  outerSize: vi.fn(),
  scaleFactor: vi.fn(),
};

beforeEach(() => {
  windowStub.setPosition.mockReset();
  windowStub.setSize.mockReset();
  windowStub.setAlwaysOnTop.mockReset();
  windowStub.outerPosition.mockResolvedValue({ x: 0, y: 0 });
  windowStub.outerSize.mockResolvedValue({ width: 0, height: 0 });
  windowStub.scaleFactor.mockResolvedValue(1);
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

  test("skips setPosition when positioning is unsupported", async () => {
    const settings = createDefaultSettings();
    settings.windowPosition = { x: 10, y: 20 };

    await applyWindowSettings(settings, { positioning: false });

    // 位置を扱えないバックエンドでは要求しても無視されるため呼ばない
    expect(windowStub.setPosition).not.toHaveBeenCalled();
    expect(windowStub.setSize).toHaveBeenCalled();
    expect(windowStub.setAlwaysOnTop).toHaveBeenCalled();
  });
});
