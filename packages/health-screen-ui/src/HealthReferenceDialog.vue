<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  HealthReferenceInput,
  HealthReferenceRecord,
  HealthScreenTransport,
} from "@saydian/app-contracts";
import {
  HEALTH_REFERENCE_DEFINITIONS,
  HEALTH_REFERENCE_METHODS,
  HEALTH_REFERENCE_CONTEXTS,
} from "@saydian/app-contracts";
import { referenceFormValues } from "./reference-form";
import { Close } from "@element-plus/icons-vue";
const props = defineProps<{
  memberId: string;
  memberName: string;
  memberNo: number;
  transport: HealthScreenTransport;
  errorMessage: (e: unknown) => string;
}>();
const emit = defineEmits<{ close: []; saved: []; "edit-profile":[]; denied: [error: unknown] }>();
const metric = ref<HealthReferenceInput["metric"]>("BLOOD_GLUCOSE");
const context = ref<HealthReferenceInput["context"]>("FASTING");
const method = ref<HealthReferenceInput["method"]>("GLUCOSE_METER");
const unit = ref("mmol/L"),
  fieldValues = ref<Record<string, string | number>>({});
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const localNow = () => {
  const d = new Date();
  return new Date(d.valueOf() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const measuredAt = ref(localNow()),
  error = ref(""),
  notice = ref(""),
  saving = ref(false),
  reading = ref(false);
const rows = ref<HealthReferenceRecord[]>([]),
  cursor = ref<string | null>(null),
  voidId = ref(""),
  voidReason = ref("");
const controller = new AbortController();
let active = true,
  requestKey = "",
  requestContent = "";
const definitions = HEALTH_REFERENCE_DEFINITIONS;
const methods = HEALTH_REFERENCE_METHODS;
const contexts = HEALTH_REFERENCE_CONTEXTS;
const def = computed(() => definitions[metric.value]);
const referenceLabel = (metric: string, key: string) => {
  const definition = definitions[metric as HealthReferenceInput["metric"]];
  return (
    (definition?.fields as Record<string, string> | undefined)?.[key] || key
  );
};
watch(metric, () => {
  unit.value = def.value.units[0]!;
  method.value = def.value.methods[0] as HealthReferenceInput["method"];
  context.value = def.value.contexts[0];
  fieldValues.value = {};
  notice.value = "";
});
function failure(e: any) {
  if (!active || e?.code === "ERR_CANCELED") return;
  error.value = props.errorMessage(e);
  if ([401, 403, 404].includes(e?.response?.status)) {
    rows.value = [];
    emit("denied", e);
  }
}
async function read(more = false) {
  reading.value = true;
  try {
    const page = await props.transport.references(
      props.memberId,
      more ? cursor.value : null,
      controller.signal,
    );
    if (!active) return;
    rows.value = more ? [...rows.value, ...page.items] : page.items;
    cursor.value = page.nextCursor;
  } catch (e) {
    failure(e);
  } finally {
    if (active) reading.value = false;
  }
}
async function save() {
  if (saving.value) return;
  error.value = "";
  notice.value = "";
  if (!measuredAt.value || !Number.isFinite(Date.parse(measuredAt.value))) {
    error.value = "请填写测量时间";
    return;
  }
  const input = {
    metric: metric.value,
    measuredAt: new Date(measuredAt.value).toISOString(),
    unit: unit.value,
    method: method.value,
    context: context.value,
    values: referenceFormValues(fieldValues.value),
  };
  const content = JSON.stringify(input);
  if (requestContent !== content) {
    requestContent = content;
    requestKey = crypto.randomUUID();
  }
  saving.value = true;
  try {
    await props.transport.saveReference(props.memberId, {
      ...input,
      requestKey,
    });
    if (!active) return;
    notice.value = "参考值已保存，趋势已更新。设备原始读数保持不变。";
    requestContent = "";
    requestKey = "";
    fieldValues.value = {};
    emit("saved");
    await read();
  } catch (e) {
    failure(e);
  } finally {
    if (active) saving.value = false;
  }
}
async function revoke() {
  if (saving.value || !voidId.value) return;
  saving.value = true;
  error.value = "";
  try {
    await props.transport.voidReference(
      props.memberId,
      voidId.value,
      voidReason.value,
    );
    if (!active) return;
    voidId.value = "";
    voidReason.value = "";
    notice.value = "已撤销，历史记录保留；该参考值不再参与当前趋势与新分析。";
    emit("saved");
    await read();
  } catch (e) {
    failure(e);
  } finally {
    if (active) saving.value = false;
  }
}
const date = (v: string) =>
  new Date(v).toLocaleString("zh-CN", { hour12: false });
onMounted(() => void read());
onBeforeUnmount(() => {
  active = false;
  controller.abort();
  rows.value = [];
});
</script>
<template>
  <div
    class="screen-modal reference-modal"
    @click.self="!saving && emit('close')"
  >
    <section role="dialog" aria-modal="true" aria-labelledby="reference-title">
      <button
        class="modal-close"
        aria-label="关闭校准窗口"
        :disabled="saving"
        @click="emit('close')"
      >
        <Close />
      </button>
      <h2 id="reference-title">校准 · 录入参考值</h2>
      <p>会员：
        <button type="button" class="profile-link" aria-haspopup="dialog" title="会员基本资料" :disabled="saving" @click="emit('edit-profile')">{{ memberName }}</button>
        <button type="button" class="profile-link" aria-haspopup="dialog" title="会员基本资料" :disabled="saving" @click="emit('edit-profile')">NO. {{ memberNo }}</button>
      </p>
      <p v-if="error" class="screen-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="reference-success" role="status">{{ notice }}</p>
      <form @submit.prevent="save">
        <p v-if="metric === 'URIC_ACID'" class="muted">
          填写血液尿酸测量值，请核对检验单的单位。
        </p>
        <div class="reference-fields">
          <label
            >测量指标<select v-model="metric" :disabled="saving">
              <option v-for="(d, key) in definitions" :key="key" :value="key">
                {{ d.label }}
              </option>
            </select></label
          >
          <label
            >参考来源<select v-model="method" :disabled="saving">
              <option v-for="m in def.methods" :key="m" :value="m">
                {{ methods[m] }}
              </option>
            </select></label
          >
          <label
            >测量时间<input
              v-model="measuredAt"
              type="datetime-local"
              :max="localNow()"
              :disabled="saving"
              required
            /><small>当前浏览器时区：{{ timeZone }}</small></label
          >
          <label
            >单位<select v-model="unit" :disabled="saving">
              <option v-for="u in def.units" :key="u">{{ u }}</option>
            </select></label
          >
          <label v-for="(label, key) in def.fields" :key="key">
            {{ label
            }}<span v-if="metric === 'BLOOD_LIPIDS'" class="muted"
              >未检测可留空</span
            >
            <input
              v-model="fieldValues[key]"
              type="number"
              inputmode="decimal"
              min="0.001"
              :max="metric === 'URIC_ACID' && unit === 'μmol/L' ? 10000 : 1000"
              step="any"
              :disabled="saving"
              :required="metric !== 'BLOOD_LIPIDS'"
              :aria-label="label"
            />
          </label>
          <label
            >测量情境<select v-model="context" :disabled="saving">
              <option v-for="c in def.contexts" :key="c" :value="c">
                {{ contexts[c] }}
              </option>
            </select></label
          >
        </div>
        <button class="primary-button" type="submit" :disabled="saving">
          {{ saving ? "正在保存…" : "确认保存参考值" }}
        </button>
      </form>
      <h3 class="reference-history-title">参考记录与撤销历史</h3>
      <p v-if="reading">正在读取…</p>
      <p v-else-if="!rows.length" class="muted">尚无手动参考记录</p>
      <div class="reference-history">
        <article
          v-for="r in rows"
          :key="r.id"
          :class="{ voided: !!r.voidedAt }"
        >
          <strong
            >{{
              definitions[r.metric as keyof typeof definitions]?.label ||
              r.metric
            }}
            ·
            <span v-for="(v, k) in r.values" :key="k" class="reference-value"
              >{{ referenceLabel(r.metric, k) }} {{ v }} {{ r.unit }}</span
            ></strong
          >
          <p>
            {{ date(r.measuredAt) }} · {{ methods[r.method] }} ·
            {{ contexts[r.context] }}
          </p>
          <small
            >录入于 {{ date(r.createdAt) }} ·
            {{ r.voidedAt ? "已撤销" : "手动参考" }}</small
          >
          <p v-if="r.voidedAt">
            撤销于 {{ date(r.voidedAt) }} · {{ r.voidReason }}
          </p>
          <button
            v-else-if="r.canVoid!==false"
            type="button"
            class="text-button"
            :disabled="saving"
            @click="
              voidId = r.id;
              voidReason = '';
            "
          >
            撤销此参考值
          </button>
          <form
            v-if="voidId === r.id"
            class="reference-revoke"
            @submit.prevent="revoke"
          >
            <label
              >撤销原因<input
                v-model="voidReason"
                minlength="5"
                maxlength="200"
                required
                :disabled="saving"
                placeholder="至少5个字"
            /></label>
            <div class="modal-actions">
              <button type="button" :disabled="saving" @click="voidId = ''">
                取消</button
              ><button type="submit" :disabled="saving">确认撤销</button>
            </div>
          </form>
        </article>
      </div>
      <button
        v-if="cursor"
        class="secondary-button"
        :disabled="reading"
        @click="read(true)"
      >
        加载更多参考记录
      </button>
    </section>
  </div>
</template>
<style scoped src="./health-screen.css"></style>
<style scoped>
.reference-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.reference-fields label,
.reference-revoke label {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.reference-fields input,
.reference-fields select,
.reference-revoke input {
  width: 100%;
  box-sizing: border-box;
  min-height: 44px;
  background: #082744;
  color: #e8f8ff;
  border: 1px solid #2a5877;
  border-radius: 8px;
  padding: 10px;
  font: inherit;
  color-scheme: dark;
}
.reference-fields small {
  color: #a8c4d8;
}
.reference-success {
  padding: 12px;
  background: #0a4c4b;
  border-radius: 8px;
  color: #72f2d3;
}
.reference-history-title {
  margin-top: 30px;
}
.reference-history article {
  padding: 16px 0;
  border-bottom: 1px solid #244963;
}
.reference-value {
  display: inline-block;
  margin: 4px 12px 4px 0;
}
.reference-history p {
  margin: 8px 0;
}
.reference-history small {
  color: #a8c4d8;
}
.reference-history .voided {
  opacity: 0.72;
}
.reference-revoke {
  padding: 12px;
  background: #0a2039;
  border-radius: 8px;
}
.reference-modal :deep(.modal-close svg) {
  width: 22px;
  height: 22px;
}
@media (max-width: 540px) {
  .reference-fields {
    grid-template-columns: 1fr;
  }
}
</style>
