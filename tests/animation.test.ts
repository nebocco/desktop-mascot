import { describe, expect, test } from "vitest";
import { selectFrameImage } from "../src/animation";

const all = { idle: "idle-url", typing1: "t1-url", typing2: "t2-url" };

describe("selectFrameImage", () => {
  test("returns the image registered for the frame", () => {
    expect(selectFrameImage("idle", all)).toBe("idle-url");
    expect(selectFrameImage("typing1", all)).toBe("t1-url");
    expect(selectFrameImage("typing2", all)).toBe("t2-url");
  });

  test("falls back to the idle image when a typing image is missing", () => {
    const images = { idle: "idle-url", typing1: null, typing2: null };
    expect(selectFrameImage("typing1", images)).toBe("idle-url");
    expect(selectFrameImage("typing2", images)).toBe("idle-url");
  });

  test("returns null when the idle image is missing too", () => {
    const images = { idle: null, typing1: null, typing2: null };
    expect(selectFrameImage("idle", images)).toBeNull();
    expect(selectFrameImage("typing1", images)).toBeNull();
  });
});
