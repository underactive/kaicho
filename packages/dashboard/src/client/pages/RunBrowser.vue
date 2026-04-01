<script setup lang="ts">
import { ref, computed } from "vue";
import { useRuns } from "../composables/useRuns";
import SeverityBadge from "../components/SeverityBadge.vue";
import type { RunRecord } from "../types";

const taskFilter = ref("");
const agentFilter = ref("");

const { runs, loading, error } = useRuns({
  task: taskFilter,
  agent: agentFilter,
});

// Extract unique agents and tasks for filter dropdowns
const agents = computed(() => [...new Set(runs.value.map((r) => r.agent))].sort());
const tasks = computed(() => [...new Set(runs.value.map((r) => r.task))].sort());

const expandedRun = ref<string | null>(null);

function toggleRun(runId: string) {
  expandedRun.value = expandedRun.value === runId ? null : runId;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function statusColor(status: string): string {
  if (status === "success") return "text-green-400";
  if (status === "timeout") return "text-yellow-400";
  return "text-red-400";
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold mb-4">Agent Runs</h1>

    <!-- Filters -->
    <div class="flex gap-3 mb-4">
      <select
        v-model="agentFilter"
        class="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:border-zinc-500"
      >
        <option value="">All agents</option>
        <option v-for="a in agents" :key="a" :value="a">{{ a }}</option>
      </select>
      <select
        v-model="taskFilter"
        class="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:border-zinc-500"
      >
        <option value="">All tasks</option>
        <option v-for="t in tasks" :key="t" :value="t">{{ t }}</option>
      </select>
    </div>

    <div v-if="loading" class="text-zinc-500 text-sm">Loading...</div>
    <div v-else-if="error" class="text-red-400 text-sm">{{ error }}</div>
    <div v-else-if="runs.length === 0" class="text-zinc-500 text-sm">
      No run records found.
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="run in runs"
        :key="run.runId"
        class="border border-zinc-800 rounded-lg overflow-hidden"
      >
        <!-- Run header -->
        <div
          class="p-3 flex items-center gap-3 cursor-pointer hover:bg-zinc-900 transition-colors"
          @click="toggleRun(run.runId)"
        >
          <span class="text-sm font-medium w-20">{{ run.agent }}</span>
          <span class="text-xs text-zinc-500 w-24">{{ run.task }}</span>
          <span class="text-xs font-mono" :class="statusColor(run.status)">{{ run.status }}</span>
          <span class="text-xs font-mono text-zinc-400">{{ run.suggestionCount }} findings</span>
          <span class="text-xs text-zinc-500 ml-auto">{{ formatDuration(run.durationMs) }}</span>
          <span class="text-xs text-zinc-600">{{ formatDate(run.startedAt) }}</span>
        </div>

        <!-- Expanded: suggestions -->
        <div v-if="expandedRun === run.runId" class="border-t border-zinc-800 p-3 space-y-2 bg-zinc-900/50">
          <div v-if="run.error" class="text-xs text-red-400 mb-2">{{ run.error }}</div>
          <div
            v-for="(s, i) in run.suggestions"
            :key="i"
            class="flex items-start gap-2 text-xs"
          >
            <SeverityBadge :severity="s.severity" />
            <div class="flex-1 min-w-0">
              <span class="font-mono text-zinc-300">{{ s.file }}</span>
              <span v-if="s.line" class="text-zinc-500">:{{ s.line }}</span>
              <span class="text-zinc-500 ml-2">{{ s.category }}</span>
              <p class="text-zinc-400 mt-0.5">{{ s.rationale }}</p>
              <pre v-if="s.suggestedChange" class="text-green-300 bg-zinc-900 rounded p-1.5 mt-1 overflow-x-auto text-xs">{{ s.suggestedChange }}</pre>
            </div>
          </div>
          <div v-if="run.suggestions.length === 0" class="text-zinc-600 text-xs">
            No suggestions in this run.
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
