<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ref, watchEffect } from "vue";
import { loadImageDataUrl } from "../images";

const props = defineProps<{
  label: string;
  imageType: "typing1" | "typing2" | "idle";
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const previewUrl = ref<string | null>(null);
// 検証エラーは画面下部のステータスではなく、対象スロットの直下に出す
const errorMessage = ref("");

// パスが変わるたびにプレビューを読み直す
watchEffect(async () => {
  previewUrl.value = await loadImageDataUrl(props.modelValue);
});

async function selectImage() {
  const selected = await open({
    multiple: false,
    filters: [{ name: "PNG Image", extensions: ["png"] }],
  });
  if (typeof selected !== "string") {
    return;
  }
  errorMessage.value = "";
  try {
    // 検証とアプリ管理ディレクトリへのコピーはRust側が行う
    const storedPath = await invoke<string>("register_image", {
      imageType: props.imageType,
      sourcePath: selected,
    });
    emit("update:modelValue", storedPath);
    // 固定名への上書きコピーではパス文字列が変わらず親のv-model更新が発火しないため、
    // プレビューはここで明示的に読み直す
    previewUrl.value = await loadImageDataUrl(storedPath);
  } catch (error) {
    errorMessage.value = String(error);
  }
}

function clearImage() {
  errorMessage.value = "";
  emit("update:modelValue", "");
}
</script>

<template>
  <div class="image-slot">
    <span class="image-slot-label">{{ label }}</span>
    <div class="image-slot-body">
      <img
        v-if="previewUrl"
        class="image-preview"
        :src="previewUrl"
        :alt="`${label} preview`"
      >
      <span v-else class="image-placeholder">No image</span>
      <div class="image-slot-actions">
        <Button label="Select" @click="selectImage" />
        <Button
          label="Clear"
          severity="secondary"
          :disabled="!modelValue"
          @click="clearImage"
        />
      </div>
    </div>
    <p v-if="errorMessage" class="image-slot-error" role="alert">
      {{ errorMessage }}
    </p>
  </div>
</template>

<style scoped>
.image-slot {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.image-slot-label {
  font-weight: 500;
  color: #666;
}

.image-slot-body {
  display: flex;
  align-items: center;
  gap: 10px;
}

.image-preview {
  width: 64px;
  height: 64px;
  object-fit: contain;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
}

.image-placeholder {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #999;
  border: 1px dashed #ccc;
  border-radius: 4px;
}

.image-slot-actions {
  display: flex;
  gap: 10px;
}

.image-slot-error {
  margin: 0;
  font-size: 13px;
  color: #c62828;
}
</style>
