<script setup lang="ts">
import { computed } from "vue";
import { Bar } from "vue-chartjs";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";
import type { SweepReport } from "../types";
import { LAYER_LABELS } from "../types";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const props = defineProps<{
  sweep: SweepReport;
}>();

const layerData = computed(() => {
  const map = new Map<number, { findings: number; fixed: number }>();

  for (const round of props.sweep.rounds) {
    for (const layer of round.layers) {
      const existing = map.get(layer.layer) ?? { findings: 0, fixed: 0 };
      existing.findings += layer.findings;
      existing.fixed += layer.fixed;
      map.set(layer.layer, existing);
    }
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([layer, data]) => ({
      layer,
      label: LAYER_LABELS[layer] ?? `Layer ${layer}`,
      needsReview: data.findings - data.fixed,
    }))
    .filter((d) => d.needsReview > 0);
});

const totalNeedsReview = computed(() =>
  layerData.value.reduce((sum, d) => sum + d.needsReview, 0),
);

const chartData = computed(() => ({
  labels: layerData.value.map((d) => d.label),
  datasets: [
    {
      data: layerData.value.map((d) => d.needsReview),
      backgroundColor: [
        "rgba(239, 68, 68, 0.7)",
        "rgba(249, 115, 22, 0.7)",
        "rgba(234, 179, 8, 0.7)",
        "rgba(14, 165, 233, 0.7)",
        "rgba(168, 85, 247, 0.7)",
        "rgba(34, 197, 94, 0.7)",
        "rgba(113, 113, 122, 0.7)",
      ],
      borderColor: [
        "rgba(239, 68, 68, 1)",
        "rgba(249, 115, 22, 1)",
        "rgba(234, 179, 8, 1)",
        "rgba(14, 165, 233, 1)",
        "rgba(168, 85, 247, 1)",
        "rgba(34, 197, 94, 1)",
        "rgba(113, 113, 122, 1)",
      ],
      borderWidth: 1,
      borderRadius: 4,
    },
  ],
}));

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: "y" as const,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: "rgba(24, 24, 27, 0.95)",
      titleColor: "rgba(228, 228, 231, 1)",
      bodyColor: "rgba(161, 161, 170, 1)",
      borderColor: "rgba(63, 63, 70, 1)",
      borderWidth: 1,
      cornerRadius: 8,
      padding: 10,
      callbacks: {
        label: (ctx: { parsed: { x: number } }) => `${ctx.parsed.x} issues need review`,
      },
    },
  },
  scales: {
    x: {
      ticks: { color: "rgba(113, 113, 122, 1)", font: { size: 11 }, stepSize: 5 },
      grid: { color: "rgba(39, 39, 42, 0.5)" },
    },
    y: {
      ticks: { color: "rgba(161, 161, 170, 1)", font: { size: 11 } },
      grid: { display: false },
    },
  },
};
</script>

<template>
  <div v-if="totalNeedsReview > 0" class="h-56">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
  <div v-else class="h-56 flex items-center justify-center">
    <span class="text-green-400 text-sm font-medium">All issues auto-fixed</span>
  </div>
</template>
