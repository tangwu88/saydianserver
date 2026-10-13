<script setup lang="ts">
import { WarningFilled, Refresh } from "@element-plus/icons-vue";
defineProps<{ message: string }>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <div v-if="message" class="page-error" role="alert">
    <el-icon><WarningFilled /></el-icon><span>{{ message }}</span
    ><el-button :icon="Refresh" @click="$emit('retry')">重试</el-button>
  </div>
</template>
