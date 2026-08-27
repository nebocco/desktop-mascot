import { flushPromises, mount } from "@vue/test-utils";
import Button from "primevue/button";
import PrimeVue from "primevue/config";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import ImageSlot from "../src/components/ImageSlot.vue";

const invokeMock = vi.mocked(invoke);
const openMock = vi.mocked(open);

function mountSlot(modelValue = "") {
  return mount(ImageSlot, {
    props: { label: "Idle Image", imageType: "idle" as const, modelValue },
    global: {
      plugins: [PrimeVue],
      // vitest設定の自動インポートに依存しないよう明示登録する
      components: { Button },
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
  openMock.mockReset();
});

describe("ImageSlot preview", () => {
  test("shows a placeholder when no image is set", async () => {
    const wrapper = mountSlot("");
    await flushPromises();
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.text()).toContain("No image");
  });

  test("shows a preview image when a path is set", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "load_image") return "QUJD";
      return undefined;
    });
    const wrapper = mountSlot("/data/images/idle.png");
    await flushPromises();
    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("data:image/png;base64,QUJD");
  });
});

describe("ImageSlot selection", () => {
  test("registers the chosen file and emits the stored path", async () => {
    openMock.mockResolvedValue("/home/user/pic.png");
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "register_image") return "/data/images/idle.png";
      if (cmd === "load_image") return "QUJD";
      return undefined;
    });

    const wrapper = mountSlot("");
    await flushPromises();
    await findButtonByLabel(wrapper, "Select").trigger("click");
    await flushPromises();

    expect(invokeMock).toHaveBeenCalledWith("register_image", {
      imageType: "idle",
      sourcePath: "/home/user/pic.png",
    });
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
      "/data/images/idle.png",
    ]);
  });

  test("shows the validation error inside the slot", async () => {
    openMock.mockResolvedValue("/home/user/huge.png");
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "register_image") {
        throw "Image is 600x600px; both dimensions must be at most 512px";
      }
      return undefined;
    });

    const wrapper = mountSlot("");
    await flushPromises();
    await findButtonByLabel(wrapper, "Select").trigger("click");
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    // エラーは画面下部のステータスではなく、対象スロットの直下に出す
    const error = wrapper.find(".image-slot-error");
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain("600x600");
  });

  test("does nothing when the dialog is cancelled", async () => {
    openMock.mockResolvedValue(null);
    const wrapper = mountSlot("");
    await flushPromises();
    await findButtonByLabel(wrapper, "Select").trigger("click");
    await flushPromises();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "register_image",
      expect.anything(),
    );
  });
});

describe("ImageSlot re-registration", () => {
  test("reloads the preview when register_image returns the same stored path", async () => {
    // register_imageは固定名へ上書きコピーするため、同一スロットの再登録では
    // 返り値のパス文字列が変わらない。その場合でもプレビューが更新されることを確認する。
    let loadImageCallCount = 0;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "load_image") {
        loadImageCallCount += 1;
        return loadImageCallCount === 1 ? "OLD" : "NEW";
      }
      if (cmd === "register_image") return "/data/images/idle.png";
      return undefined;
    });
    openMock.mockResolvedValue("/home/user/new-pic.png");

    const wrapper = mountSlot("/data/images/idle.png");
    await flushPromises();
    expect(wrapper.find("img").attributes("src")).toBe(
      "data:image/png;base64,OLD",
    );

    await findButtonByLabel(wrapper, "Select").trigger("click");
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
      "/data/images/idle.png",
    ]);
    expect(wrapper.find("img").attributes("src")).toBe(
      "data:image/png;base64,NEW",
    );
  });
});

describe("ImageSlot clear", () => {
  test("emits an empty path on clear", async () => {
    invokeMock.mockImplementation(async () => "QUJD");
    const wrapper = mountSlot("/data/images/idle.png");
    await flushPromises();
    await findButtonByLabel(wrapper, "Clear").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([""]);
  });
});
