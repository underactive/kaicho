<script setup lang="ts">
import { computed } from "vue";
import { SEVERITY_COLORS } from "../types";

const props = defineProps<{
  counts: Record<string, number>;
}>();

const total = computed(() =>
  Object.values(props.counts).reduce((sum, n) => sum + n, 0),
);

const segments = computed(() => {
  const order = ["critical", "high", "medium", "low", "info"];
  return order
    .filter((s) => (props.counts[s] ?? 0) > 0)
    .map((severity) => ({
      severity,
      count: props.counts[severity]!,
      pct: total.value > 0 ? ((props.counts[severity]! / total.value) * 100) : 0,
      color: SEVERITY_COLORS[severity] ?? "bg-zinc-600",
    }));
});
</script>

<template>
  <div v-if="total > 0" class="flex items-center gap-2">
    <div class="flex h-4 flex-1 rounded overflow-hidden bg-zinc-800">
      <div
        v-for="seg in segments"
        :key="seg.severity"
        :class="seg.color"
        :style="{ width: seg.pct + '%' }"
        :title="`${seg.severity}: ${seg.count}`"
        class="transition-all duration-300"
      />
    </div>
    <span class="text-xs text-zinc-400 tabular-nums w-8 text-right">{{ total }}</span>
  </div>
  <div v-else class="text-xs text-zinc-600">No findings</div>
</template>
