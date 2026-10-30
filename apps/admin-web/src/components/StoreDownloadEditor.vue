<script setup lang="ts">
import { computed } from "vue";
import { defaultStoreDownload, type StoreDownloadConfig } from "@saydian/app-contracts";
const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const value = computed<StoreDownloadConfig>(() => {
  try { return { ...defaultStoreDownload, ...JSON.parse(props.modelValue || '{}') }; }
  catch { return { ...defaultStoreDownload }; }
});
function update(key: keyof StoreDownloadConfig, text: string) { emit('update:modelValue', JSON.stringify({ ...value.value, [key]: text }, null, 2)); }
const fields: { key: keyof StoreDownloadConfig; label: string; limit?: number }[] = [
  { key: 'title', label: '入口标题', limit: 24 }, { key: 'description', label: '入口说明', limit: 48 },
  { key: 'iconUrl', label: '图标图片地址' }, { key: 'cnUrl', label: '赛电中文下载页' },
  { key: 'ringUrl', label: '赛电戒指下载页' }, { key: 'internationalUrl', label: '赛电国际下载页' },
];
</script>
<template>
  <el-alert title="手机端在首页搜索框下方常驻展示，无关闭按钮；电脑端展示导航入口。下载页继续使用已发布的真实版本。" type="info" :closable="false" show-icon />
  <el-form-item v-for="field in fields" :key="field.key" :label="field.label"><el-input :model-value="value[field.key]" :maxlength="field.limit" :show-word-limit="!!field.limit" :placeholder="field.key === 'iconUrl' ? '留空使用默认图标；可填写本站 HTTPS 图片地址' : ''" @update:model-value="update(field.key, String($event))" /></el-form-item>
  <el-form-item v-if="value.iconUrl" label="图标预览"><el-image :src="value.iconUrl" style="width:56px;height:56px" fit="contain"><template #error>图片不可用</template></el-image></el-form-item>
</template>
