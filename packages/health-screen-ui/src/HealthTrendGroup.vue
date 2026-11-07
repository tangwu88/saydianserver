<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { HealthScreenSeries } from "@saydian/app-contracts";
import type { TrendGroup } from "./trend-groups";
import { shortSeriesLabel, trendPath } from "./trend-groups";
import { formatScreenValue } from "./sleep-display";
const props = defineProps<{ chart: TrendGroup; days: number }>();
const active = ref<string | null>(null);
const colors = [
  "#15e1f1",
  "#b28aff",
  "#f5c578",
  "#5af0ba",
  "#ff8eac",
  "#6baeff",
];
const range = computed(() => {
  const values = props.chart.series.flatMap((s) =>
    s.points.flatMap((p) => (p.value === null ? [] : [p.value])),
  );
  if (!values.length) return { min: 0, max: 1 };
  const min = Math.min(...values),
    max = Math.max(...values),
    pad = Math.max((max - min) * 0.18, Math.abs(max) * 0.03, 0.25);
  return { min: min - pad, max: max + pad };
});
const x = (i: number) =>
  46 + (i * 570) / Math.max(1, (props.chart.series[0]?.points.length || 1) - 1);
const y = (v: number) =>
  44 - ((v - range.value.min) / (range.value.max - range.value.min)) * 30;
const color = (s: HealthScreenSeries, i: number) =>
  s.kind !== "reference" && s.eligibleCount === 0
    ? "#94b4cc"
    : colors[i % colors.length];
const title = (s: HealthScreenSeries, i: number) => {
  const p = s.points[i]!;
  return `${p.date} · ${s.label} · ${formatScreenValue(p.value)} ${s.unit} · ${p.count}条${s.kind === "reference" ? "参考值" : "记录"}`;
};
watch(
  () => props.chart,
  () => {
    active.value = null;
  },
);
</script>
<template>
  <figure class="trend-group">
    <figcaption>
      <strong
        >{{ chart.title }}趋势 <small>近{{ days }}天</small></strong
      ><span>{{ chart.unit }}</span>
    </figcaption>
    <div class="chart-legend">
      <span v-for="(s, i) in chart.series" :key="s.key" :title="s.label"
        ><i
          :style="{ background: color(s, i) }"
          :class="{ reference: s.kind === 'reference' }"
        ></i
        >{{ shortSeriesLabel(s) }}</span
      >
    </div>
    <svg
      viewBox="0 0 640 68"
      role="img"
      :aria-label="`${chart.title}趋势，${chart.unit}；各来源独立曲线，缺失日期不连接`"
    >
      <g v-for="i in 3" :key="i">
        <line
          x1="46"
          x2="616"
          :y1="14 + ((i - 1) * 30) / 2"
          :y2="14 + ((i - 1) * 30) / 2"
          stroke="#184967"
        />
        <text x="38" :y="18 + ((i - 1) * 30) / 2" text-anchor="end">
          {{
            Number(
              (range.max - ((i - 1) * (range.max - range.min)) / 2).toFixed(1),
            )
          }}
        </text>
      </g>
      <g v-for="(s, j) in chart.series" :key="s.key">
        <path
          :d="trendPath(s.points, x, y)"
          fill="none"
          :stroke="color(s, j)"
          stroke-width="2.3"
          :stroke-dasharray="s.kind === 'reference' ? '5 4' : undefined"
        />
        <template v-for="(p, i) in s.points" :key="p.date">
          <circle
            v-if="p.value !== null"
            :cx="x(i)"
            :cy="y(p.value)"
            :r="s.kind === 'reference' ? 3.6 : 2.2"
            :fill="
              s.kind !== 'reference' && p.eligibleCount < p.count
                ? '#94b4cc'
                : color(s, j)
            "
            :stroke="s.kind === 'reference' ? '#fff2c7' : 'none'"
            tabindex="0"
            @mouseenter="active = title(s, i)"
            @mouseleave="active = null"
            @focus="active = title(s, i)"
            @blur="active = null"
          >
            <title>{{ title(s, i) }}</title>
          </circle>
        </template>
      </g>
      <text x="46" y="63">
        {{ chart.series[0]?.points[0]?.date.slice(5) }}
      </text>
      <text x="331" y="63" text-anchor="middle">
        {{
          chart.series[0]?.points[
            Math.floor((chart.series[0]?.points.length || 1) / 2)
          ]?.date.slice(5)
        }}
      </text>
      <text x="616" y="63" text-anchor="end">
        {{ chart.series[0]?.points.at(-1)?.date.slice(5) }}
      </text>
    </svg>
    <p v-if="active" class="chart-note">
      {{ active }}
    </p>
  </figure>
</template>
<style scoped>
.trend-group {
  margin: 0;
  padding: 6px 10px 3px;
  border: 1px solid #1a5b7d;
  border-radius: 12px;
  background: #052442;
  min-width: 0;
}
figcaption {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  color: #e7f5ff;
  font-size: 14px;
  line-height: 1.3;
}
figcaption small,
figcaption > span {
  font-size: 11px;
  color: #9ac2db;
  font-weight: 400;
}
.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 12px;
  font-size: 10px;
  color: #b5d2e4;
  margin: 3px 0 1px;
  line-height: 1.4;
}
.chart-legend span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.chart-legend i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.chart-legend i.reference {
  box-shadow: 0 0 0 1px #fff2c7;
}
svg {
  display: block;
  width: 100%;
  height: auto;
  max-height: 140px;
  overflow: visible;
}
svg text {
  fill: #8fb7d0;
  font-size: 11px;
}
circle:focus {
  outline: 2px solid white;
}
.chart-note {
  font-size: 10px;
  color: #8fb7d0;
  line-height: 1.4;
  margin: 1px 0 0;
  min-height: 14px;
}
@media (min-width: 2100px) {
  figcaption {
    font-size: 18px;
  }
  .chart-legend,
  .chart-note {
    font-size: 12px;
  }
  svg {
    max-height: 180px;
  }
}
@media (max-width: 640px) {
  .trend-group {
    padding: 10px;
  }
  .chart-note {
    font-size: 10px;
  }
  figcaption {
    font-size: 14px;
  }
}
</style>
