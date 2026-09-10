<script setup lang="ts">
import { computed } from "vue";
import { healthMetricLabel, healthRawJson, healthReadings, healthScalar, healthSource, healthTime, type HealthDisplayRow } from "../health-display";

const props = defineProps<{ mode: "summary" | "raw"; rows: HealthDisplayRow[]; memberNo?: string | number }>();
const records = computed(() => props.rows.map((row, index) => ({
  key: `${String(row.id ?? row.metric ?? "record")}-${index}`,
  row,
  readings: props.mode === "raw" ? healthReadings(row) : [],
})));
</script>

<template>
  <section class="member-health-data" :aria-label="mode === 'summary' ? '会员健康数据摘要' : '会员原始健康记录'">
    <header class="health-intro">
      <div>
        <strong>{{ mode === 'summary' ? '健康记录概览' : '健康测量记录' }}<span v-if="memberNo !== undefined"> · 会员 {{ memberNo }}</span></strong>
        <p v-if="mode === 'summary'">按指标统计已保存的记录条数；最早、最近时间统一显示为 UTC。</p>
        <p v-else>数值按原记录展示；时间使用记录提供的时区。单位缺失会明确标记，未进行医学正常或异常判断。</p>
      </div>
      <div v-if="$slots.actions" class="health-actions"><slot name="actions" /></div>
    </header>
    <p v-if="!records.length" class="health-empty">{{ mode === 'summary' ? '暂无健康记录' : '暂无测量记录' }}</p>
    <template v-else-if="mode === 'summary'">
      <article v-for="record in records" :key="record.key" class="summary-row">
        <h3>{{ healthMetricLabel(record.row.metric) }}</h3>
        <dl>
          <div><dt>记录次数</dt><dd>{{ healthScalar(record.row.count) }}<span v-if="record.row.count !== null && record.row.count !== undefined"> 条</span></dd></div>
          <div><dt>最早记录</dt><dd>{{ healthTime(record.row.firstObservedAt, 0) }}</dd></div>
          <div><dt>最近记录</dt><dd>{{ healthTime(record.row.lastObservedAt, 0) }}</dd></div>
        </dl>
        <details class="technical-details"><summary>原始字段</summary><pre>{{ healthRawJson(record.row) }}</pre></details>
      </article>
    </template>
    <template v-else>
      <div class="raw-head" aria-hidden="true"><span>测量类型</span><span>测量时间</span><span>测量值</span><span>来源</span></div>
      <article v-for="record in records" :key="record.key" class="raw-record">
        <div class="raw-main">
          <h3><small>测量类型</small>{{ healthMetricLabel(record.row.metric) }}</h3>
          <div><small>测量时间</small><time>{{ healthTime(record.row.observedAt, record.row.timezoneOffsetMinutes) }}</time></div>
          <div><small>测量值</small><ul class="reading-list"><li v-for="(item, index) in record.readings.slice(0, 4)" :key="index"><span>{{ item.label }}</span><strong>{{ item.text }}</strong></li></ul><span v-if="record.readings.length > 4" class="extra-values">另 {{ record.readings.length - 4 }} 项见详情</span></div>
          <div><small>来源</small>{{ healthSource(record.row) }}</div>
        </div>
        <details class="technical-details">
          <summary>查看记录详情与原始数据</summary>
          <ul v-if="record.readings.length > 4" class="reading-list expanded-readings"><li v-for="(item, index) in record.readings" :key="index"><span>{{ item.label }}</span><strong>{{ item.text }}</strong></li></ul>
          <p>下方保留原始字段、单位、采集来源、记录编号和数据质量标记，供核对使用。</p>
          <pre>{{ healthRawJson(record.row) }}</pre>
        </details>
      </article>
    </template>
  </section>
</template>

<style scoped>
.member-health-data { color: #263446; min-width: 0; }
.health-intro { display: flex; gap: 16px; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.health-intro strong { font-size: 17px; }
.health-intro p, .technical-details p { color: #657387; font-size: 13px; line-height: 1.6; margin: 7px 0 0; }
.health-actions { flex-shrink: 0; }
.health-empty { padding: 34px 12px; color: #657387; text-align: center; background: #f6f8fb; border-radius: 8px; }
.summary-row, .raw-record { border: 1px solid #e3e9f1; border-radius: 8px; padding: 14px; margin-bottom: 12px; background: #fff; }
h3 { margin: 0; font-size: 15px; font-weight: 650; }
.summary-row dl { display: grid; grid-template-columns: minmax(70px, .5fr) repeat(2, minmax(0, 1fr)); gap: 12px; margin: 14px 0 0; }
dt { font-size: 12px; color: #657387; margin-bottom: 5px; }
dd { margin: 0; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.raw-head, .raw-main { display: grid; grid-template-columns: minmax(80px, .7fr) minmax(120px, 1.1fr) minmax(160px, 1.3fr) minmax(100px, 1fr); gap: 16px; }
.raw-head { padding: 8px 14px; color: #657387; font-size: 12px; }
.raw-main { font-size: 13px; line-height: 1.6; }
.raw-main > * { min-width: 0; overflow-wrap: anywhere; }
.raw-main small { display: none; }
.reading-list { list-style: none; padding: 0; margin: 0; }
.reading-list li { display: flex; flex-wrap: wrap; gap: 2px 8px; margin-bottom: 4px; }
.reading-list li span { color: #657387; }
.reading-list strong { font-weight: 600; }
.extra-values { color: #657387; font-size: 12px; }
.technical-details { margin-top: 12px; border-top: 1px solid #edf1f6; padding-top: 9px; }
.technical-details summary { color: #346aa5; cursor: pointer; font-size: 12px; }
.technical-details pre { max-height: 360px; overflow: auto; background: #f6f8fb; padding: 12px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; border-radius: 6px; }
.expanded-readings { margin-top: 12px; }
@media (max-width: 700px) {
  .health-intro { flex-direction: column; gap: 8px; }
  .health-actions { width: 100%; }
  .summary-row dl { grid-template-columns: 1fr; gap: 9px; }
  .summary-row dl > div { display: grid; grid-template-columns: 70px 1fr; gap: 8px; }
  .raw-head { display: none; }
  .raw-main { grid-template-columns: 1fr; gap: 10px; }
  .raw-main small { display: block; color: #657387; font-size: 12px; font-weight: 400; margin-bottom: 3px; }
}
</style>
