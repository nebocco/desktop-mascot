/**
 * Window position coordinates
 */
export interface WindowPosition {
  x: number;
  y: number;
}

/**
 * Window size dimensions
 */
export interface WindowSize {
  width: number;
  height: number;
}

/**
 * Image file paths for mascot animations
 */
export interface ImagePaths {
  typing1: string;
  typing2: string;
  idle: string;
}

/**
 * Application settings
 */
export interface Settings {
  windowPosition: WindowPosition;
  windowSize: WindowSize;
  animationSpeed: number; // milliseconds per frame (50-500)
  images: ImagePaths;
  opacity: number; // 0-1
  alwaysOnTop: boolean;
}

/**
 * Creates a fresh default settings object.
 *
 * Returns a new deep object on every call so callers can mutate the result
 * without leaking changes into other consumers.
 */
export function createDefaultSettings(): Settings {
  return {
    windowPosition: { x: 100, y: 100 },
    windowSize: { width: 200, height: 200 },
    animationSpeed: 200,
    images: {
      typing1: "",
      typing2: "",
      idle: "",
    },
    opacity: 1.0,
    alwaysOnTop: true,
  };
}

/**
 * Returns a copy of the settings with invalid numeric fields replaced by
 * their default values.
 *
 * PrimeVue's InputNumber writes null into the model when the field is
 * cleared; saving such a value would be rejected by the Rust backend.
 */
export function sanitizeSettings(settings: Settings): Settings {
  const defaults = createDefaultSettings();
  const num = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  return {
    ...settings,
    windowPosition: {
      x: num(settings.windowPosition?.x, defaults.windowPosition.x),
      y: num(settings.windowPosition?.y, defaults.windowPosition.y),
    },
    windowSize: {
      width: num(settings.windowSize?.width, defaults.windowSize.width),
      height: num(settings.windowSize?.height, defaults.windowSize.height),
    },
    animationSpeed: num(settings.animationSpeed, defaults.animationSpeed),
    opacity: num(settings.opacity, defaults.opacity),
  };
}
