<script setup lang="ts">
import { computed, ref } from "vue";
import type { HealthScreenSeries } from "@saydian/app-contracts";
import { formatScreenValue } from "./sleep-display";
const props = defineProps<{ series: HealthScreenSeries }>();
const selected = ref<number | null>(null);
const range = computed(() => {
  const values = props.series.points.flatMap((p) =>
    p.value === null ? [] : [p.value],
  );
  if (!values.length) return { min: 0, max: 1 };
  const min = Math.min(...values),
    max = Math.max(...values),
    pad = Math.max((max - min) * 0.2, Math.abs(max) * 0.03, 1);
  return { min: min - pad, max: max + pad };
});
const x = (i: number) =>
  40 + (i * 570) / Math.max(1, props.series.points.length - 1);
const y = (v: number) =>
  155 - ((v - range.value.min) / (range.value.max - range.value.min)) * 130;
const paths = computed(() => {
  let d = "";
  let gap = true;
  props.series.points.forEach((p, i) => {
    if (p.value === null) {
      gap = true;
      return;
    }
    d += `${gap ? "M" : "L"}${x(i)},${y(p.value)} `;
    gap = false;
  });
  return d;
});
const hovered = computed(() =>
  selected.value === null ? null : props.series.points[selected.value],
);
</script>
<template>
  <figure class="health-trend">
    <figcaption>
      <span
        >{{ series.label }} <small>（{{ series.unit }}）</small></span
      ><small
        >{{ series.semantics === "sample" ? "每日采样均值" : "每日有效汇总" }} ·
        {{ series.coverageDays }}天</small
      >
    </figcaption>
    <svg
      viewBox="0 0 640 190"
      role="img"
      :aria-label="`${series.label}，${series.coverageDays}天趋势；缺失处不连接`"
    >
      <g v-for="i in 4" :key="i">
        <line
          x1="40"
          x2="610"
          :y1="25 + (i - 1) * 43.333"
          :y2="25 + (i - 1) * 43.333"
          stroke="#214764"
        />
        <text x="32" :y="29 + (i - 1) * 43.333" text-anchor="end">
          {{
            Math.round(
              (range.max - ((i - 1) * (range.max - range.min)) / 3) * 10,
            ) / 10
          }}
        </text>
      </g>
      <path
        :d="paths"
        fill="none"
        stroke="#1bdcff"
        stroke-width="3"
        stroke-linecap="round"
      />
      <template v-for="(p, i) in series.points" :key="p.date">
        <circle
          v-if="p.value !== null"
          :cx="x(i)"
          :cy="y(p.value)"
          :r="selected === i ? 5 : 2.5"
          :fill="
            series.kind === 'reference'
              ? '#ffd78c'
              : p.eligibleCount === p.count
                ? '#2deac5'
                : '#99b8cc'
          "
          @mouseenter="selected = i"
          @mouseleave="selected = null"
          @focus="selected = i"
          @blur="selected = null"
          tabindex="0"
        >
          <title>
            {{ p.date }} · {{ formatScreenValue(p.value) }} {{ series.unit }} · {{ p.count }}条 ·
            {{
              series.kind === "reference"
                ? (p.eligibleCount ? `手动参考，${p.eligibleCount}条符合评分规则` : "手动参考，仅作对照")
                : `${p.eligibleCount}条符合评分基础条件`
            }}
          </title>
        </circle>
      </template>
      <text x="40" y="182">{{ series.points[0]?.date.slice(5) }}</text>
      <text x="610" y="182" text-anchor="end">
        {{ series.points.at(-1)?.date.slice(5) }}
      </text>
    </svg>
    <div v-if="hovered" class="trend-caption">
      {{ hovered.date }} · {{ formatScreenValue(hovered.value) }} {{ series.unit }} · {{ hovered.count }}条记录
    </div>
  </figure>
</template>
<style scoped>
.health-trend {
  margin: 0;
  padding: 18px 0 4px;
}
.health-trend figcaption {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
}
.health-trend small {
  font-size: 11px;
  color: #8eb0c9;
  font-weight: 400;
}
.health-trend svg {
  display: block;
  width: 100%;
  margin-top: 8px;
  overflow: visible;
}
.health-trend svg text {
  fill: #8eb0c9;
  font-size: 12px;
}
.health-trend circle:focus {
  outline: 2px solid white;
}
.trend-caption {
  color: #8eb0c9;
  font-size: 11px;
  min-height: 18px;
}
</style>
