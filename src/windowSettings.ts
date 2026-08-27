import {
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import { createLogger } from "./logger";
import type { Settings } from "./types/settings";

const log = createLogger("windowSettings");

/**
 * What the running windowing backend is able to do.
 */
export interface WindowCapabilities {
  /** Whether absolute window positions can be set and read back. */
  positioning: boolean;
}

/**
 * Applies persisted settings to the current native window.
 */
export async function applyWindowSettings(
  settings: Settings,
  capabilities: WindowCapabilities = { positioning: true },
): Promise<void> {
  const window = getCurrentWindow();
  // 位置はドラッグ時のonMovedイベントが返す物理座標と単位を揃え、
  // サイズはtauri.conf.jsonの論理サイズ指定と単位を揃える
  log.debug("applying window settings", {
    position: settings.windowPosition,
    size: settings.windowSize,
    alwaysOnTop: settings.alwaysOnTop,
    capabilities,
  });

  if (capabilities.positioning) {
    await window.setPosition(
      new PhysicalPosition(
        settings.windowPosition.x,
        settings.windowPosition.y,
      ),
    );
  } else {
    // 位置を扱えないバックエンドでは要求しても無視されるだけなので送らない
    log.warn("skipping window position: backend cannot position windows");
  }
  await window.setSize(
    new LogicalSize(settings.windowSize.width, settings.windowSize.height),
  );
  await window.setAlwaysOnTop(settings.alwaysOnTop);

  // 要求値と実際の値を突き合わせ、ウィンドウマネージャが要求を
  // 無視しているかどうかをログから判別できるようにする
  await logActualWindowState(window);
}

/**
 * Logs the window state the compositor actually reports back.
 */
async function logActualWindowState(
  window: ReturnType<typeof getCurrentWindow>,
): Promise<void> {
  try {
    const [position, size, scaleFactor] = await Promise.all([
      window.outerPosition(),
      window.outerSize(),
      window.scaleFactor(),
    ]);
    log.debug("actual window state after apply", {
      position: { x: position.x, y: position.y },
      size: { width: size.width, height: size.height },
      scaleFactor,
    });
  } catch (error) {
    log.warn("failed to read back window state", String(error));
  }
}
