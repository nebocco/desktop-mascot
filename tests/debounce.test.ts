import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { debounce } from "../src/debounce";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("debounce", () => {
  test("runs only once after rapid calls, with the last arguments", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);

    debounced(1);
    debounced(2);
    debounced(3);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  test("runs again for calls after the wait period", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);

    debounced("a");
    vi.advanceTimersByTime(500);
    debounced("b");
    vi.advanceTimersByTime(500);

    expect(fn).toHaveBeenCalledTimes(2);
  });
});
