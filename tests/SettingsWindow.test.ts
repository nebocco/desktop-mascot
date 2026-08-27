import { flushPromises, mount } from "@vue/test-utils";
import PrimeVue from "primevue/config";
import { beforeEach, describe, expect, test, vi } from "vitest";
import SettingsWindow from "../src/SettingsWindow.vue";
import { createDefaultSettings } from "../src/types/settings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { invoke } from "@tauri-apps/api/core";
import { emit as emitEvent, listen } from "@tauri-apps/api/event";

const invokeMock = vi.mocked(invoke);
const emitEventMock = vi.mocked(emitEvent);
const listenMock = vi.mocked(listen);

function mountSettingsWindow() {
  return mount(SettingsWindow, {
    global: {
      plugins: [PrimeVue],
    },
  });
}

function findButtonByLabel(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper
    .findAll("button")
    .find((b) => b.text().includes(label));
  if (!button) {
    throw new Error(`button with label "${label}" not found`);
  }
  return button;
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "get_settings") {
      return createDefaultSettings();
    }
    return undefined;
  });
  emitEventMock.mockReset();
  listenMock.mockClear();
});

describe("SettingsWindow reset", () => {
  test("applies the settings returned by reset_settings", async () => {
    // Rust側を唯一の真実の源とするため、invokeの戻り値を画面に反映する
    const backendDefaults = createDefaultSettings();
    backendDefaults.animationSpeed = 123;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return createDefaultSettings();
      if (cmd === "reset_settings") return backendDefaults;
      return undefined;
    });

    const wrapper = mountSettingsWindow();
    await flushPromises();

    await findButtonByLabel(wrapper, "Reset to Default").trigger("click");
    await flushPromises();

    expect(invokeMock).toHaveBeenCalledWith("reset_settings");
    expect(wrapper.text()).toContain("Animation Speed (ms/frame): 123");
  });

  test("propagates the reset settings to the main window via settings-updated", async () => {
    const backendDefaults = createDefaultSettings();
    backendDefaults.animationSpeed = 321;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return createDefaultSettings();
      if (cmd === "reset_settings") return backendDefaults;
      return undefined;
    });

    const wrapper = mountSettingsWindow();
    await flushPromises();

    await findButtonByLabel(wrapper, "Reset to Default").trigger("click");
    await flushPromises();

    expect(emitEventMock).toHaveBeenCalledWith(
      "settings-updated",
      backendDefaults,
    );
  });

  test("does not emit settings-updated when reset fails", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return createDefaultSettings();
      if (cmd === "reset_settings") throw new Error("disk full");
      return undefined;
    });

    const wrapper = mountSettingsWindow();
    await flushPromises();

    await findButtonByLabel(wrapper, "Reset to Default").trigger("click");
    await flushPromises();

    expect(emitEventMock).not.toHaveBeenCalled();
  });
});

describe("SettingsWindow image inputs", () => {
  test("renders an image slot for each image type", async () => {
    const wrapper = mountSettingsWindow();
    await flushPromises();

    const labels = ["Typing Image 1", "Typing Image 2", "Idle Image"];
    for (const label of labels) {
      expect(wrapper.text()).toContain(label);
    }
    expect(wrapper.findAll(".image-slot")).toHaveLength(3);
  });
});

describe("SettingsWindow save event", () => {
  test("emits settings-updated with the saved settings", async () => {
    const wrapper = mountSettingsWindow();
    await flushPromises();

    await findButtonByLabel(wrapper, "Save Settings").trigger("click");
    await flushPromises();

    expect(emitEventMock).toHaveBeenCalledWith(
      "settings-updated",
      expect.objectContaining({ animationSpeed: 200 }),
    );
  });

  test("does not emit when saving fails", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return createDefaultSettings();
      if (cmd === "save_settings") throw new Error("disk full");
      return undefined;
    });

    const wrapper = mountSettingsWindow();
    await flushPromises();

    await findButtonByLabel(wrapper, "Save Settings").trigger("click");
    await flushPromises();

    expect(emitEventMock).not.toHaveBeenCalled();
  });
});

describe("SettingsWindow position sync", () => {
  test("updates the position form when position-changed arrives", async () => {
    const wrapper = mountSettingsWindow();
    await flushPromises();

    const call = listenMock.mock.calls.find(
      ([eventName]) => eventName === "position-changed",
    );
    expect(call, "should listen for position-changed").toBeDefined();
    const handler = call?.[1] as (event: {
      payload: { x: number; y: number };
    }) => void;

    handler({ payload: { x: 321, y: 654 } });
    await flushPromises();

    const xInput = wrapper.find<HTMLInputElement>("#position-x");
    expect(xInput.element.value).toBe("321");
  });
});

describe("SettingsWindow status feedback", () => {
  test("shows a success message after saving", async () => {
    const wrapper = mountSettingsWindow();
    await flushPromises();

    await findButtonByLabel(wrapper, "Save Settings").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Settings saved");
  });

  test("shows an error message when saving fails", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return createDefaultSettings();
      if (cmd === "save_settings") throw new Error("disk full");
      return undefined;
    });

    const wrapper = mountSettingsWindow();
    await flushPromises();

    await findButtonByLabel(wrapper, "Save Settings").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Failed to save settings");
  });

  test("shows a message after resetting", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return createDefaultSettings();
      if (cmd === "reset_settings") return createDefaultSettings();
      return undefined;
    });

    const wrapper = mountSettingsWindow();
    await flushPromises();

    await findButtonByLabel(wrapper, "Reset to Default").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Settings reset");
  });
});
