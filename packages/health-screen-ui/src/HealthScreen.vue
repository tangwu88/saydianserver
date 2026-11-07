<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  Back,
  FullScreen,
  Refresh,
  View,
  Hide,
  User,
  DataAnalysis,
  Moon,
  FirstAidKit,
  Odometer,
  TrendCharts,
  Warning,
  CircleCheck,
  Document,
  Aim,
  Close,
  Loading,
  Edit,
  VideoPause,
  VideoPlay,
} from "@element-plus/icons-vue";
import type {
  HealthScreenDays,
  HealthScreenResponse,
  HealthScreenTransport,
  HealthScreenGroup,
  HealthScreenRecord,
} from "@saydian/app-contracts";
import HealthReferenceDialog from "./HealthReferenceDialog.vue";
import HealthScreenProfileDialog from "./HealthScreenProfileDialog.vue";
import {
  MeasurementObserver,
  MEASUREMENT_POLL_MS,
  MEASUREMENT_NOTICE_MS,
} from "./updates";
import { visibleExclusions, visibleRecordReason } from "./quality-display";
import HealthTrend from "./HealthTrend.vue";
import HealthTrendGroup from "./HealthTrendGroup.vue";
import { groupTrends } from "./trend-groups";
import {selectBodyProfile} from "./body-profile";
import {
  formatScreenValue as num,
  sleepRecordInHours,
  sleepSeriesInHours,
  sleepValueInHours,
} from "./sleep-display";
const emit=defineEmits<{"access-lost":[]}>();
const props = defineProps<{
  memberId: string;
  transport: HealthScreenTransport;
  backUrl: string;
  backLabel?: string;
  errorMessage: (error: unknown) => string;
  sessionKey: () => string | null;
  requiresRecordReason?: boolean;
}>();
const days = ref<HealthScreenDays>(7),
  screen = ref<HealthScreenResponse | null>(null),
  error = ref(""),
  loading = ref(false),
  generating = ref(false),
  masked = ref(false),
  fullscreen = ref(false),
  group = ref<HealthScreenGroup>("cardiovascular"),
  tab = ref<"detail" | "trends" | "references" | "records">("trends"),
  trendScope = ref<"all" | "selected">("all"),
  expandedTrends = ref(false),
  basisOpen = ref(false),
  confirmOpen = ref(false),
  referenceOpen = ref(false),
  profileOpen = ref(false),
  motion = ref(true),
  visible = ref(!document.hidden);
const arrivals = ref<Record<string, { id: number; message: string; until: number }>>({});
let arrivalSequence = 0;
let updateTimer: ReturnType<typeof setInterval> | undefined;
const measurements = new MeasurementObserver((signal) =>
  props.transport.updates(props.memberId, days.value, signal),
);
const rows = ref<HealthScreenRecord[]>([]),
  recordError = ref(""),
  recordLoading = ref(false),
  cursor = ref<string | null>(null),
  recordReason = ref(""),
  recordMetric = ref(""),
  chartKey = ref("");
const page = ref<HTMLElement | null>(null);
let epoch = 0,
  controller: AbortController | null = null,
  recordsController: AbortController | null = null,
  timer: ReturnType<typeof setInterval> | undefined,
  poll: ReturnType<typeof setInterval> | undefined;
let identity: string | null = null,
  requestKey = "",
  requestDigest = "";
const groups = [
  { key: "sleep", label: "睡眠与恢复", short: "睡眠", icon: Moon },
  {
    key: "cardiovascular",
    label: "心率与血压",
    short: "心血管指标",
    icon: FirstAidKit,
  },
  { key: "temperature", label: "皮温与温度", short: "温度", icon: Odometer },
  { key: "oxygen", label: "呼吸血氧", short: "血氧", icon: Aim },
  {
    key: "metabolic",
    label: "代谢指标",
    short: "血糖与代谢",
    icon: DataAnalysis,
  },
  { key: "activity", label: "活动运动", short: "活动", icon: TrendCharts },
] as const;
const chosen = computed(() => groups.find((g) => g.key === group.value)!);
const metricOrder = [
  "heart_rate",
  "systolic",
  "diastolic",
  "hrv_rmssd",
  "hrv_sdnn",
];
const displaySeries = computed(() =>
  (screen.value?.series || []).map(sleepSeriesInHours),
);
const displayRows = computed(() => rows.value.map(sleepRecordInHours));
const arrivalItems = computed(() =>
  groups.flatMap((g) => arrivals.value[g.key] ? [{ ...g, ...arrivals.value[g.key]! }] : []),
);
const sourceExclusions = computed(() =>
  series.value.map((s) => ({ ...s, exclusions: visibleExclusions(s.exclusions) }))
    .filter((s) => Object.keys(s.exclusions).length),
);
const series = computed(() =>
  displaySeries.value.filter((s) => s.group === group.value).sort(
    (a, b) => {
      const rank = (key: string) =>
        metricOrder.includes(key) ? metricOrder.indexOf(key) : 100;
      return rank(a.key) - rank(b.key);
    },
  ),
);
const focusSeries = computed(
  () => series.value.find((s) => s.key === chartKey.value) || series.value[0],
);
const trendGroups = computed(() =>
  groupTrends(
    trendScope.value === "all" ? displaySeries.value : series.value,
  ),
);
const visibleTrends = computed(() =>
  expandedTrends.value ? trendGroups.value : trendGroups.value.slice(0, 3),
);
const referenceSeries = computed(() =>
  (screen.value?.series || [])
    .filter((s) => s.kind === "reference")
    .sort((a, b) => (b.latestAt || "").localeCompare(a.latestAt || "")),
);
const summaryMetrics = computed(() =>
  ["BLOOD_PRESSURE", "HEART_RATE", "BLOOD_GLUCOSE", "URIC_ACID"].map(
    (metric) => {
      const all = (
        screen.value?.series.filter((s) => s.metric === metric) || []
      ).sort((a, b) => (b.latestAt || "").localeCompare(a.latestAt || ""));
      const s =
        metric === "BLOOD_PRESSURE"
          ? all.find(
              (s) => s.kind === "reference" && s.label.startsWith("收缩压"),
            ) || all.find((s) => s.label.startsWith("收缩压"))
          : all.find((s) => s.kind === "reference") || all[0];
      const label = {
        BLOOD_PRESSURE: "血压",
        HEART_RATE: "心率",
        BLOOD_GLUCOSE: "血糖",
        URIC_ACID: "尿酸",
      }[metric];
      if (!s) return { metric, label, value: "—", unit: "", note: "暂无记录" };
      const value = s.kind === "reference" ? s.latest : s.average;
      const other =
        metric === "BLOOD_PRESSURE"
          ? all.find(
              (x) =>
                x.key === s.key.replace("systolic", "diastolic") &&
                (s.kind !== "reference" || x.latestAt === s.latestAt),
            )
          : null;
      return {
        metric,
        label,
        value: `${num(value)}${other && s !== other ? "/" + num(s.kind === "reference" ? other.latest : other.average) : ""}`,
        unit: s.unit,
        note:
          s.kind === "reference"
            ? `${s.label.split(" · ")[2] || "最近"}参考值`
            : "周期均值",
      };
    },
  ),
);
const hotspotNotes = computed(() => Object.fromEntries(groups.map(({ key }) => {
  const related = screen.value?.series.filter((s) => s.group === key) || [];
  const refs = related.filter((s) => s.kind === "reference").length;
  return [key, refs ? `手动参考 ${refs} 项` : ""];
})));
const figure = computed(()=>screen.value ? selectBodyProfile(screen.value.member) : null);
const markerPosition = computed(()=>figure.value?.anchors[group.value] || [50,50]);
const guideLines = computed(()=>groups.map(g=>{
  const [x,y]=figure.value?.anchors[g.key] || [50,50];
  const row = {sleep:[280,130],cardiovascular:[280,360],temperature:[280,610],oxygen:[720,250],metabolic:[720,520],activity:[720,820]}[g.key];
  const color = g.key==="cardiovascular"?"#ff789b":["temperature","activity"].includes(g.key)?"#32e8c3":"#26d5f7";
  return {key:g.key,x:x*10,y:y*10,color,points:row.join(",")+" "+((row[0]!+x*10)/2)+","+row[1]+" "+(x*10)+","+(y*10)};
}));
async function selectGroup(key: HealthScreenGroup) {
  group.value = key;
  trendScope.value = "selected";
  expandedTrends.value = false;
  if (tab.value === "references") tab.value = "trends";
  if (window.innerWidth <= 1050) {
    await nextTick();
    page.value?.querySelector(".right-stack")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  }
}
function evidenceLabel(keys: string[]) {
  return keys
    .map((k) => screen.value?.series.find((s) => s.key === k)?.label || k)
    .join("、");
}
function showEvidence(keys: string[]) {
  const metric = screen.value?.series.find((s) => keys.includes(s.key));
  if (metric) {
    tab.value = "trends";
    void selectGroup(metric.group);
  }
}

const recordSeries = computed(() =>
  series.value.filter((s) => s.kind !== "reference"),
);
const selectedMetric = computed(
  () => recordMetric.value || recordSeries.value[0]?.metric || "",
);
const recordOptions = computed(() => [
  ...new Set(recordSeries.value.map((s) => s.metric)),
]);
const shownName = computed(() => {
  const name = screen.value?.member.nickname || "会员";
  return masked.value ? name.slice(0, 1) + "**" : name;
});
const busyAnalysis = computed(() =>
  ["QUEUED", "GENERATING"].includes(screen.value?.analysis?.status || ""),
);
const score = computed(() => screen.value?.score.total ?? null);
const groupCoverage = (key: string) =>
  screen.value?.series
    .filter((s) => s.group === key)
    .reduce((n, s) => Math.max(n, s.coverageDays), 0) || 0;
const insights = computed(
  () =>
    screen.value?.analysis?.content?.insights.filter((i) =>
      series.value.some((s) => s.key === i.key),
    ) || [],
);
const sourceLabels: Record<string, string> = {
  watch_history: "设备历史",
  app_measurement: "App 测量",
  remote_member: "关爱测量",
  manual_entry: "手动记录",
  imported: "导入记录",
};
const sourceLabel = (key: string) => sourceLabels[key] || "来源未提供";
function scoreValue(key: string, value: number | null) {
  const s = screen.value?.series.find((s) => s.key === key);
  if (!s || s.metric !== "SLEEP") return num(value);
  const display = sleepValueInHours(s.metric, s.unit, value);
  return `${num(display.value)} ${display.unit}`;
}
const date = (v: string | null | undefined) =>
  v
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: screen.value?.period.timezone || "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(v))
    : "暂无记录";
function owned(n: number) {
  return n === epoch && identity === props.sessionKey();
}
async function load(reset = false) {
  if (reset || identity !== props.sessionKey()) {
    epoch++;
    identity = props.sessionKey();
    screen.value = null;
    rows.value = [];
    cursor.value = null;
    requestKey = "";
    requestDigest = "";
    recordsController?.abort();
    confirmOpen.value = false;
    referenceOpen.value = false;
    profileOpen.value = false;
    measurements.reset();
    arrivals.value = {};
  }
  const n = epoch;
  controller?.abort();
  const request = new AbortController();
  controller = request;
  loading.value = true;
  error.value = "";
  try {
    // Establish the upload baseline before loading charts, so an upload during
    // the initial read still produces a notice even if its values are already visible.
    const firstRead = await measurements.initialize(request.signal);
    if (!owned(n) || controller !== request || request.signal.aborted) return;
    const next = await props.transport.load(
      props.memberId,
      days.value,
      request.signal,
    );
    if (!owned(n) || controller !== request || request.signal.aborted) return;
    screen.value = next;
    if (firstRead) void checkUpdates();
  } catch (e: any) {
    if (!owned(n) || controller !== request || request.signal.aborted || e?.name === "AbortError" || e?.code === "ERR_CANCELED")
      return;
    error.value = props.errorMessage(e);
    if ([401, 403, 404, 428].includes(e?.response?.status)) {
      emit("access-lost");
      screen.value = null;
      rows.value = [];
      arrivals.value = {};
      measurements.reset();
    }
  } finally {
    if (owned(n) && controller === request) loading.value = false;
  }
}
async function checkUpdates() {
  if (!screen.value || document.hidden) return;
  const n = epoch;
  try {
    const changes = await measurements.check();
    if (!owned(n)) return;
    if (changes.length) {
      for (const item of changes)
        arrivals.value[item.group] = {
          id: ++arrivalSequence,
          message: item.message,
          until: Date.now() + MEASUREMENT_NOTICE_MS,
        };
      // A normal refresh may already contain these values. The upload notice
      // must still appear; it does not depend on a changed aggregate digest.
      await load();
      if (owned(n) && screen.value && tab.value === "records" && rows.value.length &&
          (!props.requiresRecordReason || recordReason.value.trim().length >= 5))
        await loadRecords();
    }
  } catch (e: any) {
    if (owned(n) && [401, 403, 404, 428].includes(e?.response?.status))
      denyReference(e);
  }
}
function denyReference(e: unknown) {
  if ([401,403,404,428].includes((e as any)?.response?.status)) emit("access-lost");
  referenceOpen.value = false;
  screen.value = null;
  rows.value = [];
  arrivals.value = {};
  measurements.reset();
  error.value = props.errorMessage(e);
}
async function pollAnalysis() {
  const s = screen.value;
  if (!s?.analysis || !busyAnalysis.value || document.hidden) return;
  const n = epoch,
    id = s.analysis.id;
  try {
    const result = await props.transport.result(
      props.memberId,
      id,
      controller?.signal || new AbortController().signal,
    );
    if (!owned(n) || screen.value?.analysis?.id !== id) return;
    screen.value.analysis = result;
    if (result.status === "READY" || result.status === "FAILED") void load();
  } catch (e: any) {
    if (owned(n) && [401, 403, 404, 428].includes(e?.response?.status)) {
      screen.value = null;
      rows.value = [];
      error.value = props.errorMessage(e);
    }
  }
}
async function generate() {
  confirmOpen.value = false;
  if (!screen.value || generating.value) return;
  const n = epoch,
    s = screen.value;
  generating.value = true;
  error.value = "";
  if (requestDigest !== s.dataDigest) {
    requestDigest = s.dataDigest;
    requestKey = crypto.randomUUID();
  }
  try {
    const result = await props.transport.generate(
      props.memberId,
      days.value,
      s.dataDigest,
      requestKey,
    );
    if (!owned(n) || !screen.value) return;
    screen.value.analysis = result;
    screen.value.analysisStale = false;
    requestKey = "";
    requestDigest = "";
  } catch (e) {
    if (owned(n)) error.value = props.errorMessage(e);
  } finally {
    if (owned(n)) generating.value = false;
  }
}
async function loadRecords(more = false) {
  if (!selectedMetric.value) return;
  if (props.requiresRecordReason && recordReason.value.trim().length < 5) {
    recordError.value = "请填写至少5个字的查看原因";
    return;
  }
  recordsController?.abort();
  recordsController = new AbortController();
  const n = epoch,
    currentGroup = group.value,
    metric = selectedMetric.value;
  recordLoading.value = true;
  recordError.value = "";
  if (!more) {
    rows.value = [];
    cursor.value = null;
  }
  try {
    const data = await props.transport.records(
      props.memberId,
      days.value,
      metric,
      more ? cursor.value : null,
      recordsController.signal,
      recordReason.value,
    );
    if (
      !owned(n) ||
      currentGroup !== group.value ||
      metric !== selectedMetric.value
    )
      return;
    rows.value = more ? [...rows.value, ...data.items] : data.items;
    cursor.value = data.nextCursor;
  } catch (e: any) {
    if (owned(n) && e?.code !== "ERR_CANCELED") {
      recordError.value = props.errorMessage(e);
      if ([401, 403, 404, 428].includes(e?.response?.status)) {
      emit("access-lost");
        rows.value = [];
        screen.value = null;
      }
    }
  } finally {
    if (owned(n)) recordLoading.value = false;
  }
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await page.value?.requestFullscreen();
  } catch {
    error.value = "浏览器未允许全屏，请使用浏览器的全屏功能";
  }
}
function visibility() {
  visible.value = !document.hidden;
  if (!document.hidden) {
    void checkUpdates();
    void load();
    void pollAnalysis();
  }
}
function fullChange() {
  fullscreen.value = !!document.fullscreenElement;
}
watch(
  () => [props.memberId, days.value],
  () => {
    generating.value = false;
    basisOpen.value = false;
    confirmOpen.value = false;
    tab.value = "trends";
    trendScope.value = "all";
    expandedTrends.value = false;
    void load(true);
  },
  { immediate: true },
);
watch(group, () => {
  chartKey.value = "";
  recordMetric.value = "";
  rows.value = [];
  cursor.value = null;
  recordError.value = "";
  recordsController?.abort();
  if (tab.value === "records" && !props.requiresRecordReason)
    void loadRecords();
});
watch(tab, (value) => {
  if (value === "records" && !props.requiresRecordReason) void loadRecords();
});
let returnFocus: HTMLElement | null = null;
const modalVisible = computed(
  () => basisOpen.value || confirmOpen.value || referenceOpen.value,
);
watch(modalVisible, async (open) => {
  if (open) {
    returnFocus = document.activeElement as HTMLElement;
    await nextTick();
    page.value?.querySelector<HTMLElement>(".screen-modal button")?.focus();
  } else {
    returnFocus?.focus();
    returnFocus = null;
  }
});
function modalKey(event: KeyboardEvent) {
  if (profileOpen.value || !modalVisible.value) return;
  if (event.key === "Escape") {
    basisOpen.value = false;
    confirmOpen.value = false;
    referenceOpen.value = false;
    event.preventDefault();
    return;
  }
  if (event.key === "Tab") {
    const nodes = Array.from(
      page.value?.querySelectorAll<HTMLElement>(
        ".screen-modal button:not(:disabled), .screen-modal a[href], .screen-modal input:not(:disabled), .screen-modal select:not(:disabled)",
      ) || [],
    );
    const first = nodes[0],
      last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      last?.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first?.focus();
      event.preventDefault();
    }
  }
}
onMounted(() => {
  timer = setInterval(() => {
    if (!document.hidden) void load();
  }, 60000);
  poll = setInterval(() => void pollAnalysis(), 5000);
  updateTimer = setInterval(() => {
    for (const [key, item] of Object.entries(arrivals.value))
      if (item.until < Date.now()) delete arrivals.value[key];
    void checkUpdates();
  }, MEASUREMENT_POLL_MS);
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("fullscreenchange", fullChange);
});
onBeforeUnmount(() => {
  epoch++;
  controller?.abort();
  recordsController?.abort();
  clearInterval(timer);
  clearInterval(poll);
  clearInterval(updateTimer);
  measurements.reset();
  document.removeEventListener("visibilitychange", visibility);
  document.removeEventListener("fullscreenchange", fullChange);
  screen.value = null;
  rows.value = [];
});
</script>
<template>
  <main
    ref="page"
    class="health-screen"
    :class="{ 'motion-paused': !motion || !visible }"
    @keydown="modalKey"
  >
    <header class="screen-top">
      <a :href="backUrl" class="screen-brand" :aria-label="backLabel || '返回会员列表'"
        ><DataAnalysis /><span
          >赛电 · <b>AI 健康趋势分析</b
          ><small>PERSONAL HEALTH INSIGHTS</small></span
        ></a
      >
      <div v-if="screen" class="member-strip">
        <User /><button type="button" class="profile-link" aria-haspopup="dialog" title="会员基本资料" @click="profileOpen=true"><strong>{{ shownName }}</strong></button>
        <button type="button" class="profile-link member-number" aria-haspopup="dialog" title="会员基本资料" @click="profileOpen=true">NO. {{ screen.member.memberNo }}</button>
        <span
          >{{
            screen.member.gender === "MALE"
              ? "男"
              : screen.member.gender === "FEMALE"
                ? "女"
                : "性别未填写"
          }}<template v-if="screen.member.age !== null">
            · {{ screen.member.age }}岁 · {{ screen.member.weightKg }} kg</template
          ></span
        ><i></i><span>近{{ days }}天 · {{ screen.recordCount }}条记录</span>
      </div>
      <div class="screen-tools"><slot name="session" :availability="screen?.availability" />
        <button
          v-if="screen"
          class="calibrate-button"
          @click="referenceOpen = true"
        >
          <Edit />校准
        </button>
        <button
          :aria-label="motion ? '暂停示意动画' : '开启动画'"
          :title="motion ? '暂停示意动画' : '开启动画'"
          @click="motion = !motion"
        >
          <VideoPause v-if="motion" /><VideoPlay v-else />
        </button>
        <select v-model="days" aria-label="分析周期">
          <option :value="7">近7天</option>
          <option :value="30">近30天</option>
          <option :value="90">近90天</option></select
        ><button
          :aria-label="masked ? '显示姓名' : '隐藏姓名'"
          :title="masked ? '显示姓名' : '姓名脱敏'"
          @click="masked = !masked"
        >
          <View v-if="masked" /><Hide v-else /></button
        ><button
          aria-label="刷新数据"
          title="刷新数据"
          :disabled="loading"
          @click="load()"
        >
          <Refresh :class="{ spinning: loading }" /></button
        ><button
          :aria-label="fullscreen ? '退出全屏' : '全屏展示'"
          title="全屏展示"
          @click="toggleFullscreen"
        >
          <FullScreen /></button
        ><a :href="backUrl" :title="backLabel || '返回会员列表'" :aria-label="backLabel || '返回会员列表'"
          ><Back
        /></a>
      </div>
    </header>
    <div v-if="error" class="screen-error" role="alert">
      {{ error }} <button @click="load()">重试</button>
    </div>
    <div v-if="!screen" class="screen-state">
      <Loading v-if="loading" class="spinning" /><Warning v-else />
      <h2>{{ loading ? "正在读取会员健康资料" : "暂时无法展示健康大屏" }}</h2>
      <p>
        {{
          loading
            ? "正在整理所选周期的指标与数据来源"
            : "请检查账号权限、开放状态或网络连接。"
        }}
      </p>
    </div>
    <template v-else>
      <section class="measurement-notices" role="status" aria-live="polite" aria-atomic="false" aria-label="新测量提醒">
        <article v-for="item in arrivalItems" :key="item.id" class="measurement-notice" :data-group="item.key">
          <component :is="item.icon" />
          <div><strong>{{ item.label }}</strong><p>{{ item.message }}</p></div>
          <button class="notice-view" :aria-label="`查看${item.label}新测量`" @click="tab='detail';selectGroup(item.key)">查看</button>
          <button class="notice-close" :aria-label="`关闭${item.label}提醒`" @click="delete arrivals[item.key]"><Close /></button>
        </article>
      </section>
      <div class="freshness">
        <span
          >{{ screen.period.dates[0] }} — {{ screen.period.dates.at(-1) }} ·
          健康管理参考</span
        ><span
          >最近测量 {{ date(screen.lastMeasuredAt) }} <i>·</i> 数据更新
          {{ date(screen.dataUpdatedAt) }} <i>·</i>
          {{ screen.period.timezone }}</span
        >
      </div>
      <div class="screen-grid">
        <aside class="left-stack">
          <section class="health-panel score-panel">
            <h2>
              <Odometer />健康参考评分
              <span v-if="screen.score.version" class="muted"
                >V{{ screen.score.version }}</span
              >
            </h2>
            <div class="score-layout">
              <div class="score-ring">
                <svg viewBox="0 0 190 190" aria-hidden="true">
                  <circle
                    cx="95"
                    cy="95"
                    r="76"
                    fill="none"
                    stroke="#174365"
                    stroke-width="12"
                    stroke-dasharray="358 478"
                    transform="rotate(135 95 95)"
                  />
                  <circle
                    v-if="score !== null"
                    cx="95"
                    cy="95"
                    r="76"
                    fill="none"
                    stroke="#21e5dc"
                    stroke-width="12"
                    stroke-linecap="round"
                    :stroke-dasharray="`${(score / 100) * 358} 478`"
                    transform="rotate(135 95 95)"
                  />
                </svg>
                <div>
                  <strong>{{ num(score) }}</strong
                  ><span>{{ score === null ? "待评估" : "/ 100" }}</span>
                </div>
              </div>
              <div class="score-breakdown">
                <small class="muted">指标覆盖天数</small>
                <div v-for="g in groups" :key="g.key">
                  <span :class="`dot dot-${g.key}`"></span
                  ><span>{{ g.short }}</span
                  ><b>{{ groupCoverage(g.key) }}<small> 天</small></b>
                </div>
              </div>
            </div>
            <p v-if="screen.score.reason" class="score-reason">
              {{ screen.score.reason }}
            </p>
            <button class="text-button" @click="basisOpen = true">
              查看评分依据与数据门槛 <span>›</span>
            </button>
          </section>
          <section class="health-panel">
            <h2><DataAnalysis />AI 健康摘要<span class="ai-badge">AI</span></h2>
            <template v-if="screen.analysis?.content"
              ><p v-if="screen.analysisStale" class="warning-note">
                数据已更新，以下为上次分析
              </p>
              <ul class="insight-list">
                <li
                  v-for="(item, i) in screen.analysis.content.summary"
                  :key="i"
                >
                  <CircleCheck /><span
                    >{{ item.text
                    }}<button
                      class="evidence-link"
                      @click="showEvidence(item.evidence)"
                    >
                      依据：{{ evidenceLabel(item.evidence) }}
                    </button></span
                  >
                </li>
              </ul>
              <p class="muted analysis-date">
                生成于 {{ date(screen.analysis.generatedAt) }} · 近{{
                  screen.analysis.period.days
                }}天
              </p></template
            >
            <div v-else class="panel-empty">
              <DataAnalysis />
              <h3>{{ busyAnalysis ? "正在生成分析" : "暂无分析" }}</h3>
            </div>
          </section>
          <section class="health-panel next-panel">
            <h2><Document />{{ screen.analysis?.content?.suggestions.length ? "下一步建议" : "分析概览" }}</h2>
            <ol v-if="screen.analysis?.content" class="suggestion-list">
              <li
                v-for="(item, i) in screen.analysis.content.suggestions"
                :key="i"
              >
                <span>{{ i + 1 }}</span>
                <div>
                  {{ item.text
                  }}<button
                    class="evidence-link"
                    @click="showEvidence(item.evidence)"
                  >
                    依据：{{ evidenceLabel(item.evidence) }}
                  </button>
                </div>
              </li>
            </ol>
            <div class="coverage-strip">
              <div>
                <b>{{ screen.recordCount }}</b
                ><span>可查看记录</span>
              </div>
              <div>
                <b>{{ screen.eligibleRecordCount }}</b
                ><span>符合评分基础条件</span>
              </div>
              <div>
                <b
                  >{{ screen.coverageDays }}<small> / {{ days }}</small></b
                ><span>有记录的天数</span>
              </div>
            </div>
            <button
              class="primary-button"
              :disabled="
                generating || busyAnalysis || !screen.availability.canGenerate
              "
              @click="confirmOpen = true"
            >
              <Loading
                v-if="generating || busyAnalysis"
                class="spinning"
              /><DataAnalysis v-else />{{
                busyAnalysis
                  ? "分析处理中"
                  : screen.analysisStale
                    ? "根据最新数据重新分析"
                    : screen.analysis?.content
                      ? "查看 / 复用本次分析"
                      : "生成 AI 健康分析"
              }}
            </button>
            <details
              v-if="screen.availability.reasons.length"
              class="availability-reason"
            >
              <summary>查看不可生成的原因</summary>
              <ul><li v-for="reason in screen.availability.reasons" :key="reason">{{ reason }}</li></ul>
            </details>
          </section>
        </aside>
        <section class="body-panel" aria-label="人体指标导航">
          <div class="body-caption">
            <span>个人健康全景</span><small v-if="figure">{{ figure.label }}</small>
          </div>
          <div class="body-stage">
            <svg
              class="body-guides"
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <g
                v-for="link in guideLines"
                :key="link.key"
                :opacity="group === link.key || arrivals[link.key] ? 1 : 0.38"
              >
                <polyline
                  :points="link.points"
                  fill="none"
                  :stroke="link.color"
                  stroke-width="1.5"
                  vector-effect="non-scaling-stroke"
                />
                <circle :cx="link.x" :cy="link.y" r="5" :fill="link.color" />
              </g>
            </svg>
            <div v-if="figure" class="body-visual" :data-figure="figure.key" :style="{'--figure-width':figure.width,'--heart-y':figure.anchors.cardiovascular[1]+'%'}">
              <img
                class="health-body"
                :src="figure.src"
                 :alt="figure.label+'人体示意图'"
                draggable="false"
              />
              <svg
                class="circulation-overlay" aria-hidden="true"
                viewBox="0 0 1210 1300"
                fill="none"
              >
                <g :transform="figure.child ? 'translate(153 239) scale(.75 .77)' : undefined">
                <path
                  class="circulation-path"
                  d="M626 359 C608 326 599 278 601 224 C597 188 589 153 601 104 M626 359 C597 408 588 501 600 594 C584 680 537 748 538 877 L519 1160 M600 594 C622 688 663 764 662 878 L681 1160 M607 281 C551 256 482 272 460 324 L420 493 L374 653 M613 281 C675 253 728 278 746 331 L786 496 L829 657"
                />
                <path
                  class="circulation-return"
                  d="M533 1150 L552 880 C550 748 602 673 614 590 L620 410 M665 1150 L647 879 C648 743 615 673 614 590 M384 654 L435 494 L473 327 C501 283 566 287 617 308 M820 650 L772 493 L731 330 C709 293 652 283 617 308"
                />
                </g>
              </svg>
              <span v-if="figure.child" class="child-heart-marker" aria-hidden="true"></span>
              <img
                v-if="!figure.child" class="health-body heart-layer" aria-hidden="true"
                :src="figure.src"
                alt=""
                draggable="false"
              />
            </div>
            <span
              v-for="item in arrivalItems" :key="item.id"
              class="measurement-anchor" :data-group="item.key" aria-hidden="true"
              :style="{left:(figure?.anchors[item.key][0] || 50)+'%',top:(figure?.anchors[item.key][1] || 50)+'%','--arrival-color':item.key==='cardiovascular'?'#ff789b':'#4cebd2'}"
            ><i></i><i></i><component :is="item.icon" /></span>
            <Aim
              aria-hidden="true"
              class="body-marker"
              :style="{
                left: markerPosition[0] + '%',
                top: markerPosition[1] + '%',
              }"
            /><button
              v-for="g in groups"
              :key="g.key"
              class="body-hotspot"
              :class="[
                g.key,
                { selected: group === g.key, 'has-arrival': !!arrivals[g.key] },
              ]"
              :aria-pressed="group === g.key"
              @click="selectGroup(g.key)"
            >
              <component :is="g.icon" /><span
                ><strong>{{ g.label }}</strong
                ><small>{{
                  groupCoverage(g.key)
                    ? `记录覆盖 ${groupCoverage(g.key)} 天`
                    : "暂无数据"
                }}</small
                ><em v-if="hotspotNotes[g.key]">{{ hotspotNotes[g.key] }}</em></span
              >
              <span v-if="arrivals[g.key]" :key="arrivals[g.key]?.id" class="arrival-bubble" aria-hidden="true"
                >{{ arrivals[g.key]?.message }}</span
              >
            </button>
          </div>
        </section>
        <aside
          class="right-stack"
          :class="{ 'trend-layout': tab === 'trends' }"
        >
          <nav class="detail-tabs" aria-label="指标视图">
            <button
              :class="{ active: tab === 'detail' }"
              @click="tab = 'detail'"
            >
              指标详情</button
            ><button
              :class="{ active: tab === 'trends' }"
              @click="tab = 'trends'"
            >
              趋势变化</button
            ><button
              :class="{ active: tab === 'records' }"
              @click="tab = 'records'"
            >
              测量记录
            </button>
            <button
              :class="{ active: tab === 'references' }"
              @click="tab = 'references'"
            >
              手动校准
            </button>
          </nav>
          <section
            v-if="tab !== 'references'"
            class="health-panel metric-panel"
            :class="{ 'trends-panel': tab === 'trends' }"
          >
            <h2>
              <component :is="tab === 'trends' ? TrendCharts : chosen.icon" />{{
                tab === "trends" ? "趋势研究与参考对照" : chosen.label
              }}<span class="muted">近{{ days }}天</span>
            </h2>
            <template v-if="tab === 'detail'"
              ><div v-if="series.length" class="metric-cards">
                <article v-for="s in series" :key="s.key">
                  <span>{{ s.label }}</span
                  ><small v-if="s.kind === 'reference'" class="reference-badge"
                    >手动参考</small
                  >
                  <div>
                    <b>{{ num(s.average) }}</b
                    ><small>{{ s.unit }}</small>
                  </div>
                  <p>
                    {{
                      s.semantics === "sample"
                        ? "每日采样均值的平均"
                        : "已记录日期的平均"
                    }}
                    · {{ s.coverageDays }}天
                  </p>
                  <p v-if="s.kind === 'reference'" class="muted">
                    {{ s.count }} 条参考值 · {{s.eligibleCount?s.eligibleCount+" 条符合当前评分规则":"趋势对照"}}
                  </p>
                  <p v-else>
                    {{ s.count }} 条测量记录
                  </p>
                </article>
              </div>
              <div v-else class="panel-empty">
                <component :is="chosen.icon" />
                <h3>此周期暂无对应记录</h3>
              </div>
              <label v-if="series.length > 1" class="trend-picker"
                >趋势指标
                <select v-model="chartKey" aria-label="趋势指标">
                  <option value="">{{ series[0]?.label }}</option>
                  <option
                    v-for="s in series.slice(1)"
                    :key="s.key"
                    :value="s.key"
                  >
                    {{ s.label }}
                  </option>
                </select></label
              >
              <HealthTrend
                v-if="focusSeries"
                :key="focusSeries.key"
                :series="focusSeries"
              />
              <div v-if="insights.length" class="ai-conclusion">
                <h3><DataAnalysis /> AI 分析说明</h3>
                <p v-for="(item, i) in insights" :key="i">{{ item.text }}</p>
              </div></template
            >
            <template v-else-if="tab === 'trends'">
              <div class="summary-metrics">
                <article v-for="m in summaryMetrics" :key="m.metric">
                  <span>{{ m.label }}</span
                  ><strong
                    >{{ m.value }}<small>{{ m.unit }}</small></strong
                  ><small>{{ m.note }}</small>
                </article>
              </div>
              <div class="trend-toolbar">
                <select
                  v-model="trendScope"
                  aria-label="趋势范围"
                  @change="expandedTrends = false"
                >
                  <option value="all">全部指标</option>
                  <option value="selected">{{ chosen.label }}</option>
                </select>
              </div>
              <div class="trend-stack">
                <HealthTrendGroup
                  v-for="g in visibleTrends"
                  :key="g.key"
                  :chart="g"
                  :days="days"
                />
              </div>
              <p v-if="!trendGroups.length" class="panel-empty">
                本周期暂无趋势数据
              </p>
              <button
                v-if="trendGroups.length > 3"
                class="text-button expand-trends"
                @click="expandedTrends = !expandedTrends"
              >
                {{
                  expandedTrends
                    ? "收起更多趋势"
                    : `展开其余 ${trendGroups.length - 3} 组趋势`
                }}
                <span>{{ expandedTrends ? "−" : "+" }}</span>
              </button>
            </template>
            <template v-else>
              <div class="record-controls">
                <select
                  v-model="recordMetric"
                  aria-label="测量指标"
                  @change="loadRecords()"
                >
                  <option value="">
                    {{
                      recordSeries[0]?.label ||
                      "暂无设备记录"
                    }}
                  </option>
                  <option v-for="m in recordOptions" :key="m" :value="m">
                    {{ series.find((s) => s.metric === m)?.label }}
                  </option></select
                ><input
                  v-if="requiresRecordReason"
                  v-model="recordReason"
                  aria-label="记录查看原因"
                  placeholder="填写查看原因（至少5字）"
                  maxlength="200"
                /><button
                  @click="loadRecords()"
                  :disabled="recordLoading || !selectedMetric"
                >
                  查询记录
                </button>
              </div>
              <p v-if="recordError" class="warning-note">{{ recordError }}</p>
              <div class="record-list">
                <article v-for="r in displayRows" :key="r.id">
                  <header>
                    <time>{{ date(r.measuredAt) }}</time
                    >
                  </header>
                  <p v-for="v in r.values" :key="v.key">
                    <span>{{ v.label }}</span
                    ><b>{{ num(v.value) }} {{ v.unit }}</b
                    ><small v-if="visibleRecordReason(v.reason)">{{ visibleRecordReason(v.reason) }}</small>
                  </p>
                  <p v-if="r.unavailableReason" class="warning-note">
                    {{ r.unavailableReason }}
                  </p>
                  <footer>
                    {{ r.sourceModel || "设备型号未提供" }} ·
                    {{ sourceLabel(r.source) }}<br />上传
                    {{ date(r.uploadedAt) }}
                  </footer>
                </article>
              </div>
              <p v-if="!rows.length && !recordLoading" class="panel-empty">
                暂无已加载的测量记录
              </p>
              <button
                v-if="cursor"
                class="secondary-button"
                :disabled="recordLoading"
                @click="loadRecords(true)"
              >
                {{ recordLoading ? "读取中…" : "加载更多记录" }}
              </button></template
            >
          </section>
          <section
            class="health-panel reference-overview"
            :class="{ 'reference-expanded': tab === 'references' }"
          >
            <h2>
              <Edit />手动参考与趋势对照<button
                class="text-button"
                @click="referenceOpen = true"
              >
                录入 / 管理
              </button>
            </h2>
            <div v-if="referenceSeries.length" class="reference-summary">
              <article
                v-for="s in tab === 'references'
                  ? referenceSeries
                  : referenceSeries.slice(0, 3)"
                :key="s.key"
              >
                <span>{{
                  s.label
                    .split(" · ")[0]
                    ?.replace("高密度脂蛋白胆固醇 ", "")
                    .replace("低密度脂蛋白胆固醇 ", "")
                }}</span
                ><strong
                  >{{ num(s.latest) }} <small>{{ s.unit }}</small></strong
                ><small
                  >{{ s.label.split(" · ").slice(2).join(" · ") }} ·
                  {{ date(s.latestAt) }}</small
                >
              </article>
            </div>
            <p v-else class="reference-empty">本周期暂无手动参考值</p>
            <button
              v-if="tab === 'references'"
              class="primary-button"
              @click="referenceOpen = true"
            >
              <Edit />填写参考值 / 查看历史
            </button>
          </section>
          <section v-if="screen.analysis?.content" class="health-panel screen-conclusion">
            <h2>
              <DataAnalysis />AI 分析结论 <span class="ai-badge">AI</span>
            </h2>
            <p v-if="screen.analysisStale" class="warning-note">
              数据已更新，以下为上次分析。
            </p>
            <p
              v-for="(item, i) in (insights.length
                ? insights
                : screen.analysis.content.summary
              ).slice(0, 2)"
              :key="i"
            >
              {{ item.text }}
            </p>
          </section>
          <details class="health-panel quality-panel">
            <summary><Warning />数据来源与说明</summary>
            <p v-if="tab === 'trends' && trendGroups.length">趋势图：虚线表示手动参考值，各来源独立展示，缺失日期留空。</p>
            <p v-if="screen.unusableRecordCount">
              本周期有
              {{ screen.unusableRecordCount }}
              条记录因数值缺失、格式异常或指标暂不支持，未进入图表与评分；可在测量记录中核对。
            </p>
            <p>
              数据覆盖：{{ groupCoverage(group) }} / {{ days }}天；{{
                series.reduce((n, s) => n + s.count, 0)
              }}项指标值
            </p>
            <p
              v-for="s in sourceExclusions"
              :key="s.key"
            >
              <strong>{{ s.label }}：</strong
              >{{
                Object.entries(s.exclusions)
                  .map(([key, count]) => `${key} ${count}条`)
                  .join("；")
              }}
            </p>
            <p v-if="!sourceExclusions.length">
              仅对来源、定义与覆盖量符合已发布规则的记录计算分数。
            </p>
            <p
              v-for="(item, i) in screen.analysis?.content?.limitations || []"
              :key="i"
            >
              {{ item }}
            </p>
            <p class="muted">
              基于设备记录及手动参考值的健康管理参考。参考值不修正设备读数，不用于临床诊断。
            </p>
          </details>
        </aside>
      </div>
    </template>
    <div
      v-if="basisOpen && screen"
      class="screen-modal"
      @click.self="basisOpen = false"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-modal-title"
      >
        <button
          class="modal-close"
          aria-label="关闭评分依据"
          @click="basisOpen = false"
        >
          <Close />
        </button>
        <h2 id="score-modal-title">评分依据与数据门槛</h2>
        <p>{{ screen.score.title || "评分规则待发布" }}</p>
        <p class="muted">
          总分只在全部必需项和加权项可评估时计算，不按缺失项重新分配权重。
        </p>
        <article
          v-for="item in screen.score.items"
          :key="item.key"
          class="basis-item"
        >
          <h3>
            {{ item.label }} ·
            {{ item.score === null ? "暂不可评分" : `${item.score}分` }}
          </h3>
          <p>
            {{
              item.reason ||
              `依据值 ${scoreValue(item.key, item.value)}；采用 ${item.days} 天、${item.count} 条记录；权重 ${item.weight}`
            }}
          </p>
          <p>{{ item.basis }}</p>
          <a
            v-if="item.referenceUrl"
            :href="item.referenceUrl"
            target="_blank"
            rel="noopener noreferrer"
            >查看评分依据来源 ↗</a
          >
        </article>
        <button class="secondary-button" @click="basisOpen = false">
          返回大屏
        </button>
      </section>
    </div>
    <div
      v-if="confirmOpen && screen"
      class="screen-modal"
      @click.self="confirmOpen = false"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-modal-title"
      >
        <h2 id="generate-modal-title">生成本次 AI 分析</h2>
        <p>将近{{ days }}天去标识化的健康统计发送至千问，生成健康管理参考。</p>
        <p>
          {{
            screen.availability.creditBypass
              ? "按当前管理员权限生成，不扣会员次数。"
              : `新分析使用1次健康报告次数，当前可用${screen.availability.credits}次。相同数据复用已有结果，不重复扣次。`
          }}
        </p>
        <div class="modal-actions">
          <button class="secondary-button" @click="confirmOpen = false">
            取消</button
          ><button class="primary-button" @click="generate">确认生成</button>
        </div>
      </section>
    </div>
    <HealthScreenProfileDialog v-if="profileOpen && screen" :member-id="memberId" :transport="transport" :error-message="errorMessage"
      @close="profileOpen=false" @saved="profileOpen=false;load()" @denied="profileOpen=false;emit('access-lost')" />
    <HealthReferenceDialog
      v-if="referenceOpen && screen"
      :member-id="memberId"
      :member-name="shownName"
      :member-no="screen.member.memberNo"
      :transport="transport"
      :error-message="errorMessage"
      @close="referenceOpen = false"
      @saved="load()"
      @edit-profile="profileOpen=true"
      @denied="denyReference"
    />
  </main>
</template>
<style scoped src="./health-screen.css"></style>
