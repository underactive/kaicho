<script setup lang="ts">
import { computed } from "vue";
import { Bar } from "vue-chartjs";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import type { SweepReport } from "../types";
import { LAYER_LABELS } from "../types";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const props = defineProps<{
  sweep: SweepReport;
}>();

// Aggregate layer data across all rounds
const layerData = computed(() => {
  const map = new Map<number, { findings: number; fixed: number; skipped: number; failed: number }>();

  for (const round of props.sweep.rounds) {
    for (const layer of round.layers) {
      const existing = map.get(layer.layer) ?? { findings: 0, fixed: 0, skipped: 0, failed: 0 };
      existing.findings += layer.findings;
      existing.fixed += layer.fixed;
      existing.skipped += layer.skipped;
      existing.failed += layer.failed;
      map.set(layer.layer, existing);
    }
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([layer, data]) => ({ layer, ...data }));
});

const chartData = computed(() => ({
  labels: layerData.value.map((d) => LAYER_LABELS[d.layer] ?? `Layer ${d.layer}`),
  datasets: [
    {
      label: "Found",
      data: layerData.value.map((d) => d.findings),
      backgroundColor: "rgba(99, 102, 241, 0.7)",
      borderColor: "rgba(99, 102, 241, 1)",
      borderWidth: 1,
      borderRadius: 4,
    },
    {
      label: "Auto-Fixed",
      data: layerData.value.map((d) => d.fixed),
      backgroundColor: "rgba(34, 197, 94, 0.7)",
      borderColor: "rgba(34, 197, 94, 1)",
      borderWidth: 1,
      borderRadius: 4,
    },
    {
      label: "Needs Review",
      data: layerData.value.map((d) => d.findings - d.fixed),
      backgroundColor: "rgba(234, 179, 8, 0.7)",
      borderColor: "rgba(234, 179, 8, 1)",
      borderWidth: 1,
      borderRadius: 4,
    },
  ],
}));

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "top" as const,
      labels: {
        color: "rgba(161, 161, 170, 1)",
        font: { size: 12 },
        boxWidth: 12,
        boxHeight: 12,
        useBorderRadius: true,
        borderRadius: 2,
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
  scales: {
    x: {
      ticks: { color: "rgba(113, 113, 122, 1)", font: { size: 11 } },
      grid: { display: false },
    },
    y: {
      ticks: { color: "rgba(113, 113, 122, 1)", font: { size: 11 }, stepSize: 5 },
      grid: { color: "rgba(39, 39, 42, 0.5)" },
    },
  },
};
</script>

<template>
  <div class="h-72">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>
