import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { loadImageDataUrl } from "../src/images";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

describe("loadImageDataUrl", () => {
  test("returns null for an empty path without calling the backend", async () => {
    expect(await loadImageDataUrl("")).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("returns a PNG data URL on success", async () => {
    invokeMock.mockResolvedValue("QUJD");
    const url = await loadImageDataUrl("/data/images/idle.png");
    expect(invokeMock).toHaveBeenCalledWith("load_image", {
      path: "/data/images/idle.png",
    });
    expect(url).toBe("data:image/png;base64,QUJD");
  });

  test("returns null when the backend fails", async () => {
    invokeMock.mockRejectedValue(new Error("outside managed dir"));
    expect(await loadImageDataUrl("/etc/passwd")).toBeNull();
  });
});
