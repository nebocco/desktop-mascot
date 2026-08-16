<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { emit as emitEvent, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onMounted, onUnmounted, ref } from "vue";
import {
  POSITION_CHANGED_EVENT,
  SETTINGS_UPDATED_EVENT,
  SETTINGS_WINDOW_URL,
} from "./constants";
import { debounce } from "./debounce";
import { loadImageDataUrl } from "./images";
import type { Settings } from "./types/settings";
import { applyWindowSettings } from "./windowSettings";

const mascotUrl = ref<string | null>(null);
const mascotOpacity = ref(1);

// 設定をメインウィンドウの見た目とネイティブプロパティに反映する
async function applySettings(settings: Settings) {
  mascotOpacity.value = settings.opacity;
  mascotUrl.value = await loadImageDataUrl(settings.images.idle);
  await applyWindowSettings(settings);
}

const unlisteners: Array<() => void> = [];

onMounted(async () => {
  try {
    const settings = await invoke<Settings>("get_settings");
    await applySettings(settings);
  } catch (error) {
    console.error("Failed to load settings:", error);
  }

  unlisteners.push(
    await listen<Settings>(SETTINGS_UPDATED_EVENT, (event) => {
      // ハンドラ内は同期コールバックなので、失敗を捕まえないと未処理のPromise拒否になる
      applySettings(event.payload).catch((error) => {
        console.error("Failed to apply settings:", error);
      });
    }),
  );

  // ドラッグ中はonMovedが連続発火するため、静止後に一度だけ保存する
  const savePosition = debounce(async (x: number, y: number) => {
    try {
      await invoke("save_window_position", { x, y });
      await emitEvent(POSITION_CHANGED_EVENT, { x, y });
    } catch (error) {
      console.error("Failed to save window position:", error);
    }
  }, 500);
  unlisteners.push(
    await getCurrentWindow().onMoved((event) => {
      savePosition(event.payload.x, event.payload.y);
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
        <div class="mascot-text" data-tauri-drag-region>🐱</div>
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
  align-items: center;
  justify-content: center;
  user-select: none;
}

.mascot-text {
  filter: drop-shadow(2px 2px 4px rgba(0, 0, 0, 0.3));
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
