<script setup lang="ts">
import { computed } from "vue";
import type { ReportVisuals } from "@saydian/app-contracts";
import { chartGeometry, reportNumber, sleepDuration } from "../report-charts";

const props = defineProps<{
  visuals?: ReportVisuals | undefined;
  score?: { value: number | null; explanation: string } | undefined;
  coverage?: { distinctDays: number; validRecordCount: number } | undefined;
}>();
const sleep = computed(() => props.visuals?.sleep);
const scoreValue = computed(() => typeof props.score?.value === "number" && Number.isInteger(props.score.value) && props.score.value >= 0 && props.score.value <= 100 ? props.score.value : null);
const metrics = computed(() => (props.visuals?.metrics ?? []).map(metric => ({ ...metric, chart: chartGeometry(metric.points) })));
const stages = computed(() => !sleep.value ? [] : [
  ...sleep.value.stages.map((stage, i) => ({ ...stage, color: ["#5c58bd", "#a19ee6", "#49b4b2"][i] })),
  { key: "unclassified", label: "未分类", seconds: sleep.value.unclassifiedSeconds, color: "#e1e5ee" },
]);
</script>

<template>
  <section class="visual-report" aria-label="报告图表与记录摘要">
    <div v-if="score || sleep" class="sleep-hero">
      <div v-if="score" class="score-wrap">
        <div class="score-ring" :style="{ background: `conic-gradient(#6861c9 ${(scoreValue ?? 0) * 3.6}deg, #e6e5f2 0deg)` }" role="img" :aria-label="scoreValue == null ? '证据不足，未评分' : `AI 睡眠参考评分 ${scoreValue} / 100`">
          <div><strong>{{ scoreValue ?? '—' }}</strong><span>{{ scoreValue == null ? '未评分' : '/ 100' }}</span></div>
        </div>
        <div><span class="eyebrow">AI 睡眠参考评分</span><p>{{ score?.explanation || '证据不足时不提供评分。' }}</p><small>AI 参考 · 非设备评分或临床评估</small></div>
      </div>
      <div v-if="sleep" class="sleep-facts">
        <div><span>◷ 睡眠时长</span><strong>{{ sleepDuration(sleep.totalSeconds) }}</strong></div>
        <div><span>☾ 睡眠记录</span><strong>{{ sleep.sessionCount == null ? '未记录' : `${sleep.sessionCount} 段` }}</strong></div>
        <div><span>◌ 醒来次数</span><strong>{{ sleep.wakeCount == null ? '未记录' : `${sleep.wakeCount} 次` }}</strong></div>
      </div>
    </div>
    <article v-if="sleep" class="stage-card">
      <div class="visual-heading"><h3>睡眠阶段</h3><span>本次记录</span></div>
      <div class="stage-bar" role="img" aria-label="睡眠阶段时长占比，具体数值见下方图例">
        <span v-for="stage in stages.filter(s => s.seconds != null && s.seconds > 0)" :key="stage.key" :style="{ width: `${stage.seconds! / sleep.totalSeconds * 100}%`, background: stage.color }" :title="`${stage.label} ${sleepDuration(stage.seconds)}`" />
      </div>
      <div class="stage-legend"><div v-for="stage in stages" :key="stage.key"><i :style="{ background: stage.color }" /><span>{{ stage.label }}</span><strong>{{ sleepDuration(stage.seconds) }}</strong></div></div>
      <small>阶段缺失时显示“未记录”；无法分类的时长单独保留。</small>
    </article>
    <template v-if="metrics.length">
      <div class="visual-heading"><h3>数据一览</h3><span v-if="coverage">{{ coverage.distinctDays }} 天 · {{ coverage.validRecordCount }} 条有效记录</span></div>
      <div class="metric-visual-grid">
        <article v-for="metric in metrics" :key="metric.key" class="metric-visual-card">
          <h4>{{ metric.label }}</h4>
          <div class="metric-value"><strong>{{ reportNumber(metric.average) }}</strong><span>{{ metric.unit }} · 样本均值</span></div>
          <svg v-if="metric.chart.dots.length" viewBox="0 0 300 84" role="img" :aria-label="`${metric.label}每日样本均值趋势；${metric.chart.dots.length}个有记录日期，断开处为缺失日期`">
            <path d="M12 70 H288" stroke="#e4eaf0" fill="none" />
            <path :d="metric.chart.path" stroke="#218b8b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none" />
            <circle v-for="point in metric.chart.dots" :key="point.date" :cx="point.x" :cy="point.y" r="3.2" fill="#218b8b"><title>{{ point.date }}：{{ reportNumber(point.value) }} {{ metric.unit }}</title></circle>
          </svg>
          <div class="chart-labels"><span>{{ metric.points[0]?.date.slice(5) || '无日期数据' }}</span><span>{{ metric.points.length === 1 ? '仅 1 天记录' : metric.points.at(-1)?.date.slice(5) }}</span></div>
          <p>最近 {{ reportNumber(metric.latest) }} {{ metric.unit }} <span>· {{ metric.sampleCount }} 个样本</span></p>
          <details v-if="metric.points.length"><summary>查看每日数值</summary><ul><li v-for="point in metric.points" :key="point.date"><span>{{ point.date }}</span><strong>{{ reportNumber(point.value) }} {{ metric.unit }}</strong></li></ul></details>
        </article>
      </div>
      <p class="chart-note">图中为有记录日期的样本均值，缺失日期不补零；步数、距离和热量的样本均值不代表全天累计。</p>
    </template>
  </section>
</template>

<style scoped>
.visual-report { margin: 18px 0; color: #243647; }
.sleep-hero { padding: 22px; border-radius: 18px; background: linear-gradient(120deg,#f0f0fb,#eff8f8); }
.score-wrap { display: flex; gap: 22px; align-items: center; }
.score-ring { width: 112px; height: 112px; border-radius: 50%; display: grid; place-items: center; flex: 0 0 112px; }
.score-ring > div { width: 92px; height: 92px; border-radius: 50%; background: #f8f9ff; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.score-ring strong { font-size: 34px; line-height: 1.1; color: #4f49a3; } .score-ring span { color: #7a7e94; font-size: 12px; }
.eyebrow { color: #58518e; font-size: 14px; font-weight: 700; } .score-wrap p { margin: 8px 0; font-size: 14px; line-height: 1.65; } small { color: #738191; font-size: 12px; }
.sleep-facts { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; margin-top: 18px; } .sleep-facts > div { padding: 14px; background: #ffffffc9; border-radius: 12px; display: flex; flex-direction: column; gap: 8px; }
.sleep-facts span { color: #6d7b91; font-size: 12px; } .sleep-facts strong { font-size: 20px; }
.stage-card { margin-top: 16px; padding: 18px; border: 1px solid #e2e8f0; border-radius: 14px; }
.visual-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin: 18px 0 12px; } .visual-heading h3 { margin: 0; font-size: 16px; } .visual-heading span { color: #748093; font-size: 12px; }
.stage-card .visual-heading { margin-top: 0; } .stage-bar { display: flex; height: 22px; border-radius: 8px; overflow: hidden; background: #e1e5ee; } .stage-bar span { display: block; }
.stage-legend { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px 20px; margin: 16px 0 12px; } .stage-legend > div { display: flex; gap: 7px; align-items: center; font-size: 12px; } .stage-legend strong { margin-left: auto; } .stage-legend i { width: 9px; height: 9px; border-radius: 3px; flex: 0 0 9px; }
.metric-visual-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; } .metric-visual-card { border: 1px solid #e1e8ee; border-radius: 14px; padding: 17px; background: white; min-width: 0; }
.metric-visual-card h4 { font-size: 13px; color: #617286; margin: 0 0 9px; } .metric-value { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; } .metric-value strong { font-size: 28px; line-height: 1.2; } .metric-value span { color: #788496; font-size: 11px; }
svg { width: 100%; height: 95px; display: block; margin-top: 10px; } .chart-labels { display: flex; justify-content: space-between; color: #7c8795; font-size: 11px; }
.metric-visual-card p { font-size: 12px; margin: 10px 0 0; } .metric-visual-card p span { color: #7c8795; } .chart-note { font-size: 12px; line-height: 1.65; color: #7c8795; margin: 12px 0; }
details { font-size: 12px; margin-top: 10px; color: #496a83; } summary { cursor: pointer; min-height: 28px; display: flex; align-items: center; } details ul { padding: 0; list-style: none; } details li { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; border-top: 1px solid #eef1f5; }
@media(max-width:600px) { .score-wrap { flex-direction: column; align-items: flex-start; gap: 16px; } .sleep-hero { padding: 18px; } .sleep-facts { grid-template-columns: 1fr; } .sleep-facts > div { flex-direction: row; align-items: center; justify-content: space-between; } .sleep-facts strong { font-size: 18px; } .metric-visual-grid { grid-template-columns: 1fr; } }
</style>
