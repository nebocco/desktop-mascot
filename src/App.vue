<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { emit as emitEvent, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { Frame, FrameImages } from "./animation";
import { PLACEHOLDER_EMOJI, selectFrameImage } from "./animation";
import {
  ANIMATION_FRAME_EVENT,
  POSITION_CHANGED_EVENT,
  SETTINGS_UPDATED_EVENT,
  SETTINGS_WINDOW_URL,
} from "./constants";
import { debounce } from "./debounce";
import { loadImageDataUrl } from "./images";
import { createLogger } from "./logger";
import type { Settings } from "./types/settings";
import { createPositionTracker } from "./windowPosition";
import type { WindowCapabilities } from "./windowSettings";
import { applyWindowSettings } from "./windowSettings";

const log = createLogger("main-window");

const frameImages = ref<FrameImages>({
  idle: null,
  typing1: null,
  typing2: null,
});
const currentFrame = ref<Frame>("idle");
const mascotUrl = computed(() =>
  selectFrameImage(currentFrame.value, frameImages.value),
);
const mascotOpacity = ref(1);

// Waylandのように位置を扱えないバックエンドでは、位置の適用も保存も行わない
const capabilities: WindowCapabilities = { positioning: true };

const positionTracker = createPositionTracker();

// 設定をメインウィンドウの見た目とネイティブプロパティに反映する
async function applySettings(settings: Settings) {
  log.debug("applying settings", settings);
  mascotOpacity.value = settings.opacity;
  // フレームの切り替えで読み込みを待たせないよう、3枚とも先に読み込んでおく
  const [idle, typing1, typing2] = await Promise.all([
    loadImageDataUrl(settings.images.idle),
    loadImageDataUrl(settings.images.typing1),
    loadImageDataUrl(settings.images.typing2),
  ]);
  frameImages.value = { idle, typing1, typing2 };
  // 位置が変わらない適用ではウィンドウを動かさない。動かすと、その直後の
  // ドラッグをアプリ自身による移動と見分ける必要が生じる
  const move =
    capabilities.positioning &&
    positionTracker.needsMove(settings.windowPosition);
  if (move) {
    positionTracker.expectMove(settings.windowPosition, performance.now());
  }
  await applyWindowSettings(settings, capabilities, move);
}

const unlisteners: Array<() => void> = [];

onMounted(async () => {
  try {
    capabilities.positioning = await invoke<boolean>(
      "supports_window_positioning",
    );
  } catch (error) {
    log.error("Failed to query positioning support", String(error));
  }

  // 位置を報告できないバックエンドでは、実際の移動を伴わないonMoved(0,0)が
  // 届いて保存済みの位置を壊すため、購読自体を行わない
  if (capabilities.positioning) {
    // ドラッグ中はonMovedが連続発火するため、静止後に一度だけ保存する
    const savePosition = debounce(async (x: number, y: number) => {
      try {
        log.debug("saving dragged position", { x, y });
        await invoke("save_window_position", { x, y });
        await emitEvent(POSITION_CHANGED_EVENT, { x, y });
      } catch (error) {
        log.error("Failed to save window position", String(error));
      }
    }, 500);
    // 起動時の位置適用で届く移動も受け取れるよう、設定を適用する前に購読する
    unlisteners.push(
      await getCurrentWindow().onMoved((event) => {
        const position = positionTracker.onMoved(
          event.payload,
          performance.now(),
        );
        if (position) {
          savePosition(position.x, position.y);
        }
      }),
    );
  } else {
    log.warn("position tracking disabled: backend cannot report positions");
  }

  try {
    const settings = await invoke<Settings>("get_settings");
    log.debug("settings loaded at startup", settings);
    await applySettings(settings);
  } catch (error) {
    log.error("Failed to load settings", String(error));
  }
  // ここより前に届いた移動は、ウィンドウマネージャによる初期配置なので保存しない
  positionTracker.start();

  unlisteners.push(
    await listen<Settings>(SETTINGS_UPDATED_EVENT, (event) => {
      log.debug("received settings-updated", event.payload);
      // ハンドラ内は同期コールバックなので、失敗を捕まえないと未処理のPromise拒否になる
      applySettings(event.payload).catch((error) => {
        log.error("Failed to apply settings", String(error));
      });
    }),
  );

  unlisteners.push(
    await listen<Frame>(ANIMATION_FRAME_EVENT, (event) => {
      currentFrame.value = event.payload;
    }),
  );
});

onUnmounted(() => {
  for (const unlisten of unlisteners) {
    unlisten();
  }
});

// 設定ウィンドウを開く
async function openSettings() {
  const settingsWindow = await WebviewWindow.getByLabel("settings");

  if (settingsWindow) {
    await settingsWindow.show();
    await settingsWindow.setFocus();
  } else {
    new WebviewWindow("settings", {
      url: SETTINGS_WINDOW_URL,
      title: "Settings",
      width: 600,
      height: 500,
      resizable: true,
    });
  }
}

// 右クリックでメニューを表示
function handleContextMenu(_event: MouseEvent) {
  openSettings();
}
</script>

<template>
  <!-- biome-ignore lint/a11y/noStaticElementInteractions: ウィンドウ全体をドラッグ領域兼右クリックメニューにするための意図的なdiv -->
  <div
    class="main-window"
    data-tauri-drag-region
    @contextmenu.prevent="handleContextMenu"
  >
    <!-- Tauriのドラッグ判定はmousedownを受けた要素自身の属性しか見ないため、
         全面を覆う内側の要素すべてに属性を付与する -->
    <div
      class="mascot-container"
      data-tauri-drag-region
      :style="{ opacity: mascotOpacity }"
    >
      <img
        v-if="mascotUrl"
        class="mascot-image"
        :src="mascotUrl"
        alt="Mascot"
        data-tauri-drag-region
      >
      <div v-else class="mascot-placeholder" data-tauri-drag-region>
        <!-- マスコット画像が未登録の間のプレースホルダー -->
        <div class="mascot-text" data-tauri-drag-region>
          {{ PLACEHOLDER_EMOJI[currentFrame] }}
        </div>
        <div class="mascot-frame-label" data-tauri-drag-region>
          {{ currentFrame }}
        </div>
      </div>
      <button type="button" class="settings-btn" @click="openSettings">
        設定
      </button>
    </div>
  </div>
</template>

<style scoped>
.main-window {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: move;
}

.mascot-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mascot-placeholder {
  font-size: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  user-select: none;
}

.mascot-text {
  filter: drop-shadow(2px 2px 4px rgba(0, 0, 0, 0.3));
}

.mascot-frame-label {
  font-size: 14px;
  font-family: monospace;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 4px;
  padding: 0 6px;
}

.mascot-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}

.settings-btn {
  position: absolute;
  bottom: 10px;
  right: 10px;
  background: rgba(255, 255, 255, 0.8);
  border: none;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.settings-btn:hover {
  opacity: 1;
}
</style>

<style>
html,
body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: transparent;
}

#app {
  width: 100vw;
  height: 100vh;
}
</style>
