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
import { ANIMATION_FRAME_EVENT } from "../src/constants";
import { createDefaultSettings } from "../src/types/settings";
import { applyWindowSettings } from "../src/windowSettings";

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const emitMock = vi.mocked(emit);
const getCurrentWindowMock = vi.mocked(getCurrentWindow);
const applyWindowSettingsMock = vi.mocked(applyWindowSettings);

// App.vueが位置の追跡に使う時刻。テストから直接進める
let nowMs = 0;

const windowStub = {
  onMoved: vi.fn(),
};

beforeEach(() => {
  nowMs = 0;
  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
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
    if (cmd === "supports_window_positioning") return true;
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
      ".mascot-frame-label",
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
      { positioning: true },
      true,
    );
  });

  test("shows the idle image when one is registered", async () => {
    const settings = createDefaultSettings();
    settings.images.idle = "/data/images/idle.png";
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return settings;
      if (cmd === "load_image") return "QUJD";
      if (cmd === "supports_window_positioning") return true;
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

    // 位置が変わらない適用ではウィンドウを動かさない
    expect(applyWindowSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ opacity: 0.5 }),
      { positioning: true },
      false,
    );

    const moved = createDefaultSettings();
    moved.windowPosition = { x: 640, y: 480 };
    handler({ payload: moved });
    await flushPromises();

    expect(applyWindowSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ windowPosition: { x: 640, y: 480 } }),
      { positioning: true },
      true,
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

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      // 起動時の位置適用の直後に届く移動は保存されないため、十分に時間を空ける
      nowMs = 2000;
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

  test("does not save moves caused by applying settings and corrects later drags", async () => {
    // 指定した位置と報告される位置がずれる環境で、保存のたびに
    // ウィンドウが動いていかないことを担保する
    const settings = createDefaultSettings();
    settings.windowPosition = { x: 2649, y: 867 };
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return settings;
      if (cmd === "supports_window_positioning") return true;
      return undefined;
    });
    mount(App);
    await flushPromises();
    const handler = windowStub.onMoved.mock.calls[0][0] as (event: {
      payload: { x: number; y: number };
    }) => void;

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      nowMs = 10;
      handler({ payload: { x: 2649, y: 867 } });
      handler({ payload: { x: 2611, y: 808 } });
      await vi.advanceTimersByTimeAsync(1500);
      nowMs = 2000;
      expect(invokeMock).not.toHaveBeenCalledWith(
        "save_window_position",
        expect.anything(),
      );

      handler({ payload: { x: 300, y: 200 } });
      await vi.advanceTimersByTimeAsync(500);
      expect(invokeMock).toHaveBeenCalledWith("save_window_position", {
        x: 338,
        y: 259,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("App drag right after saving", () => {
  test("saves a drag that starts right after settings were re-applied", async () => {
    // 保存の直後にマスコットを動かしても、位置が失われないことを担保する
    mount(App);
    await flushPromises();
    const moved = windowStub.onMoved.mock.calls[0][0] as (event: {
      payload: { x: number; y: number };
    }) => void;
    const settingsUpdated = listenMock.mock.calls.find(
      ([eventName]) => eventName === "settings-updated",
    )?.[1] as unknown as (event: { payload: unknown }) => void;

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      nowMs = 2000;
      settingsUpdated({ payload: createDefaultSettings() });
      await vi.advanceTimersByTimeAsync(100);
      nowMs = 2100;

      moved({ payload: { x: 130, y: 120 } });
      await vi.advanceTimersByTimeAsync(500);
      expect(invokeMock).toHaveBeenCalledWith("save_window_position", {
        x: 130,
        y: 120,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("App positioning capability", () => {
  test("does not track or save positions when positioning is unsupported", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return createDefaultSettings();
      if (cmd === "supports_window_positioning") return false;
      return undefined;
    });

    mount(App);
    await flushPromises();

    // 位置を報告できないバックエンドでは、偽のonMovedで保存値を壊さないよう購読自体を行わない
    expect(windowStub.onMoved).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "save_window_position",
      expect.anything(),
    );
  });

  test("passes the positioning capability to applyWindowSettings", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return createDefaultSettings();
      if (cmd === "supports_window_positioning") return false;
      return undefined;
    });

    mount(App);
    await flushPromises();

    expect(applyWindowSettingsMock).toHaveBeenCalledWith(
      expect.anything(),
      { positioning: false },
      false,
    );
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

describe("App animation", () => {
  function mockRegisteredImages() {
    const settings = createDefaultSettings();
    settings.images = {
      idle: "/data/images/idle.png",
      typing1: "/data/images/typing1.png",
      typing2: "/data/images/typing2.png",
    };
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_settings") return settings;
      if (cmd === "supports_window_positioning") return true;
      // 画像ごとに違うデータを返し、どの画像が表示されているかを区別できるようにする
      if (cmd === "load_image") return btoa((args as { path: string }).path);
      return undefined;
    });
  }

  function frameHandler() {
    const call = listenMock.mock.calls.find(
      ([name]) => name === ANIMATION_FRAME_EVENT,
    );
    if (!call) {
      throw new Error("animation-frame listener was not registered");
    }
    return call[1] as unknown as (event: { payload: string }) => void;
  }

  function dataUrl(path: string) {
    return `data:image/png;base64,${btoa(path)}`;
  }

  test("switches the image when an animation frame arrives", async () => {
    mockRegisteredImages();
    const wrapper = mount(App);
    await flushPromises();
    const emitFrame = frameHandler();

    expect(wrapper.find("img.mascot-image").attributes("src")).toBe(
      dataUrl("/data/images/idle.png"),
    );

    emitFrame({ payload: "typing1" });
    await flushPromises();
    expect(wrapper.find("img.mascot-image").attributes("src")).toBe(
      dataUrl("/data/images/typing1.png"),
    );

    emitFrame({ payload: "typing2" });
    await flushPromises();
    expect(wrapper.find("img.mascot-image").attributes("src")).toBe(
      dataUrl("/data/images/typing2.png"),
    );

    emitFrame({ payload: "idle" });
    await flushPromises();
    expect(wrapper.find("img.mascot-image").attributes("src")).toBe(
      dataUrl("/data/images/idle.png"),
    );
  });

  test("loads each image once, not on every frame", async () => {
    mockRegisteredImages();
    mount(App);
    await flushPromises();
    const emitFrame = frameHandler();

    emitFrame({ payload: "typing1" });
    emitFrame({ payload: "typing2" });
    await flushPromises();

    const loads = invokeMock.mock.calls.filter(([cmd]) => cmd === "load_image");
    expect(loads).toHaveLength(3);
  });

  test("shows the current frame on the placeholder when no image is registered", async () => {
    // 画像を登録しなくてもキー検知の動作を目で確認できるようにする
    const wrapper = mount(App);
    await flushPromises();
    const emitFrame = frameHandler();
    const placeholder = () => wrapper.find(".mascot-placeholder").text();

    expect(placeholder()).toContain("🐱");
    expect(placeholder()).toContain("idle");

    emitFrame({ payload: "typing1" });
    await flushPromises();
    expect(placeholder()).toContain("😺");
    expect(placeholder()).toContain("typing1");

    emitFrame({ payload: "typing2" });
    await flushPromises();
    expect(placeholder()).toContain("😸");
    expect(placeholder()).toContain("typing2");
  });
});
