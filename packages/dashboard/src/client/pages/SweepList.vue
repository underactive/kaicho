<script setup lang="ts">
import { computed } from "vue";
import { useSweeps } from "../composables/useSweeps";
import type { SweepReport } from "../types";
import LayerChart from "../components/LayerChart.vue";
import NeedsReviewChart from "../components/NeedsReviewChart.vue";

const { sweeps, loading, error } = useSweeps();

const latest = computed<SweepReport | null>(() => sweeps.value[0] ?? null);
const older = computed(() => sweeps.value.slice(1));

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function totalDuration(sweep: SweepReport): number {
  return sweep.rounds.reduce((sum, r) => sum + r.durationMs, 0);
}

function totalFindings(sweep: SweepReport): number {
  return sweep.rounds.reduce((sum, r) => sum + r.totalFindings, 0);
}

function totalFixed(sweep: SweepReport): number {
  return sweep.rounds.reduce((sum, r) => sum + r.totalFixed, 0);
}

function fixRate(sweep: SweepReport): number {
  const found = totalFindings(sweep);
  if (found === 0) return 100;
  return Math.round((totalFixed(sweep) / found) * 100);
}

function needsReview(sweep: SweepReport): number {
  return totalFindings(sweep) - totalFixed(sweep);
}
</script>

<template>
  <div>
    <div v-if="loading" class="text-zinc-500 text-sm py-12 text-center">Loading...</div>
    <div v-else-if="error" class="text-red-400 text-sm">{{ error }}</div>
    <div v-else-if="sweeps.length === 0" class="text-center py-16">
      <p class="text-zinc-500 text-lg mb-2">No sweep data yet</p>
      <p class="text-zinc-600 text-sm">Run <code class="text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded">kaicho sweep</code> on a repository to start.</p>
    </div>

    <template v-else-if="latest">
      <!-- Hero stats -->
      <div class="mb-8">
        <div class="flex items-baseline gap-3 mb-6">
          <h1 class="text-2xl font-bold">Latest Sweep</h1>
          <span class="text-sm text-zinc-500">{{ formatDate(latest.startedAt) }}</span>
          <span
            class="text-xs px-2 py-0.5 rounded font-medium"
            :class="latest.exitReason === 'zero-critical-high' ? 'bg-green-900/60 text-green-300' : 'bg-yellow-900/60 text-yellow-300'"
          >
            {{ latest.exitReason === "zero-critical-high" ? "Clean exit" : "Max rounds" }}
          </span>
          <span v-if="latest.strategy" class="text-xs text-zinc-600">{{ latest.strategy }}</span>
        </div>

        <div class="grid grid-cols-5 gap-4 mb-8">
          <div class="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30">
            <div class="text-xs text-zinc-500 uppercase tracking-wider mb-1">Issues Found</div>
            <div class="text-3xl font-bold tabular-nums">{{ totalFindings(latest) }}</div>
          </div>
          <div class="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30">
            <div class="text-xs text-zinc-500 uppercase tracking-wider mb-1">Auto-Fixed</div>
            <div class="text-3xl font-bold tabular-nums text-green-400">{{ totalFixed(latest) }}</div>
          </div>
          <div class="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30">
            <div class="text-xs text-zinc-500 uppercase tracking-wider mb-1">Needs Review</div>
            <div class="text-3xl font-bold tabular-nums" :class="needsReview(latest) === 0 ? 'text-green-400' : 'text-yellow-400'">
              {{ needsReview(latest) }}
            </div>
          </div>
          <div class="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30">
            <div class="text-xs text-zinc-500 uppercase tracking-wider mb-1">Fix Rate</div>
            <div class="text-3xl font-bold tabular-nums" :class="fixRate(latest) >= 80 ? 'text-green-400' : fixRate(latest) >= 50 ? 'text-yellow-400' : 'text-orange-400'">
              {{ fixRate(latest) }}%
            </div>
          </div>
          <div class="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30">
            <div class="text-xs text-zinc-500 uppercase tracking-wider mb-1">Duration</div>
            <div class="text-3xl font-bold tabular-nums text-zinc-300">{{ formatDuration(totalDuration(latest)) }}</div>
          </div>
        </div>
      </div>

      <!-- Charts -->
      <div class="grid grid-cols-3 gap-6 mb-8">
        <div class="col-span-2 border border-zinc-800 rounded-xl p-5 bg-zinc-900/30">
          <h2 class="text-sm font-medium text-zinc-400 mb-4">Issues Found vs Fixed by Layer</h2>
          <LayerChart :sweep="latest" />
        </div>
        <div class="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30">
          <h2 class="text-sm font-medium text-zinc-400 mb-4">Needs Review by Layer</h2>
          <NeedsReviewChart :sweep="latest" />
        </div>
      </div>

      <!-- Link to detail -->
      <div class="mb-10">
        <router-link
          to="/sweeps/0"
          class="inline-flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          View full sweep details &rarr;
        </router-link>
      </div>

      <!-- Previous sweeps -->
      <div v-if="older.length > 0">
        <h2 class="text-lg font-semibold mb-3 text-zinc-400">Previous Sweeps</h2>
        <div class="space-y-2">
          <router-link
            v-for="(sweep, i) in older"
            :key="sweep.startedAt"
            :to="`/sweeps/${i + 1}`"
            class="flex items-center justify-between border border-zinc-800 rounded-lg p-3 hover:border-zinc-600 transition-colors"
          >
            <div class="flex items-center gap-3">
              <span class="text-sm font-mono text-zinc-300">{{ formatDate(sweep.startedAt) }}</span>
              <span
                class="text-xs px-1.5 py-0.5 rounded"
                :class="sweep.exitReason === 'zero-critical-high' ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'"
              >
                {{ sweep.exitReason === "zero-critical-high" ? "Clean" : "Max rounds" }}
              </span>
            </div>
            <div class="flex items-center gap-6 text-xs text-zinc-500">
              <span>{{ totalFindings(sweep) }} found</span>
              <span class="text-green-400">{{ totalFixed(sweep) }} fixed</span>
              <span v-if="needsReview(sweep) > 0" class="text-yellow-400">{{ needsReview(sweep) }} to review</span>
              <span>{{ fixRate(sweep) }}%</span>
              <span>{{ formatDuration(totalDuration(sweep)) }}</span>
            </div>
          </router-link>
        </div>
      </div>
    </template>
  </div>
</template>
