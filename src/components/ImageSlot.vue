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
  error: [message: string];
}>();

const previewUrl = ref<string | null>(null);

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
  try {
    // 検証とアプリ管理ディレクトリへのコピーはRust側が行う
    const storedPath = await invoke<string>("register_image", {
      imageType: props.imageType,
      sourcePath: selected,
    });
    emit("update:modelValue", storedPath);
  } catch (error) {
    emit("error", String(error));
  }
}

function clearImage() {
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
</style>
