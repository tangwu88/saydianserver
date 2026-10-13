<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { api, data, errorMessage, partnerTokenKey } from "../api";
const form = reactive({ username: "", password: "" }),
  busy = ref(false),
  error = ref("");
const router = useRouter();
async function login() {
  if (busy.value) return;
  if (!form.username.trim() || !form.password) {
    error.value = "请输入登录账号和密码";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const result = data<{ token: string }>(await api.post("/auth/login", form));
    sessionStorage.setItem(partnerTokenKey, result.token);
    form.password = "";
    await router.replace("/");
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <main class="login-screen">
    <section class="brand-story">
      <div class="wordmark">SAYDIAN <span>赛电</span></div>
      <div class="story-content">
        <span class="eyebrow">BRAND PARTNER</span>
        <h1>赛电品牌伙伴平台</h1>
        <p>连接会员服务与产品分销，<br />与赛电一起，让健康触手可及。</p>
        <div class="story-line"></div>
        <small>会员服务 · 分销采购 · 资金管理</small>
      </div>
      <div class="brand-circle"></div>
    </section>
    <section class="login-side">
      <form class="login-card" @submit.prevent="login">
        <span class="eyebrow">欢迎回来</span>
        <h2>品牌伙伴登录</h2>
        <p class="muted">使用总后台为您开通的专属账户</p>
        <el-alert
          v-if="error"
          :title="error"
          type="error"
          :closable="false"
          show-icon
          style="margin: 24px 0"
        /><label for="username">登录账号</label
        ><el-input
          id="username"
          v-model="form.username"
          autocomplete="username"
          placeholder="请输入账号"
          size="large"
          :disabled="busy"
        /><label for="password">登录密码</label
        ><el-input
          id="password"
          v-model="form.password"
          autocomplete="current-password"
          type="password"
          show-password
          placeholder="请输入密码"
          size="large"
          :disabled="busy"
        /><el-button
          native-type="submit"
          type="primary"
          size="large"
          :loading="busy"
          class="login-button"
          >登录平台</el-button
        >
        <p class="help">账户开通、密码重置，请联系赛电运营人员。</p>
      </form>
      <small class="copyright">赛电 SAYDIAN · 品牌伙伴平台</small>
    </section>
  </main>
</template>
<style scoped>
.login-screen {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 48% 52%;
  background: white;
}
.brand-story {
  position: relative;
  overflow: hidden;
  background: #171f2b;
  color: white;
  padding: 52px;
  display: flex;
  flex-direction: column;
}
.wordmark {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 3px;
}
.wordmark span {
  font-size: 19px;
  letter-spacing: 0;
  margin-left: 8px;
  color: #f0a0ab;
}
.story-content {
  margin: auto 0;
  z-index: 1;
}
.eyebrow {
  display: block;
  font-size: 12px;
  letter-spacing: 2px;
  font-weight: 600;
  color: #bd6674;
  margin-bottom: 20px;
}
.story-content h1 {
  font-size: clamp(26px, 2.5vw, 38px);
  margin-bottom: 25px;
}
.story-content p {
  font-size: 18px;
  line-height: 1.9;
  color: #b8c0cd;
}
.story-line {
  width: 48px;
  height: 3px;
  background: #d0334c;
  margin: 36px 0 22px;
}
.story-content small {
  color: #8f9aaa;
}
.brand-circle {
  width: 550px;
  height: 550px;
  border: 100px solid #252532;
  border-radius: 50%;
  position: absolute;
  right: -300px;
  bottom: -240px;
}
.login-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 28px;
}
.login-card {
  width: 100%;
  max-width: 390px;
}
.login-card h2 {
  font-size: 28px;
  margin-bottom: 12px;
}
.login-card label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  margin: 26px 0 10px;
}
.login-button {
  width: 100%;
  margin-top: 32px;
  height: 46px;
}
.help {
  color: #8991a0;
  font-size: 12px;
  text-align: center;
  line-height: 1.8;
  margin-top: 24px;
}
.copyright {
  color: #adb3bf;
  position: absolute;
  bottom: 26px;
  font-size: 11px;
}
@media (max-width: 760px) {
  .login-screen {
    display: block;
  }
  .brand-story {
    padding: 28px;
    height: 235px;
  }
  .story-content {
    margin-top: 25px;
  }
  .story-content h1 {
    font-size: 25px;
    margin-bottom: 14px;
  }
  .story-content p,
  .story-line,
  .story-content small,
  .story-content .eyebrow {
    display: none;
  }
  .login-side {
    padding-top: 36px;
  }
  .copyright {
    position: static;
    margin-top: 36px;
  }
}
</style>
