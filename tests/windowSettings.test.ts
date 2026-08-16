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
};

beforeEach(() => {
  windowStub.setPosition.mockReset();
  windowStub.setSize.mockReset();
  windowStub.setAlwaysOnTop.mockReset();
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
});
