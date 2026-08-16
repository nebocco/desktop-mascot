<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { onMounted, ref } from "vue";
import type { Settings } from "./types/settings";
import { createDefaultSettings, sanitizeSettings } from "./types/settings";

const settings = ref<Settings>(createDefaultSettings());
const isSaving = ref(false);
const statusMessage = ref("");
const statusIsError = ref(false);

// 操作結果はconsoleではなく画面上でユーザーに伝える
function showStatus(message: string, isError = false) {
  statusMessage.value = message;
  statusIsError.value = isError;
}

// 設定の読み込み
async function loadSettings() {
  try {
    const loadedSettings = await invoke<Settings>("get_settings");
    if (loadedSettings) {
      settings.value = loadedSettings;
    }
  } catch (error) {
    console.error("Failed to load settings:", error);
  }
}

// 設定の保存
async function saveSettings() {
  isSaving.value = true;
  try {
    // InputNumberの空入力によるnullを保存前に補完する
    settings.value = sanitizeSettings(settings.value);
    await invoke("save_settings", { settings: settings.value });
    showStatus("Settings saved");
  } catch (error) {
    showStatus(`Failed to save settings: ${error}`, true);
  } finally {
    isSaving.value = false;
  }
}

// 設定のリセット
async function resetSettings() {
  try {
    // Rust側のデフォルトを唯一の真実の源とするため、戻り値をそのまま採用する
    settings.value = await invoke<Settings>("reset_settings");
    showStatus("Settings reset");
  } catch (error) {
    showStatus(`Failed to reset settings: ${error}`, true);
  }
}

// マスコット画像スロットの一覧(テンプレートのv-forで使用)
const imageSlots = [
  { key: "typing1", label: "Typing Image 1" },
  { key: "typing2", label: "Typing Image 2" },
  { key: "idle", label: "Idle Image" },
] as const;

// 画像ファイルの選択
async function selectImage(imageType: "typing1" | "typing2" | "idle") {
  try {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Image",
          extensions: ["png", "jpg", "jpeg"],
        },
      ],
    });

    if (selected && typeof selected === "string") {
      settings.value.images[imageType] = selected;
    }
  } catch (error) {
    console.error("Failed to select image:", error);
  }
}

onMounted(() => {
  loadSettings();
});
</script>

<template>
  <div class="settings-window">
    <h1>Desktop Mascot Settings</h1>

    <div class="settings-section">
      <h2>Mascot Images</h2>
      <div class="image-settings">
        <div v-for="slot in imageSlots" :key="slot.key" class="image-item">
          <label :for="`image-${slot.key}`">{{ slot.label }}:</label>
          <div class="image-input-group">
            <InputText
              :id="`image-${slot.key}`"
              v-model="settings.images[slot.key]"
              placeholder="No image selected"
              readonly
            />
            <Button label="Select" @click="selectImage(slot.key)" />
          </div>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h2>Animation Settings</h2>
      <div class="slider-container">
        <span class="slider-label"
          >Animation Speed (ms/frame): {{ settings.animationSpeed }}</span
        >
        <Slider
          v-model="settings.animationSpeed"
          aria-label="Animation Speed"
          :min="50"
          :max="500"
          :step="10"
        />
      </div>

      <div class="slider-container">
        <span class="slider-label"
          >Opacity: {{ settings.opacity.toFixed(2) }}</span
        >
        <Slider
          v-model="settings.opacity"
          aria-label="Opacity"
          :min="0"
          :max="1"
          :step="0.01"
        />
      </div>
    </div>

    <div class="settings-section">
      <h2>Window Settings</h2>
      <div class="window-settings">
        <div class="checkbox-item">
          <Checkbox
            v-model="settings.alwaysOnTop"
            :binary="true"
            input-id="alwaysOnTop"
          />
          <label for="alwaysOnTop">Always on Top</label>
        </div>

        <div class="position-settings">
          <div class="input-group">
            <label for="position-x">X Position:</label>
            <InputNumber
              v-model="settings.windowPosition.x"
              input-id="position-x"
              :allow-empty="false"
            />
          </div>
          <div class="input-group">
            <label for="position-y">Y Position:</label>
            <InputNumber
              v-model="settings.windowPosition.y"
              input-id="position-y"
              :allow-empty="false"
            />
          </div>
        </div>

        <div class="position-settings">
          <div class="input-group">
            <label for="window-width">Width:</label>
            <InputNumber
              v-model="settings.windowSize.width"
              input-id="window-width"
              :min="100"
              :allow-empty="false"
            />
          </div>
          <div class="input-group">
            <label for="window-height">Height:</label>
            <InputNumber
              v-model="settings.windowSize.height"
              input-id="window-height"
              :min="100"
              :allow-empty="false"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="actions">
      <Button
        label="Save Settings"
        icon="pi pi-save"
        @click="saveSettings"
        :loading="isSaving"
      />
      <Button
        label="Reset to Default"
        icon="pi pi-refresh"
        severity="secondary"
        @click="resetSettings"
      />
    </div>

    <p
      v-if="statusMessage"
      class="status-message"
      :class="{ 'status-error': statusIsError }"
      role="status"
    >
      {{ statusMessage }}
    </p>
  </div>
</template>

<style scoped>
.settings-window {
  padding: 20px;
  max-width: 600px;
  margin: 0 auto;
}

h1 {
  font-size: 24px;
  margin-bottom: 20px;
  color: #333;
}

h2 {
  font-size: 18px;
  margin-bottom: 15px;
  color: #555;
}

.settings-section {
  margin-bottom: 30px;
  padding: 20px;
  background: #f9f9f9;
  border-radius: 8px;
}

.image-settings {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.image-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.image-item label {
  font-weight: 500;
  color: #666;
}

.image-input-group {
  display: flex;
  gap: 10px;
}

.slider-container {
  margin-bottom: 20px;
}

.slider-container .slider-label {
  display: block;
  margin-bottom: 10px;
  font-weight: 500;
  color: #666;
}

.checkbox-item {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 15px;
}

.window-settings {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.position-settings {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.input-group label {
  font-weight: 500;
  color: #666;
}

.actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 20px;
}

.status-message {
  margin-top: 10px;
  text-align: right;
  color: #2e7d32;
}

.status-message.status-error {
  color: #c62828;
}
</style>

<style>
body {
  margin: 0;
  font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
  background: #fff;
}

#app {
  width: 100%;
  min-height: 100vh;
}
</style>
