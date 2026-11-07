<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed, watch } from "vue";
import type {
  HealthScreenTransport,
  ScreenProfileGate,
  ScreenProfile,
  ScreenProfileField,
} from "@saydian/app-contracts";
import HealthScreen from "./HealthScreen.vue";
import ScreenMemberLogin from "./ScreenMemberLogin.vue";
import { DEFAULT_FORM_BIRTHDAY, profileFormDraft } from "./profile-form";
import {
  ownKey,
  ownTransport,
  sessionKey,
  accessStatus,
  memberRoot,
  request,
} from "./member-access";
import "./screen-entry.css";
const props = defineProps<{
  memberId: string;
  transport: HealthScreenTransport;
  backUrl: string;
  errorMessage: (e: unknown) => string;
  sessionKey: () => string | null;
  requiresRecordReason?: boolean;
}>();
const emit = defineEmits<{ self: [] }>();
const mode = ref<"staff" | "self" | "login" | "loading" | "error">("loading"),
  gate = ref<ScreenProfileGate | null>(null),
  error = ref(""),
  busy = ref(false);
const draft = ref<ScreenProfile>({
  name: "",
  gender: "UNSPECIFIED",
  birthday: null,
  weightKg: null,
  heightCm: null,
});
const transport = computed(() =>
  mode.value === "self" ? ownTransport : props.transport,
);
let clock = 0,
  controller: AbortController | undefined,
  alive = true;
const visibleError = (e: unknown) =>
  e instanceof Error && !accessStatus(e)
    ? e.message
    : (e as any)?.response?.data?.message ||
      (e as Error)?.message ||
      "操作失败，请重试";
async function enter(preferSelf = false) {
  const n = ++clock;
  controller?.abort();
  controller = new AbortController();
  gate.value = null;
  error.value = "";
  busy.value = false;
  mode.value = "loading";
  const staff = !preferSelf && props.memberId !== "me" && !!props.sessionKey();
  const self = !staff && !!sessionKey();
  if (!staff && !self) {
    mode.value = "login";
    return;
  }
  const identity = staff ? props.sessionKey() : sessionKey(),
    owned = () =>
      alive &&
      n === clock &&
      identity === (staff ? props.sessionKey() : sessionKey());
  try {
    const result = await (staff ? props.transport : ownTransport).profile(
      staff ? props.memberId : "me",
      controller.signal,
    );
    if (!owned()) return;
    gate.value = result;
    draft.value = {
      ...profileFormDraft(result),
      name: result.profile.name || result.suggestedName,
    };
    mode.value = staff ? "staff" : "self";
    if (self && props.memberId !== "me") emit("self");
  } catch (e) {
    if (n !== clock || !alive) return;
    const res = accessStatus(e);
    if (
      res?.status === 401 ||
      res?.status === 403 ||
      res?.data?.errorKey === "member_unavailable"
    ) {
      if (staff) {
        void enter(true);
        return;
      }
      sessionStorage.removeItem(ownKey);
      mode.value = "login";
      return;
    }
    mode.value = "error";
    error.value = visibleError(e);
  }
}
function login(token: string) {
  sessionStorage.setItem(ownKey, token);
  if (props.memberId !== "me") emit("self");
  void enter(true);
}
async function logout() {
  const token = sessionKey();
  sessionStorage.removeItem(ownKey);
  ++clock;
  gate.value = null;
  mode.value = "login";
  if (token)
    await request(memberRoot + "/me/logout", { token, data: {} }).catch(
      () => {},
    );
}
function accessLost() {
  void enter(mode.value === "self");
}
async function save() {
  const g = gate.value;
  if (!g?.canComplete || busy.value) return;
  const n = clock;
  busy.value = true;
  error.value = "";
  try {
    const fields = Object.fromEntries(
      g.missing.map((k) => [k, draft.value[k]]),
    );
    await transport.value.completeProfile(
      mode.value === "self" ? "me" : props.memberId,
      fields,
    );
    if (n === clock) await enter(mode.value === "self");
  } catch (e) {
    if (n === clock) {
      if ([401, 403, 409].includes(accessStatus(e)?.status || 0)) {
        void enter(mode.value === "self");
      } else error.value = visibleError(e);
    }
  } finally {
    if (n === clock) busy.value = false;
  }
}
function missing(k: ScreenProfileField) {
  return !!gate.value?.missing.includes(k);
}
function asMember() {
  if (sessionKey()) {
    void enter(true);
  } else {
    ++clock;
    gate.value = null;
    error.value = "";
    mode.value = "login";
  }
}
const labels = {
  name: "姓名",
  gender: "性别",
  birthday: "出生日期",
  weightKg: "体重",
};
watch(
  () => props.memberId,
  () => void enter(),
  { immediate: true },
);
function staffChanged() {
  if (mode.value === "staff" || mode.value === "loading") void enter(true);
}
onMounted(() =>
  window.addEventListener("health-screen-staff-expired", staffChanged),
);
onBeforeUnmount(() => {
  alive = false;
  clock++;
  controller?.abort();
  window.removeEventListener("health-screen-staff-expired", staffChanged);
});
</script>
<template>
  <ScreenMemberLogin v-if="mode === 'login'" @login="login" />
  <div v-else-if="mode === 'loading' || mode === 'error'" class="screen-entry">
    <section class="entry-card" role="status">
      <h2>{{ error || "正在检查大屏访问权限…" }}</h2>
      <button v-if="error" @click="enter()">重试</button>
      <button v-if="error" @click="asMember">会员登录</button>
    </section>
  </div>
  <div v-else-if="gate?.missing.length" class="screen-entry">
    <section
      class="entry-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="complete-title"
    >
      <h1 id="complete-title">完善会员基本资料</h1>
      <p>
        进入健康大屏前，请补全{{
          gate.missing.map((k) => labels[k]).join("、")
        }}。
      </p>
      <form v-if="gate.canComplete" @submit.prevent="save">
        <label v-if="missing('name')"
          >姓名<input
            v-model.trim="draft.name"
            maxlength="40"
            required
            autocomplete="name"
        /></label>
        <label v-if="missing('gender')"
          >性别<select v-model="draft.gender" required>
            <option disabled value="UNSPECIFIED">请选择</option>
            <option value="MALE">男</option>
            <option value="FEMALE">女</option>
          </select></label
        >
        <label v-if="missing('birthday')"
          ><span>出生日期<small v-if="draft.birthday === DEFAULT_FORM_BIRTHDAY">（预填）</small></span>
          <input v-model="draft.birthday" type="date" required />
        </label>
        <label v-if="missing('weightKg')"
          >体重（千克）<input
            v-model.number="draft.weightKg"
            type="number"
            step="0.01"
            min="0.1"
            max="500"
            required
        /></label>
        <p v-if="error" role="alert" class="entry-error">{{ error }}</p>
        <button class="entry-primary" :disabled="busy">
          {{ busy ? "正在保存…" : "保存并进入大屏" }}
        </button>
      </form>
      <template v-else
        ><p>请由会员本人或总管理员完善资料。</p>
        <button class="entry-primary" @click="asMember">以会员身份登录</button
        ><button @click="enter()">已完善，重新检查</button></template
      >
    </section>
  </div>
  <template v-else-if="gate"
    ><HealthScreen
      :key="mode + memberId"
      :member-id="mode === 'self' ? 'me' : memberId"
      :transport="transport"
      :back-label="mode === 'self' ? '返回我的账户' : '返回会员列表'"
      :back-url="
        mode === 'self' ? '/global/saidian-mall/#/pages/profile/index' : backUrl
      "
      :error-message="mode === 'self' ? visibleError : errorMessage"
      :session-key="mode === 'self' ? sessionKey : props.sessionKey"
      :requires-record-reason="mode === 'staff' && requiresRecordReason"
      @access-lost="accessLost"
      ><template v-if="mode === 'self'" #session="{ availability }"
        ><small v-if="availability"
          >本人访问 · AI 可用 {{ availability.credits }} 次</small
        ><button type="button" @click="logout">退出会员登录</button></template
      ></HealthScreen
    ></template
  >
</template>
