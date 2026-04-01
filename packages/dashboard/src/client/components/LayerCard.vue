<script setup lang="ts">
import type { SweepLayerResult } from "../types";
import { LAYER_LABELS } from "../types";
import SeverityBar from "./SeverityBar.vue";

defineProps<{
  result: SweepLayerResult;
  sweepIndex: number;
  clickable?: boolean;
}>();

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
</script>

<template>
  <component
    :is="clickable ? 'router-link' : 'div'"
    :to="clickable ? `/sweeps/${sweepIndex}/layers/${result.layer}` : undefined"
    class="block border border-zinc-800 rounded-lg p-4 hover:border-zinc-600 transition-colors"
    :class="{ 'cursor-pointer': clickable }"
  >
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <span class="text-xs font-mono text-zinc-500">L{{ result.layer }}</span>
        <span class="font-medium text-sm">
          {{ LAYER_LABELS[result.layer] ?? result.tasks.join(", ") }}
        </span>
      </div>
      <span class="text-xs text-zinc-500">{{ formatDuration(result.durationMs) }}</span>
    </div>

    <div class="grid grid-cols-4 gap-2 text-xs mb-2">
      <div>
        <span class="text-zinc-500">Found</span>
        <span class="ml-1 font-mono">{{ result.findings }}</span>
      </div>
      <div>
        <span class="text-zinc-500">Fixed</span>
        <span class="ml-1 font-mono text-green-400">{{ result.fixed }}</span>
      </div>
      <div>
        <span class="text-zinc-500">Skipped</span>
        <span class="ml-1 font-mono">{{ result.skipped }}</span>
      </div>
      <div>
        <span class="text-zinc-500">Failed</span>
        <span class="ml-1 font-mono" :class="result.failed > 0 ? 'text-red-400' : ''">
          {{ result.failed }}
        </span>
      </div>
    </div>

    <SeverityBar :counts="{ findings: result.findings, fixed: result.fixed }" />

    <div v-if="result.regressions.length > 0" class="mt-2">
      <span class="text-xs text-red-400 font-medium">
        {{ result.regressions.length }} regression{{ result.regressions.length > 1 ? "s" : "" }}
      </span>
    </div>
  </component>
</template>
