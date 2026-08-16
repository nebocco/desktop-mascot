import { describe, expect, test } from "vitest";
import { createDefaultSettings, sanitizeSettings } from "../src/types/settings";

describe("createDefaultSettings", () => {
  test("returns settings with default values", () => {
    const settings = createDefaultSettings();
    expect(settings.windowPosition).toEqual({ x: 100, y: 100 });
    expect(settings.windowSize).toEqual({ width: 200, height: 200 });
    expect(settings.animationSpeed).toBe(200);
    expect(settings.images).toEqual({ typing1: "", typing2: "", idle: "" });
    expect(settings.opacity).toBe(1.0);
    expect(settings.alwaysOnTop).toBe(true);
  });

  test("returns independent objects so mutation does not leak", () => {
    const first = createDefaultSettings();
    first.images.typing1 = "mutated.png";
    first.windowPosition.x = 999;

    const second = createDefaultSettings();
    expect(second.images.typing1).toBe("");
    expect(second.windowPosition.x).toBe(100);
  });
});

describe("sanitizeSettings", () => {
  test("replaces null numeric fields with defaults", () => {
    // PrimeVue InputNumber writes null into the model when cleared
    const dirty = createDefaultSettings();
    const nulled = {
      ...dirty,
      animationSpeed: null,
      opacity: null,
      windowPosition: { x: null, y: null },
      windowSize: { width: null, height: null },
    } as unknown as ReturnType<typeof createDefaultSettings>;

    const clean = sanitizeSettings(nulled);
    const defaults = createDefaultSettings();
    expect(clean.animationSpeed).toBe(defaults.animationSpeed);
    expect(clean.opacity).toBe(defaults.opacity);
    expect(clean.windowPosition).toEqual(defaults.windowPosition);
    expect(clean.windowSize).toEqual(defaults.windowSize);
  });

  test("keeps valid values untouched", () => {
    const settings = createDefaultSettings();
    settings.animationSpeed = 300;
    settings.windowPosition.x = 0;

    const clean = sanitizeSettings(settings);
    expect(clean.animationSpeed).toBe(300);
    expect(clean.windowPosition.x).toBe(0);
  });
});
