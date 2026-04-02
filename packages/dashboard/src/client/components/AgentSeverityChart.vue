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
import type { RunRecord, Severity } from "../types";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const props = defineProps<{
  runs: RunRecord[];
}>();

const SEVERITIES: { key: Severity; label: string; bg: string; border: string }[] = [
  { key: "critical", label: "Critical", bg: "rgba(239, 68, 68, 0.85)", border: "rgba(239, 68, 68, 1)" },
  { key: "high", label: "High", bg: "rgba(249, 115, 22, 0.85)", border: "rgba(249, 115, 22, 1)" },
  { key: "medium", label: "Medium", bg: "rgba(234, 179, 8, 0.85)", border: "rgba(234, 179, 8, 1)" },
  { key: "low", label: "Low", bg: "rgba(14, 165, 233, 0.85)", border: "rgba(14, 165, 233, 1)" },
  { key: "info", label: "Info", bg: "rgba(113, 113, 122, 0.85)", border: "rgba(113, 113, 122, 1)" },
];

const VALID_SEVERITIES = new Set<string>(SEVERITIES.map((s) => s.key));

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const agentData = computed(() => {
  const map = new Map<string, Record<Severity, number>>();

  for (const run of props.runs) {
    if (!map.has(run.agent)) {
      map.set(run.agent, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
    }
    const counts = map.get(run.agent)!;
    for (const s of run.suggestions) {
      const sev = s.severity.toLowerCase();
      if (VALID_SEVERITIES.has(sev)) {
        counts[sev as Severity]++;
      }
    }
  }

  const agents = [...map.keys()].sort();
  return { agents, map };
});

const hasData = computed(() =>
  agentData.value.agents.some((agent) => {
    const counts = agentData.value.map.get(agent)!;
    return Object.values(counts).some((v) => v > 0);
  }),
);

const chartData = computed(() => ({
  labels: agentData.value.agents.map(capitalize),
  datasets: SEVERITIES.map((sev) => ({
    label: sev.label,
    data: agentData.value.agents.map((agent) => agentData.value.map.get(agent)![sev.key]),
    backgroundColor: sev.bg,
    borderColor: sev.border,
    borderWidth: 1,
    borderRadius: 4,
  })),
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
      callbacks: {
        label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
          `${ctx.dataset.label}: ${ctx.parsed.y} findings`,
      },
    },
  },
  scales: {
    x: {
      stacked: true,
      ticks: { color: "rgba(113, 113, 122, 1)", font: { size: 11 } },
      grid: { display: false },
    },
    y: {
      stacked: true,
      ticks: { color: "rgba(113, 113, 122, 1)", font: { size: 11 }, stepSize: 5 },
      grid: { color: "rgba(39, 39, 42, 0.5)" },
    },
  },
};
</script>

<template>
  <div v-if="hasData" class="h-72">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
  <div v-else class="h-72 flex items-center justify-center">
    <span class="text-zinc-500 text-sm">No agent run data available</span>
  </div>
</template>
