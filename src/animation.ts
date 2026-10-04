/**
 * Frame the backend asks the main window to display.
 */
export type Frame = "idle" | "typing1" | "typing2";

/**
 * Loaded image data URLs per frame; null when no image is registered.
 */
export type FrameImages = Record<Frame, string | null>;

/**
 * Picks the image to display for a frame, falling back to the idle image
 * when the frame has none. Returns null when nothing can be shown.
 */
export function selectFrameImage(
  frame: Frame,
  images: FrameImages,
): string | null {
  return images[frame] ?? images.idle;
}

/**
 * Emoji shown per frame when no mascot image can be displayed, so the
 * animation is visible before any image is registered.
 */
export const PLACEHOLDER_EMOJI: Record<Frame, string> = {
  idle: "🐱",
  typing1: "😺",
  typing2: "😸",
};
