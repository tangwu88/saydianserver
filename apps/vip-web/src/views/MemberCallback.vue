<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, data, errorMessage, partnerTokenKey } from "../api";
import { safeReturnPath } from "../navigation";
import { memberVerifierKey } from "../login-bridge";
const router = useRouter(),
  error = ref(""),
  retryPath = ref("/vip/auth/member-start"),
  passwordPath = ref("/vip/login?password=1");
onMounted(async () => {
  const fragment = new URLSearchParams(location.hash.slice(1)),
    ticket = fragment.get("ticket"),
    next = safeReturnPath(fragment.get("next"));
  retryPath.value = `/vip/auth/member-start?next=${encodeURIComponent(next)}`;
  passwordPath.value = `/vip/login?password=1&next=${encodeURIComponent(next)}`;
  history.replaceState(null, "", location.pathname);
  const codeVerifier = sessionStorage.getItem(memberVerifierKey);
  sessionStorage.removeItem(memberVerifierKey);
  if (!ticket || !codeVerifier) {
    error.value = "登录链接已失效，请从商城重新进入";
    return;
  }
  try {
    const result = data<{ token: string }>(
      await api.post("/auth/member-login", { ticket, codeVerifier }),
    );
    sessionStorage.setItem(partnerTokenKey, result.token);
    await router.replace(next);
  } catch (cause) {
    error.value = errorMessage(cause);
  }
});
</script>
<template>
  <main class="page">
    <div class="panel">
      <h2>{{ error ? "暂时无法登录" : "正在进入合作平台…" }}</h2>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="error"><a :href="retryPath">重新进行商城授权</a></p>
      <p v-if="error"><a :href="passwordPath">使用伙伴账号登录</a></p>
    </div>
  </main>
</template>
