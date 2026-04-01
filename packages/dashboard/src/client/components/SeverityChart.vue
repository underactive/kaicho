<script setup lang="ts">
import { computed } from "vue";
import { Doughnut } from "vue-chartjs";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";
import type { SweepReport } from "../types";

ChartJS.register(ArcElement, Tooltip, Legend);

const props = defineProps<{
  sweep: SweepReport;
}>();

const severityCounts = computed(() => {
  const counts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const item of props.sweep.remaining) {
    const sev = item.severity.toLowerCase();
    if (sev in counts) {
      counts[sev]!++;
    }
  }
  return counts;
});

const hasData = computed(() =>
  Object.values(severityCounts.value).some((v) => v > 0),
);

const chartData = computed(() => {
  const labels = ["Critical", "High", "Medium", "Low", "Info"];
  const colors = [
    "rgba(239, 68, 68, 0.85)",
    "rgba(249, 115, 22, 0.85)",
    "rgba(234, 179, 8, 0.85)",
    "rgba(14, 165, 233, 0.85)",
    "rgba(113, 113, 122, 0.85)",
  ];
  const borderColors = [
    "rgba(239, 68, 68, 1)",
    "rgba(249, 115, 22, 1)",
    "rgba(234, 179, 8, 1)",
    "rgba(14, 165, 233, 1)",
    "rgba(113, 113, 122, 1)",
  ];

  return {
    labels,
    datasets: [
      {
        data: [
          severityCounts.value.critical,
          severityCounts.value.high,
          severityCounts.value.medium,
          severityCounts.value.low,
          severityCounts.value.info,
        ],
        backgroundColor: colors,
        borderColor: borderColors,
        borderWidth: 2,
        hoverOffset: 6,
      },
    ],
  };
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: "65%",
  plugins: {
    legend: {
      position: "right" as const,
      labels: {
        color: "rgba(161, 161, 170, 1)",
        font: { size: 12 },
        boxWidth: 12,
        boxHeight: 12,
        useBorderRadius: true,
        borderRadius: 2,
        padding: 12,
        filter: (item: { index?: number }) => {
          // Hide zero-count items from legend
          const idx = item.index ?? 0;
          const vals = [
            severityCounts.value.critical,
            severityCounts.value.high,
            severityCounts.value.medium,
            severityCounts.value.low,
            severityCounts.value.info,
          ];
          return (vals[idx] ?? 0) > 0;
        },
      },
    },
    tooltip: {
      backgroundColor: "rgba(24, 24, 27, 0.95)",
      titleColor: "rgba(228, 228, 231, 1)",
      bodyColor: "rgba(161, 161, 170, 1)",
      borderColor: "rgba(63, 63, 70, 1)",
      borderWidth: 1,
      cornerRadius: 8,
      padding: 10,
    },
  },
};
</script>

<template>
  <div v-if="hasData" class="h-56">
    <Doughnut :data="chartData" :options="chartOptions" />
  </div>
  <div v-else class="h-56 flex items-center justify-center">
    <span class="text-green-400 text-sm font-medium">All clear — zero remaining findings</span>
  </div>
</template>
