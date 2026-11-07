<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type {
  HealthScreenTransport,
  ScreenProfile,
  ScreenProfileGate,
} from "@saydian/app-contracts";
import { accessStatus } from "./member-access";
import { DEFAULT_FORM_BIRTHDAY, profileFormDraft } from "./profile-form";
const props = defineProps<{
  memberId: string;
  transport: HealthScreenTransport;
  errorMessage: (e: unknown) => string;
}>();
const emit = defineEmits<{ close: []; saved: []; denied: [] }>();
const dialog = ref<HTMLDialogElement | null>(null),
  firstField = ref<HTMLInputElement | null>(null);
const gate = ref<ScreenProfileGate | null>(null),
  draft = ref<ScreenProfile | null>(null),
  error = ref(""),
  busy = ref(false),
  conflict = ref(false);
const controller = new AbortController();
const keys = ["name", "gender", "birthday", "weightKg", "heightCm"] as const;
const changes = computed(() =>
  Object.fromEntries(
    keys
      .filter((k) => draft.value && draft.value[k] !== gate.value?.profile[k])
      .map((k) => [k, draft.value![k]]),
  ),
);
const canSave = computed(
  () =>
    !!gate.value?.canComplete &&
    !busy.value &&
    !conflict.value &&
    Object.keys(changes.value).length > 0,
);
function handleError(e: unknown) {
  if (controller.signal.aborted) return;
  const status = accessStatus(e)?.status;
  if (status === 401 || status === 403 || status === 404 || status === 428) {
    emit("denied");
    return;
  }
  conflict.value = status === 409;
  error.value = props.errorMessage(e);
}
async function read() {
  busy.value = true;
  error.value = "";
  conflict.value = false;
  try {
    const data = await props.transport.profile(
      props.memberId,
      controller.signal,
    );
    if (controller.signal.aborted) return;
    gate.value = data;
    draft.value = profileFormDraft(data);
    await nextTick();
    if (data.canComplete) firstField.value?.focus();
  } catch (e) {
    handleError(e);
  } finally {
    busy.value = false;
  }
}
async function save() {
  if (!gate.value || !canSave.value) return;
  busy.value = true;
  error.value = "";
  try {
    await props.transport.completeProfile(props.memberId, {
      ...changes.value,
      expectedRevision: gate.value.revision,
    });
    if (!controller.signal.aborted) emit("saved");
  } catch (e) {
    handleError(e);
  } finally {
    busy.value = false;
  }
}
function close() {
  if (!busy.value || !gate.value) emit("close");
}
onMounted(() => {
  dialog.value?.showModal();
  void read();
});
onBeforeUnmount(() => {
  controller.abort();
  dialog.value?.close();
});
</script>
<template>
  <dialog
    class="screen-profile-dialog"
    ref="dialog"
    aria-labelledby="profile-edit-title"
    @cancel.prevent="close"
    @keydown.esc.stop
  >
    <section class="entry-card">
      <header class="profile-title">
        <div>
          <h2 id="profile-edit-title">
            {{
              gate && !gate.canComplete ? "会员基本资料" : "编辑会员基本资料"
            }}
          </h2>
          <p v-if="gate">会员编号 {{ gate.memberNo }}</p>
        </div>
        <button
          type="button"
          title="关闭"
          aria-label="关闭会员资料"
          :disabled="busy && !!gate"
          @click="close"
        >
          ×
        </button>
      </header>
      <form v-if="draft && gate" @submit.prevent="save">
        <fieldset :disabled="!gate.canComplete || busy">
          <label
            >姓名<input
              ref="firstField"
              v-model.trim="draft.name"
              required
              maxlength="40"
              autocomplete="name"
          /></label>
          <div class="profile-field-pair">
            <label
              >性别<select v-model="draft.gender" required>
                <option disabled value="UNSPECIFIED">请选择</option>
                <option value="MALE">男</option>
                <option value="FEMALE">女</option>
              </select></label
            >
            <label
              ><span>出生日期<small v-if="!gate.profile.birthday && draft.birthday === DEFAULT_FORM_BIRTHDAY">（预填）</small></span>
              <input v-model="draft.birthday" type="date" required />
            </label>
          </div>
          <div class="profile-field-pair">
            <label
              >体重（千克）<input
                v-model.number="draft.weightKg"
                type="number"
                inputmode="decimal"
                min="0.1"
                max="500"
                step="0.01"
                required
            /></label>
            <label
              >身高（厘米，选填）<input
                :value="draft.heightCm ?? ''"
                @input="
                  draft.heightCm =
                    ($event.target as HTMLInputElement).value === ''
                      ? null
                      : ($event.target as HTMLInputElement).valueAsNumber
                "
                type="number"
                inputmode="decimal"
                min="50"
                max="250"
                step="0.01"
            /></label>
          </div>
        </fieldset>
        <p v-if="!gate.canComplete">
          当前账号可查看资料，修改请由会员本人或总管理员操作。
        </p>
        <p v-if="error" class="entry-error" role="alert">{{ error }}</p>
        <button type="button" v-if="conflict" @click="read">
          重新载入最新资料
        </button>
        <footer v-if="gate.canComplete">
          <button type="button" :disabled="busy" @click="close">取消</button
          ><button class="entry-primary" type="submit" :disabled="!canSave">
            {{ busy ? "正在保存…" : "保存修改" }}
          </button>
        </footer>
      </form>
      <template v-else
        ><p role="status">{{ error || "正在读取会员资料…" }}</p>
        <button v-if="error" @click="read">重试</button></template
      >
    </section>
  </dialog>
</template>
<style scoped>
.screen-profile-dialog {
  border: 0;
  padding: 0;
  background: transparent;
  color: #e5f6ff;
  width: min(480px, calc(100% - 24px));
  max-height: 90dvh;
  overflow: auto;
  font:
    16px/1.5 system-ui,
    sans-serif;
}
.screen-profile-dialog::backdrop {
  background: #001322bd;
}
.screen-profile-dialog .entry-card {
  width: 100%;
  padding: clamp(18px, 4vw, 28px);
}
.profile-title,
.screen-profile-dialog footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.profile-title h2 {
  font-size: 22px;
}
.profile-title p {
  margin: 4px 0 0;
  font-size: 14px;
}
.profile-title > button {
  font-size: 23px;
  line-height: 1;
  padding: 6px 10px;
}
.screen-profile-dialog fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
.profile-field-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.profile-field-pair label {
  min-width: 0;
  margin: 6px 0;
}
.screen-profile-dialog footer {
  justify-content: flex-end;
  align-items: center;
  margin-top: 18px;
}
.screen-profile-dialog footer .entry-primary {
  width: auto;
  margin: 0;
  padding-inline: 20px;
}
@media (max-width: 400px) {
  .profile-field-pair {
    grid-template-columns: 1fr;
  }
}
</style>
