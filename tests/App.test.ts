import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: {
    getByLabel: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

vi.mock("../src/windowSettings", () => ({
  applyWindowSettings: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "../src/App.vue";
import { createDefaultSettings } from "../src/types/settings";
import { applyWindowSettings } from "../src/windowSettings";

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const emitMock = vi.mocked(emit);
const getCurrentWindowMock = vi.mocked(getCurrentWindow);
const applyWindowSettingsMock = vi.mocked(applyWindowSettings);

const windowStub = {
  onMoved: vi.fn(),
};

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  listenMock.mockResolvedValue(vi.fn());
  emitMock.mockReset();
  applyWindowSettingsMock.mockReset();
  windowStub.onMoved.mockReset();
  windowStub.onMoved.mockResolvedValue(vi.fn());
  // biome-ignore lint/suspicious/noExplicitAny: テストではウィンドウの一部メソッドだけを模倣する
  getCurrentWindowMock.mockReturnValue(windowStub as any);
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "get_settings") return createDefaultSettings();
    return undefined;
  });
});

describe("App drag region", () => {
  // Tauri's drag.js only checks e.target's own attribute (no ancestor
  // traversal), so every element that can receive the mousedown needs
  // the data-tauri-drag-region attribute.
  test("all full-size elements carry data-tauri-drag-region", async () => {
    const wrapper = mount(App);
    await flushPromises();

    for (const selector of [
      ".main-window",
      ".mascot-container",
      ".mascot-placeholder",
      ".mascot-text",
    ]) {
      const el = wrapper.find(selector);
      expect(el.exists(), `${selector} should exist`).toBe(true);
      expect(
        el.attributes("data-tauri-drag-region"),
        `${selector} should have data-tauri-drag-region`,
      ).toBeDefined();
    }
  });

  test("settings button is not a drag region", async () => {
    const wrapper = mount(App);
    await flushPromises();
    const button = wrapper.find(".settings-btn");
    expect(button.exists()).toBe(true);
    expect(button.attributes("data-tauri-drag-region")).toBeUndefined();
  });
});

describe("App settings application", () => {
  test("applies window settings on startup", async () => {
    mount(App);
    await flushPromises();

    expect(invokeMock).toHaveBeenCalledWith("get_settings");
    expect(applyWindowSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ animationSpeed: 200 }),
    );
  });

  test("shows the idle image when one is registered", async () => {
    const settings = createDefaultSettings();
    settings.images.idle = "/data/images/idle.png";
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return settings;
      if (cmd === "load_image") return "QUJD";
      return undefined;
    });

    const wrapper = mount(App);
    await flushPromises();

    const img = wrapper.find("img.mascot-image");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("data:image/png;base64,QUJD");
    // 画像もドラッグ領域として機能する必要がある
    expect(img.attributes("data-tauri-drag-region")).toBeDefined();
    expect(wrapper.find(".mascot-placeholder").exists()).toBe(false);
  });

  test("keeps the placeholder when no idle image is registered", async () => {
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.find("img.mascot-image").exists()).toBe(false);
    expect(wrapper.find(".mascot-placeholder").exists()).toBe(true);
  });

  test("re-applies settings when settings-updated arrives", async () => {
    mount(App);
    await flushPromises();

    const call = listenMock.mock.calls.find(
      ([eventName]) => eventName === "settings-updated",
    );
    expect(call, "should listen for settings-updated").toBeDefined();
    const handler = call?.[1] as (event: { payload: unknown }) => void;

    const updated = createDefaultSettings();
    updated.opacity = 0.5;
    handler({ payload: updated });
    await flushPromises();

    expect(applyWindowSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ opacity: 0.5 }),
    );
  });
});

describe("App drag position persistence", () => {
  test("saves the position after the window stops moving", async () => {
    // fake timers有効中はflushPromisesが進まないため、マウント完了後に有効化する
    mount(App);
    await flushPromises();
    expect(windowStub.onMoved).toHaveBeenCalled();
    const handler = windowStub.onMoved.mock.calls[0][0] as (event: {
      payload: { x: number; y: number };
    }) => void;

    vi.useFakeTimers();
    try {
      handler({ payload: { x: 5, y: 6 } });
      handler({ payload: { x: 7, y: 8 } });
      expect(invokeMock).not.toHaveBeenCalledWith(
        "save_window_position",
        expect.anything(),
      );

      await vi.advanceTimersByTimeAsync(500);
      expect(invokeMock).toHaveBeenCalledWith("save_window_position", {
        x: 7,
        y: 8,
      });
      expect(emitMock).toHaveBeenCalledWith("position-changed", {
        x: 7,
        y: 8,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("App listener cleanup", () => {
  test("unlistens settings-updated and onMoved on unmount", async () => {
    const settingsUnlisten = vi.fn();
    const movedUnlisten = vi.fn();
    listenMock.mockResolvedValue(settingsUnlisten);
    windowStub.onMoved.mockResolvedValue(movedUnlisten);

    const wrapper = mount(App);
    await flushPromises();

    wrapper.unmount();

    expect(settingsUnlisten).toHaveBeenCalled();
    expect(movedUnlisten).toHaveBeenCalled();
  });
});
