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
 * Default application settings
 */
export const DEFAULT_SETTINGS: Settings = {
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
