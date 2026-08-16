import {
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import type { Settings } from "./types/settings";

/**
 * Applies persisted settings to the current native window.
 */
export async function applyWindowSettings(settings: Settings): Promise<void> {
  const window = getCurrentWindow();
  // 位置はドラッグ時のonMovedイベントが返す物理座標と単位を揃え、
  // サイズはtauri.conf.jsonの論理サイズ指定と単位を揃える
  await window.setPosition(
    new PhysicalPosition(settings.windowPosition.x, settings.windowPosition.y),
  );
  await window.setSize(
    new LogicalSize(settings.windowSize.width, settings.windowSize.height),
  );
  await window.setAlwaysOnTop(settings.alwaysOnTop);
}
