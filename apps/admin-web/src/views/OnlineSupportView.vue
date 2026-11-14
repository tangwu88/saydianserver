<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRouter } from "vue-router";
import {
  adminSessionKey,
  api,
  clearAdminToken,
  getAdminRoles,
  readableError,
  responseData,
} from "../api";
import {
  consumeSupportEvents,
  mergeSupportMessages,
  type Conversation,
  type Queue,
  type SupportMessage,
  type Thread,
} from "../support-chat-stream";
import SupportPrivateImage from "../components/SupportPrivateImage.vue";

type Settings = {
  enabled: boolean;
  whatsappEnabled: boolean;
  whatsapp: string | null;
  faqCategories: { "zh-Hans": string | null; en: string | null };
  guideCategoryIds: string[];
};
type Diagnostic = {
  receivedAt: string;
  report: {
    platform: string;
    appVersion: string;
    buildNumber: number;
    model: string;
    sdk: string;
    firmware?: string;
    connectionKind?: string;
    phone?: {
      brand?: string;
      modelId?: string;
      modelName?: string;
      osVersion?: string;
      osBuild?: string;
      apiLevel?: number;
      locale?: string;
    };
    stages: { stage: string; state: string; elapsedMs: number; code: string }[];
  };
};
const router = useRouter();
const me = ref(""),
  queue = ref<Conversation[]>([]),
  nextQueue = ref<string | null>(null),
  filter = ref("waiting"),
  selected = ref(""),
  current = ref<Conversation | null>(null),
  messages = ref<SupportMessage[]>([]);
const older = ref(false),
  viewport = ref<HTMLElement>(),
  draft = ref(""),
  file = ref<File>(),
  pending = ref<{ id: string; body: string; file?: File } | null>(null),
  cursor = ref(0);
const error = ref(""),
  loading = ref(false),
  actionBusy = ref(false),
  settingsOpen = ref(false),
  transferOpen = ref(false),
  diagnosticsOpen = ref(false);
const settings = ref<Settings>(),
  categories = ref<{ id: string; locale: string; name: string }[]>([]),
  agents = ref<{ id: string; displayName: string }[]>([]),
  assignee = ref(""),
  diagnostics = ref<Diagnostic[]>([]);
const canConfigure = getAdminRoles().some(
  (r) => r === "SUPER_ADMIN" || r === "APP_OPERATIONS",
);
const canReply = computed(
  () =>
    current.value?.state === "human" &&
    current.value.assignedAdminId === me.value,
);
const stageStates: Record<string, string> = {
  ok: "成功",
  failed: "失败",
  pending: "等待",
  blocked: "受阻",
};
const states: Record<string, string> = {
  ai: "AI 接待",
  waiting: "待接入",
  human: "人工接待",
  closed: "已结束",
};
let queueAbort: AbortController | null = null,
  threadAbort: AbortController | null = null,
  disposed = false,
  stamp = 0;
const base = "/support-chat";
const threadPath = (id: string) => `${base}/conversations/${id}`;
const owner = adminSessionKey();
const valid = (version: number, id: string) =>
  !disposed &&
  owner === adminSessionKey() &&
  version === stamp &&
  id === selected.value;

async function events<T>(
  path: () => string,
  signal: AbortSignal,
  receive: (value: T) => void,
) {
  if (!owner) return;
  let wait = 350;
  while (!signal.aborted && !disposed && adminSessionKey() === owner) {
    try {
      const result = await consumeSupportEvents<T>(path(), {
        signal,
        session: owner,
        receive,
      });
      if (
        result === "expired" &&
        !signal.aborted &&
        adminSessionKey() === owner
      ) {
        clearAdminToken();
        void router.replace("/login");
        return;
      }
      wait = 350;
    } catch {
      wait = Math.min(wait * 2, 5000);
    }
    if (!signal.aborted) await new Promise((r) => setTimeout(r, wait));
  }
}
function startQueue() {
  queueAbort?.abort();
  queue.value = [];
  nextQueue.value = null;
  if (document.hidden) return;
  const control = new AbortController();
  queueAbort = control;
  const mode = filter.value;
  void events<Queue>(
    () => `/queues/events?filter=${mode}`,
    control.signal,
    (value) => {
      if (control.signal.aborted || mode !== filter.value) return;
      queue.value = value.items;
      nextQueue.value = value.next;
    },
  );
  void api
    .get(`${base}/queues`, { params: { filter: mode }, signal: control.signal })
    .then((response) => {
      if (control.signal.aborted || queue.value.length || mode !== filter.value)
        return;
      const data = responseData<Queue>(response);
      queue.value = data.items;
      nextQueue.value = data.next;
    })
    .catch((cause) => {
      if (!control.signal.aborted) error.value = readableError(cause);
    });
}
async function moreQueue() {
  const before = nextQueue.value,
    mode = filter.value,
    control = queueAbort;
  if (!before || !control) return;
  try {
    const data = responseData<Queue>(
      await api.get(`${base}/queues`, {
        params: { filter: mode, before },
        signal: control.signal,
      }),
    );
    if (!control.signal.aborted && filter.value === mode) {
      queue.value = [
        ...new Map(
          [...queue.value, ...data.items].map((row) => [row.id, row]),
        ).values(),
      ];
      nextQueue.value = data.next;
    }
  } catch (cause) {
    if (!control.signal.aborted) error.value = readableError(cause);
  }
}
async function markRead(id: string, seq: number) {
  if (seq < 1 || document.hidden || id !== selected.value) return;
  try {
    await api.post(`${threadPath(id)}/read`, { seq });
  } catch {
    /* A later update resumes from the last receipt. */
  }
}
function apply(data: Thread, track = true) {
  current.value = data.conversation;
  const old = cursor.value;
  messages.value = mergeSupportMessages(messages.value, data.messages);
  if (track && data.messages.length)
    cursor.value = Math.max(old, data.messages.at(-1)!.seq);
  if (cursor.value > old) {
    void markRead(data.conversation.id, cursor.value);
    void nextTick(() => {
      if (viewport.value)
        viewport.value.scrollTop = viewport.value.scrollHeight;
    });
  }
}
function startThread() {
  threadAbort?.abort();
  const id = selected.value,
    version = stamp;
  if (!id || document.hidden) return;
  const control = new AbortController();
  threadAbort = control;
  void events<Thread>(
    () => `/conversations/${id}/events?after=${cursor.value}`,
    control.signal,
    (data) => {
      if (valid(version, id) && !control.signal.aborted) apply(data);
    },
  );
}
async function open(id: string) {
  threadAbort?.abort();
  const version = ++stamp;
  selected.value = id;
  current.value = null;
  messages.value = [];
  cursor.value = 0;
  older.value = false;
  error.value = "";
  draft.value = "";
  file.value = undefined;
  pending.value = null;
  loading.value = true;
  actionBusy.value = false;
  diagnosticsOpen.value = false;
  transferOpen.value = false;
  try {
    const data = responseData<Thread>(await api.get(threadPath(id)));
    if (valid(version, id)) {
      older.value = data.older;
      apply(data);
      startThread();
    }
  } catch (cause) {
    if (valid(version, id)) error.value = readableError(cause);
  } finally {
    if (valid(version, id)) loading.value = false;
  }
}
async function previous() {
  const id = selected.value,
    version = stamp,
    before = messages.value[0]?.seq;
  if (!before) return;
  try {
    const result = responseData<Thread>(
      await api.get(threadPath(id), { params: { before } }),
    );
    if (valid(version, id)) {
      messages.value = mergeSupportMessages(messages.value, result.messages);
      older.value = result.older;
    }
  } catch (cause) {
    if (valid(version, id)) error.value = readableError(cause);
  }
}
async function send() {
  const id = selected.value,
    version = stamp;
  if (
    !canReply.value ||
    actionBusy.value ||
    (!pending.value && !draft.value.trim() && !file.value)
  )
    return;
  const item = pending.value ?? {
    id: crypto.randomUUID(),
    body: draft.value.trim(),
    ...(file.value ? { file: file.value } : {}),
  };
  pending.value = item;
  actionBusy.value = true;
  error.value = "";
  try {
    let saved: SupportMessage;
    if (item.file) {
      const form = new FormData();
      form.append("clientMessageId", item.id);
      form.append("body", item.body);
      form.append("file", item.file, "photo");
      saved = responseData(
        await api.post(`${threadPath(id)}/attachments`, form),
      );
    } else
      saved = responseData(
        await api.post(`${threadPath(id)}/messages`, {
          clientMessageId: item.id,
          body: item.body,
        }),
      );
    if (valid(version, id)) {
      messages.value = mergeSupportMessages(messages.value, [saved]);
      pending.value = null;
      draft.value = "";
      file.value = undefined;
    }
  } catch (cause) {
    if (valid(version, id)) error.value = readableError(cause);
  } finally {
    if (valid(version, id)) actionBusy.value = false;
  }
}
function imageSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const chosen = input.files?.[0];
  input.value = "";
  if (
    chosen &&
    ["image/jpeg", "image/png", "image/webp"].includes(chosen.type) &&
    chosen.size <= 5 * 1024 * 1024
  )
    file.value = chosen;
  else if (chosen) error.value = "请选择 5 MB 以内的 JPG、PNG 或 WebP 照片";
}
async function transition(action: string, agent?: string | null) {
  const id = selected.value,
    version = stamp;
  if (actionBusy.value) return;
  actionBusy.value = true;
  error.value = "";
  try {
    const result = responseData<Conversation>(
      await api.post(`${threadPath(id)}/transition`, {
        action,
        ...(agent !== undefined ? { assignee: agent } : {}),
      }),
    );
    if (valid(version, id)) {
      current.value = result;
      transferOpen.value = false;
      if (action === "accept") {
        filter.value = "mine";
        void markRead(id, cursor.value);
      }
    }
  } catch (cause) {
    if (valid(version, id)) error.value = readableError(cause);
  } finally {
    if (valid(version, id)) actionBusy.value = false;
  }
}
async function showTransfer() {
  const id = selected.value,
    version = stamp;
  try {
    const result = responseData<typeof agents.value>(
      await api.get(`${base}/agents`),
    );
    if (valid(version, id)) {
      agents.value = result.filter((a) => a.id !== me.value);
      assignee.value = "";
      transferOpen.value = true;
    }
  } catch (cause) {
    if (valid(version, id)) error.value = readableError(cause);
  }
}
async function showDiagnostics() {
  const id = selected.value,
    version = stamp;
  try {
    const result = responseData<{ reports: Diagnostic[] }>(
      await api.get(`${threadPath(id)}/diagnostics`),
    );
    if (valid(version, id)) {
      diagnostics.value = result.reports;
      diagnosticsOpen.value = true;
    }
  } catch (cause) {
    if (valid(version, id)) error.value = readableError(cause);
  }
}
async function showSettings() {
  if (!canConfigure) return;
  try {
    const data = responseData<{
      config: Settings;
      categories: typeof categories.value;
    }>(await api.get(`${base}/config`));
    if (!disposed && adminSessionKey() === owner) {
      settings.value = data.config;
      categories.value = data.categories;
      settingsOpen.value = true;
    }
  } catch (cause) {
    if (!disposed) error.value = readableError(cause);
  }
}
async function saveSettings() {
  if (!settings.value || actionBusy.value) return;
  actionBusy.value = true;
  try {
    settings.value = responseData(
      await api.put(`${base}/config`, settings.value),
    );
    settingsOpen.value = false;
    error.value = "";
  } catch (cause) {
    error.value = readableError(cause);
  } finally {
    actionBusy.value = false;
  }
}
function onVisibility() {
  if (document.hidden) {
    queueAbort?.abort();
    threadAbort?.abort();
  } else {
    startQueue();
    startThread();
    if (selected.value) void markRead(selected.value, cursor.value);
  }
}
function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
onMounted(() => {
  document.addEventListener("visibilitychange", onVisibility);
  void api
    .get("/auth/me")
    .then((r) => {
      if (!disposed) me.value = responseData<{ id: string }>(r).id;
    })
    .catch(() => {});
  startQueue();
});
watch(filter, startQueue);
onBeforeUnmount(() => {
  disposed = true;
  queueAbort?.abort();
  threadAbort?.abort();
  document.removeEventListener("visibilitychange", onVisibility);
});
</script>

<template>
  <main class="support-workspace">
    <header class="page-head">
      <div>
        <h1>Say Ring 在线客服</h1>
        <p>接待 App 用户与访客，查看会话并及时回复。</p>
      </div>
      <el-button v-if="canConfigure" @click="showSettings"
        >客服与常见问题设置</el-button
      >
    </header>
    <el-alert v-if="error" :title="error" type="error" @close="error = ''" />
    <div class="support-columns">
      <aside class="queue">
        <el-select v-model="filter" aria-label="会话分类" style="width: 100%"
          ><el-option value="waiting" label="待接待" /><el-option
            value="mine"
            label="我的接待" /><el-option
            value="ai"
            label="AI 接待中" /><el-option value="closed" label="已结束"
        /></el-select>
        <el-empty
          v-if="!queue.length"
          description="这里暂时没有会话"
          :image-size="58"
        />
        <button
          v-for="row in queue"
          :key="row.id"
          class="queue-row"
          :class="{ selected: row.id === selected }"
          @click="open(row.id)"
        >
          <span
            >{{ row.guest ? "访客" : "会员" }} · {{ row.id.slice(0, 8) }}</span
          ><el-tag v-if="row.unread" size="small" type="danger">未读</el-tag
          ><small
            >{{ formatTime(row.updatedAt) }} ·
            {{ row.locale === "en" ? "英文" : "简体中文" }}</small
          >
        </button>
        <el-button v-if="nextQueue" text @click="moreQueue">查看更多</el-button>
      </aside>
      <section class="conversation" v-loading="loading">
        <el-empty v-if="!current" description="选择一条会话开始接待" />
        <template v-else>
          <header class="thread-head">
            <div>
              <strong
                >{{ current.guest ? "访客" : "会员" }} ·
                {{ current.id.slice(0, 8) }}</strong
              >
              <el-tag size="small" effect="plain">{{
                states[current.state]
              }}</el-tag>
            </div>
            <div class="actions">
              <el-button size="small" text @click="showDiagnostics"
                >手机与连接信息</el-button
              ><el-button
                v-if="current.state === 'waiting' || current.state === 'ai'"
                size="small"
                type="primary"
                :loading="actionBusy"
                @click="transition('accept')"
                >接入</el-button
              ><template v-if="canReply"
                ><el-button size="small" @click="showTransfer">转接</el-button
                ><el-button size="small" @click="transition('close')"
                  >结束</el-button
                ></template
              >
            </div>
          </header>
          <div ref="viewport" class="messages" aria-label="会话消息">
            <el-button v-if="older" text @click="previous"
              >加载更早消息</el-button
            >
            <article
              v-for="msg in messages"
              :key="msg.id"
              class="message"
              :class="{ staff: msg.sender === 'staff' }"
            >
              <small
                >{{
                  msg.sender === "ai"
                    ? "AI 客服"
                    : msg.sender === "staff"
                      ? "人工客服"
                      : "用户"
                }}
                · {{ formatTime(msg.createdAt) }}</small
              >
              <p v-if="msg.body">{{ msg.body }}</p>
              <SupportPrivateImage
                v-if="msg.attachment"
                :key="msg.attachment.id"
                :conversation-id="current.id"
                :attachment-id="msg.attachment.id"
              />
            </article>
          </div>
          <form v-if="canReply" class="composer" @submit.prevent="send">
            <el-input
              v-model="draft"
              type="textarea"
              :rows="3"
              maxlength="2000"
              :disabled="!!pending"
              placeholder="输入回复"
            />
            <div class="actions">
              <label class="photo"
                >添加照片<input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  :disabled="!!pending"
                  @change="imageSelected" /></label
              ><span v-if="file"
                >已选照片
                <el-button
                  v-if="!pending"
                  text
                  size="small"
                  @click="file = undefined"
                  >移除</el-button
                ></span
              ><el-button
                v-if="pending && !actionBusy"
                text
                @click="pending = null"
                >编辑</el-button
              ><el-button
                native-type="submit"
                type="primary"
                :loading="actionBusy"
                >{{ pending ? "重试发送" : "发送" }}</el-button
              >
            </div>
          </form>
        </template>
      </section>
    </div>
    <el-dialog v-model="transferOpen" title="转接会话" width="min(480px,95vw)">
      <el-select v-model="assignee" placeholder="退回待接待" style="width: 100%"
        ><el-option value="" label="退回待接待" /><el-option
          v-for="agent in agents"
          :key="agent.id"
          :value="agent.id"
          :label="agent.displayName" /></el-select
      ><template #footer
        ><el-button @click="transferOpen = false">取消</el-button
        ><el-button
          type="primary"
          @click="transition('transfer', assignee || null)"
          >确认转接</el-button
        ></template
      >
    </el-dialog>
    <el-dialog
      v-model="diagnosticsOpen"
      title="手机与连接信息"
      width="min(650px,95vw)"
    >
      <el-empty
        v-if="!diagnostics.length"
        description="暂无连接摘要"
        :image-size="64"
      />
      <el-card
        v-for="row in diagnostics"
        :key="row.receivedAt"
        shadow="never"
        class="diag"
        ><template #header
          >{{ formatTime(row.receivedAt) }} · {{ row.report.model }}</template
        >
        <p>
          {{
            [
              row.report.phone?.brand,
              row.report.phone?.modelName,
              row.report.phone?.modelId,
            ]
              .filter(Boolean)
              .join(" · ") || "手机型号未提供"
          }}
        </p>
        <p>
          {{ row.report.platform }} {{ row.report.phone?.osVersion }}
          {{ row.report.phone?.osBuild }} · App {{ row.report.appVersion }}（{{
            row.report.buildNumber
          }}）
        </p>
        <p>{{ row.report.sdk }} · 固件 {{ row.report.firmware || "未提供" }}</p>
        <p
          v-for="stage in row.report.stages.filter(
            (s) => s.stage === 'connect',
          )"
          :key="stage.elapsedMs"
        >
          {{
            row.report.connectionKind === "automatic_recovery"
              ? "自动恢复"
              : "连接"
          }}
          · {{ stageStates[stage.state] || stage.state }} ·
          {{ (stage.elapsedMs / 1000).toFixed(1) }} 秒
          <span v-if="stage.code !== 'none'"> · {{ stage.code }}</span>
        </p></el-card
      >
    </el-dialog>
    <el-dialog
      v-model="settingsOpen"
      title="Say Ring 客服与常见问题"
      width="min(600px,95vw)"
    >
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-form v-if="settings" label-position="top"
        ><el-form-item label="启用在线客服"
          ><el-switch v-model="settings.enabled" /></el-form-item
        ><el-form-item label="向英文用户显示 WhatsApp"
          ><el-switch v-model="settings.whatsappEnabled" /></el-form-item
        ><el-form-item label="官方 WhatsApp 号码或链接"
          ><el-input
            :model-value="settings.whatsapp || ''"
            placeholder="含区号的号码或 https://wa.me/ 链接"
            @update:model-value="settings.whatsapp = $event || null"
        /></el-form-item>
        <el-form-item label="简体中文常见问题分类"
          ><el-select
            v-model="settings.faqCategories['zh-Hans']"
            clearable
            :empty-values="[null, undefined, '']"
            :value-on-clear="null"
            style="width: 100%"
            ><el-option
              v-for="row in categories.filter((c) => c.locale === 'zh-Hans')"
              :key="row.id"
              :label="row.name"
              :value="row.id" /></el-select
        ></el-form-item>
        <el-form-item label="英文常见问题分类"
          ><el-select
            v-model="settings.faqCategories.en"
            clearable
            :empty-values="[null, undefined, '']"
            :value-on-clear="null"
            style="width: 100%"
            ><el-option
              v-for="row in categories.filter((c) => c.locale === 'en')"
              :key="row.id"
              :label="row.name"
              :value="row.id" /></el-select
        ></el-form-item>
        <el-form-item label="可供 AI 引用的设备说明分类"
          ><el-select
            v-model="settings.guideCategoryIds"
            multiple
            :multiple-limit="8"
            style="width: 100%"
            ><el-option
              v-for="row in categories"
              :key="row.id"
              :label="`${row.name} · ${row.locale}`"
              :value="row.id" /></el-select
        ></el-form-item> </el-form
      ><template #footer
        ><el-button @click="settingsOpen = false">取消</el-button
        ><el-button type="primary" :loading="actionBusy" @click="saveSettings"
          >保存</el-button
        ></template
      >
    </el-dialog>
  </main>
</template>

<style scoped>
.support-workspace {
  padding: clamp(12px, 3vw, 32px);
  color: #203048;
}
.page-head,
.thread-head,
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.page-head h1 {
  margin: 0;
  font-size: 24px;
}
.page-head p {
  color: #5c6574;
}
.support-columns {
  display: grid;
  grid-template-columns: minmax(210px, 280px) minmax(0, 1fr);
  gap: 16px;
  margin-top: 16px;
}
.queue,
.conversation {
  border: 1px solid #dfe5ef;
  border-radius: 14px;
  background: #fff;
  min-width: 0;
}
.queue {
  padding: 12px;
}
.queue-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 6px;
  text-align: left;
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #203048;
  cursor: pointer;
}
.queue-row:hover,
.queue-row.selected {
  background: #eaf4f7;
}
.queue-row small {
  grid-column: 1/-1;
  color: #5c6574;
}
.thread-head,
.composer {
  padding: 12px;
  border-bottom: 1px solid #dfe5ef;
}
.messages {
  height: clamp(230px, 55vh, 640px);
  overflow: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.message {
  align-self: flex-start;
  background: #eff4f8;
  padding: 10px 14px;
  border-radius: 12px;
  max-width: 85%;
  overflow-wrap: anywhere;
}
.message.staff {
  align-self: flex-end;
  background: #e7f2ed;
}
.message small {
  color: #506077;
}
.message p {
  white-space: pre-wrap;
  margin: 6px 0;
}
.composer .actions {
  justify-content: flex-end;
  margin-top: 9px;
}
.photo {
  cursor: pointer;
  border: 1px solid #cbd5e1;
  padding: 5px 10px;
  border-radius: 6px;
}
.photo:focus-within {
  outline: 2px solid #2f69af;
}
.photo input {
  width: 1px;
  height: 1px;
  position: absolute;
  opacity: 0;
}
.diag {
  margin-bottom: 10px;
  overflow-wrap: anywhere;
}
@media (max-width: 800px) {
  .support-columns {
    grid-template-columns: 1fr;
  }
  .queue {
    max-height: 255px;
    overflow: auto;
  }
}
</style>
