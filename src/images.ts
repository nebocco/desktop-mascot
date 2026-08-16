import { invoke } from "@tauri-apps/api/core";

/**
 * Loads a managed image file and returns it as a data URL, or null when
 * the path is empty or the file cannot be read.
 */
export async function loadImageDataUrl(path: string): Promise<string | null> {
  if (!path) {
    return null;
  }
  try {
    const base64 = await invoke<string>("load_image", { path });
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    // 画像が消えていても表示側はプレースホルダーで継続する
    console.error("Failed to load image:", error);
    return null;
  }
}
