import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";
import App from "../src/App.vue";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: {
    getByLabel: vi.fn(),
  },
}));

describe("App drag region", () => {
  // Tauri's drag.js only checks e.target's own attribute (no ancestor
  // traversal), so every element that can receive the mousedown needs
  // the data-tauri-drag-region attribute.
  test("all full-size elements carry data-tauri-drag-region", () => {
    const wrapper = mount(App);

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

  test("settings button is not a drag region", () => {
    const wrapper = mount(App);
    const button = wrapper.find(".settings-btn");
    expect(button.exists()).toBe(true);
    expect(button.attributes("data-tauri-drag-region")).toBeUndefined();
  });
});
