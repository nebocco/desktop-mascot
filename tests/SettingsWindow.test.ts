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

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);

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
});

describe("SettingsWindow image inputs", () => {
  test("renders an input with a label for each image slot", async () => {
    const wrapper = mountSettingsWindow();
    await flushPromises();

    for (const id of ["image-typing1", "image-typing2", "image-idle"]) {
      expect(wrapper.find(`#${id}`).exists(), `#${id} should exist`).toBe(true);
      expect(
        wrapper.find(`label[for="${id}"]`).exists(),
        `label for ${id} should exist`,
      ).toBe(true);
    }
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
