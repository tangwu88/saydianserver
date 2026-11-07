<script setup lang="ts">
import { reactive, ref } from "vue";
import { onShow, onHide, onUnload } from "@dcloudio/uni-app";
import { requireLogin } from "../../api";
import {
  createMemberProfileClient,
  MEMBER_PROFILE_ROUTE,
  profileInput,
} from "../../member-profile";
import DesktopHeader from "../../components/DesktopHeader.vue";

const form = reactive({
  nickname: "",
  gender: "unspecified",
  birthday: "",
  heightCm: "",
  weightKg: "",
});
const profile = ref<any>(),
  avatarUrl = ref(""),
  avatarFileId = ref<string | null>(),
  loading = ref(false),
  saving = ref(false),
  uploading = ref(false),
  error = ref(""),
  saved = ref(false);
const genders = ["不设置", "男", "女"],
  genderValues = ["unspecified", "male", "female"];
const today = new Date().toISOString().slice(0, 10);
let client: ReturnType<typeof createMemberProfileClient> | undefined,
  version = 0;
function close() {
  uni.switchTab({ url: "/pages/profile/index" });
}
function dispose() {
  version++;
  client?.cancel();
  client = undefined;
}
async function load() {
  if (!requireLogin(MEMBER_PROFILE_ROUTE)) return;
  dispose();
  const current = ++version;
  client = createMemberProfileClient();
  loading.value = true;
  saving.value = false;
  uploading.value = false;
  error.value = "";
  profile.value = undefined;
  try {
    const data = await client.load();
    if (current !== version) return;
    profile.value = data;
    Object.assign(form, {
      nickname: data.nickname || "",
      gender: data.gender || "unspecified",
      birthday: data.birthday || "",
      heightCm: data.heightCm == null ? "" : String(data.heightCm),
      weightKg: data.weightKg == null ? "" : String(data.weightKg),
    });
    avatarUrl.value = data.avatarUrl || "";
    avatarFileId.value = undefined;
    saved.value = false;
  } catch (cause) {
    if (current === version)
      error.value =
        cause instanceof Error ? cause.message : "资料读取失败，请重试";
  } finally {
    if (current === version) loading.value = false;
  }
}
async function chooseAvatar() {
  if (!client || loading.value || uploading.value || saving.value) return;
  const current = version;
  uploading.value = true;
  error.value = "";
  saved.value = false;
  try {
    const selection: any = await new Promise((resolve, reject) =>
      uni.chooseImage({
        count: 1,
        sizeType: ["compressed"],
        sourceType: ["album"],
        success: resolve,
        fail: reject,
      }),
    );
    if (current !== version || !client) return;
    const image = await client.uploadAvatar(selection.tempFiles?.[0]);
    if (current !== version) return;
    avatarFileId.value = image.id;
    avatarUrl.value = image.url;
  } catch (cause) {
    if (
      current === version &&
      !/cancel/i.test(String((cause as any)?.errMsg || ""))
    )
      error.value =
        cause instanceof Error ? cause.message : "头像未能上传，请重试";
  } finally {
    if (current === version) uploading.value = false;
  }
}
async function save() {
  if (
    !client ||
    !profile.value ||
    loading.value ||
    saving.value ||
    uploading.value
  )
    return;
  const current = version;
  saving.value = true;
  error.value = "";
  saved.value = false;
  try {
    const result = await client.save(profileInput(form, avatarFileId.value));
    if (current !== version) return;
    profile.value = result;
    saved.value = true;
    avatarFileId.value = undefined;
    uni.showToast({ title: "资料已保存", icon: "success" });
  } catch (cause) {
    if (current === version)
      error.value =
        cause instanceof Error ? cause.message : "保存未完成，请重试";
  } finally {
    if (current === version) saving.value = false;
  }
}
onShow(() => {
  void load();
});
onHide(dispose);
onUnload(dispose);
</script>
<template>
  <DesktopHeader />
  <view class="saydian-app-surface"
    ><view class="profile-content">
      <view class="profile-heading"
        ><button class="text-button" @click="close">‹ 个人中心</button>
        <h1>个人资料</h1></view
      >
      <view v-if="loading" class="muted profile-state">正在读取资料…</view>
      <view
        v-if="!loading && !profile && error"
        class="error-state"
        role="alert"
        >{{ error
        }}<button class="text-button" @click="load">重新加载</button></view
      >
      <view v-if="profile" class="app-panel profile-panel">
        <button
          class="avatar-action"
          :disabled="loading || saving || uploading"
          @click="chooseAvatar"
          aria-label="更换头像"
        >
          <view class="profile-avatar"
            ><image
              v-if="avatarUrl"
              class="profile-avatar-photo"
              :src="avatarUrl"
              mode="aspectFill"
            /><text v-else>{{ form.nickname.slice(0, 1) || "S" }}</text></view
          >
          <view class="avatar-copy"
            ><b>{{ uploading ? "正在上传…" : "更换头像" }}</b
            ><text class="muted">JPG、PNG、WebP · 10MB以内</text></view
          ><text class="arrow">›</text>
        </button>
        <text class="profile-number">会员 ID：{{ profile.memberNo }}</text>
        <view class="profile-field"
          ><label for="member-nickname">昵称</label
          ><input
            id="member-nickname"
            v-model="form.nickname"
            class="profile-input"
            maxlength="40"
            placeholder="请输入昵称"
            :disabled="loading || saving"
        /></view>
        <view class="profile-field"
          ><text>性别</text
          ><view class="gender-options" role="group" aria-label="性别"
            ><button
              v-for="(value, index) in genderValues"
              :key="value"
              class="gender-option"
              role="button"
              :aria-pressed="form.gender === value"
              :class="{ selected: form.gender === value }"
              :disabled="saving || loading"
              @click="form.gender = value"
            >
              {{ genders[index] }}
            </button></view
          ></view
        >
        <view class="profile-field"
          ><text>出生日期</text
          ><picker
            mode="date"
            :value="form.birthday || '2000-01-01'"
            :end="today"
            :disabled="saving || loading"
            @change="form.birthday = String($event.detail.value)"
            ><view class="profile-input picker-value"
              >{{ form.birthday || "请选择（选填）"
              }}<text class="arrow">›</text></view
            ></picker
          ></view
        >
        <view class="profile-metrics">
          <view class="profile-field"
            ><label for="member-height">身高（cm）</label
            ><input
              id="member-height"
              v-model="form.heightCm"
              class="profile-input"
              type="digit"
              placeholder="选填"
              :disabled="loading || saving"
          /></view>
          <view class="profile-field"
            ><label for="member-weight">体重（kg）</label
            ><input
              id="member-weight"
              v-model="form.weightKg"
              class="profile-input"
              type="digit"
              placeholder="选填"
              :disabled="loading || saving"
          /></view>
        </view>
        <text class="profile-sync muted"
          >资料与 App 共用，保存后同步更新。</text
        >
        <view v-if="error" class="error-state" role="alert">{{ error }}</view>
        <view v-if="saved" class="profile-saved" role="status">✓ 已保存</view>
        <button
          class="primary-btn"
          :loading="saving"
          :disabled="loading || saving || uploading"
          @click="save"
        >
          {{ saving ? "正在保存…" : "保存资料" }}
        </button>
      </view>
    </view></view
  >
</template>
<style lang="scss">
@import "../../global-ui.scss";
</style>
<style scoped>
.profile-content {
  max-width: 600px;
  margin: 0 auto;
}
.profile-heading {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 20px;
}
.profile-heading h1 {
  font-size: 22px;
  margin: 0;
}
.profile-heading .text-button {
  width: auto;
  margin: 0;
  padding: 8px 0;
}
.profile-panel {
  padding: 22px;
}
.avatar-action {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 0 0 20px;
  margin: 0 0 8px;
  text-align: left;
  background: none;
  line-height: 1.5;
  border-radius: 0;
  border-bottom: 1px solid var(--line);
  color: var(--ink);
}
.avatar-copy {
  flex: 1;
  min-width: 0;
}
.avatar-action .muted {
  display: block;
  font-size: 12px;
  margin-top: 6px;
}
.profile-avatar {
  width: 64px;
  height: 64px;
  flex: none;
  overflow: hidden;
  border-radius: 50%;
  background: #e9eee4;
  color: #245d47;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: 800;
}
.profile-avatar-photo {
  display: block;
  width: 100%;
  height: 100%;
}
.profile-number {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin: 12px 0 24px;
}
.profile-field {
  display: grid;
  gap: 9px;
  margin-bottom: 20px;
  font-size: 15px;
  font-weight: 600;
  min-width: 0;
}
.profile-input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 48px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
  font-size: 16px;
  font-weight: 400;
}
.picker-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.gender-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.gender-option {
  margin: 0;
  padding: 12px 4px;
  min-height: 48px;
  line-height: 22px;
  background: white;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--ink);
  font-size: 15px;
}
.gender-option.selected {
  border-color: var(--green);
  background: #e9eee4;
  color: var(--green);
  font-weight: 700;
}
.arrow {
  color: #98a2b3;
  font-size: 22px;
}
.profile-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.profile-sync {
  display: block;
  font-size: 13px;
  line-height: 1.6;
  margin-bottom: 18px;
}
.profile-saved {
  color: #245d47;
  margin: 12px 0;
  font-size: 14px;
}
.profile-state {
  display: block;
  padding: 24px 0;
}
@media (max-width: 400px) {
  .profile-panel {
    padding: 18px;
  }
  .avatar-action {
    gap: 12px;
  }
  .profile-avatar {
    width: 56px;
    height: 56px;
  }
  .profile-metrics {
    gap: 12px;
  }
}
</style>
