<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import type { SweepReport, SweepRoundResult } from "../types";
import { LAYER_LABELS } from "../types";
import LayerCard from "../components/LayerCard.vue";
import SeverityBadge from "../components/SeverityBadge.vue";
import { api } from "../api";

const props = defineProps<{ index: string }>();

const sweep = ref<SweepReport | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    const sweeps = await api.sweeps();
    const idx = parseInt(props.index, 10);
    sweep.value = sweeps[idx] ?? null;
  } finally {
    loading.value = false;
  }
});

const activeRound = ref(0);

const rounds = computed<SweepRoundResult[]>(() => sweep.value?.rounds ?? []);
const currentRound = computed(() => rounds.value[activeRound.value]);

const isTwoPass = computed(() => sweep.value?.strategy === "two-pass");

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
</script>

<template>
  <div>
    <router-link to="/" class="text-xs text-zinc-500 hover:text-zinc-300 mb-4 inline-block">
      &larr; All sweeps
    </router-link>

    <div v-if="loading" class="text-zinc-500 text-sm">Loading...</div>
    <div v-else-if="!sweep" class="text-red-400 text-sm">Sweep not found</div>

    <template v-else>
      <div class="flex items-center gap-3 mb-6">
        <h1 class="text-xl font-semibold">{{ formatDate(sweep.startedAt) }}</h1>
        <span
          class="text-xs px-2 py-0.5 rounded font-medium"
          :class="sweep.exitReason === 'zero-critical-high' ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'"
        >
          {{ sweep.exitReason === "zero-critical-high" ? "Clean exit" : "Max rounds reached" }}
        </span>
        <span v-if="isTwoPass" class="text-xs text-zinc-500">two-pass</span>
      </div>

      <!-- Round tabs -->
      <div class="flex gap-1 mb-4">
        <button
          v-for="(round, i) in rounds"
          :key="round.round"
          @click="activeRound = i"
          class="px-3 py-1.5 text-xs rounded transition-colors"
          :class="activeRound === i ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'"
        >
          <template v-if="isTwoPass && round.pass">Pass {{ round.pass }}</template>
          <template v-else>Round {{ round.round }}</template>
        </button>
      </div>

      <!-- Round summary -->
      <div v-if="currentRound" class="mb-6">
        <div class="grid grid-cols-5 gap-4 text-sm border border-zinc-800 rounded-lg p-4 mb-4">
          <div>
            <span class="text-zinc-500 text-xs">Findings</span>
            <div class="font-mono text-lg">{{ currentRound.totalFindings }}</div>
          </div>
          <div>
            <span class="text-zinc-500 text-xs">Fixed</span>
            <div class="font-mono text-lg text-green-400">{{ currentRound.totalFixed }}</div>
          </div>
          <div>
            <span class="text-zinc-500 text-xs">Regressions</span>
            <div class="font-mono text-lg" :class="currentRound.totalRegressions > 0 ? 'text-red-400' : 'text-zinc-500'">
              {{ currentRound.totalRegressions }}
            </div>
          </div>
          <div>
            <span class="text-zinc-500 text-xs">Critical/High left</span>
            <div class="font-mono text-lg" :class="currentRound.criticalHighRemaining > 0 ? 'text-orange-400' : 'text-zinc-500'">
              {{ currentRound.criticalHighRemaining }}
            </div>
          </div>
          <div>
            <span class="text-zinc-500 text-xs">Duration</span>
            <div class="font-mono text-lg">{{ formatDuration(currentRound.durationMs) }}</div>
          </div>
        </div>

        <!-- Layer cards -->
        <div class="space-y-2">
          <LayerCard
            v-for="layer in currentRound.layers"
            :key="layer.layer"
            :result="layer"
            :sweep-index="parseInt(props.index, 10)"
            :clickable="layer.findings > 0"
          />
        </div>
      </div>

      <!-- Remaining findings -->
      <div v-if="sweep.remaining.length > 0" class="mt-8">
        <h2 class="text-lg font-semibold mb-3">
          Remaining findings
          <span class="text-sm font-normal text-zinc-500">({{ sweep.remaining.length }})</span>
        </h2>
        <div class="space-y-1">
          <div
            v-for="item in sweep.remaining"
            :key="item.clusterId"
            class="flex items-start gap-2 border border-zinc-800 rounded p-3 text-sm"
          >
            <SeverityBadge :severity="item.severity" />
            <div class="flex-1 min-w-0">
              <span class="font-mono text-zinc-300">{{ item.file }}</span>
              <span v-if="item.line" class="text-zinc-500">:{{ item.line }}</span>
              <span class="text-zinc-500 ml-2 text-xs">{{ item.category }}</span>
              <p class="text-xs text-zinc-400 mt-0.5">{{ item.rationale }}</p>
              <span class="text-xs text-zinc-600">{{ item.reason }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
