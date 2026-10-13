<script setup lang="ts">
import { Document } from "@element-plus/icons-vue";
defineProps<{ title: string; description?: string }>();
</script>
<template>
  <div class="empty-state">
    <el-icon :size="36" aria-hidden="true"><Document /></el-icon>
    <h2>{{ title }}</h2>
    <p v-if="description">{{ description }}</p>
    <slot />
  </div>
</template>
