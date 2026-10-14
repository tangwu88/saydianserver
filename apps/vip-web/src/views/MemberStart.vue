<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { beginMemberLogin } from "../login-bridge";
const route = useRoute(),
  error = ref("");
onMounted(async () => {
  try {
    await beginMemberLogin(route.query.next);
  } catch {
    error.value = "暂时无法保存登录状态，请允许浏览器存储后重试";
  }
});
</script>
<template>
  <main class="page">
    <div class="panel">
      <h2>{{ error || "正在进入商城授权…" }}</h2>
      <a v-if="error" href="/vip/login?password=1">返回登录</a>
    </div>
  </main>
</template>
