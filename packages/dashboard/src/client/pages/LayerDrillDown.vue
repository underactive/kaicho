<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import type { SweepRemaining, SweepLayerResult, FixLogEntry } from "../types";
import { LAYER_LABELS, LAYER_TASKS, SEVERITY_TEXT_COLORS } from "../types";
import SeverityBadge from "../components/SeverityBadge.vue";
import SeverityBar from "../components/SeverityBar.vue";

const props = defineProps<{ index: string; layer: string }>();

const layerNum = computed(() => parseInt(props.layer, 10));
const tasks = computed(() => LAYER_TASKS[layerNum.value] ?? []);

interface LayerDetail {
  layer: number;
  tasks: string[];
  remaining: SweepRemaining[];
  layerResults: Array<{ round: number; pass?: 1 | 2; result: SweepLayerResult }>;
  fixLog: FixLogEntry[];
  sweepBranch: string;
}

const data = ref<LayerDetail | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const res = await fetch(`/api/sweeps/${props.index}/layers/${props.layer}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    data.value = await res.json();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load layer data";
  } finally {
    loading.value = false;
  }
});

// Aggregate stats across all rounds for this layer
const totalStats = computed(() => {
  if (!data.value) return { findings: 0, fixed: 0, skipped: 0, failed: 0 };
  return data.value.layerResults.reduce(
    (acc, r) => ({
      findings: acc.findings + (r.result?.findings ?? 0),
      fixed: acc.fixed + (r.result?.fixed ?? 0),
      skipped: acc.skipped + (r.result?.skipped ?? 0),
      failed: acc.failed + (r.result?.failed ?? 0),
    }),
    { findings: 0, fixed: 0, skipped: 0, failed: 0 },
  );
});

// Severity counts from remaining items
const severityCounts = computed(() => {
  if (!data.value) return {};
  const counts: Record<string, number> = {};
  for (const item of data.value.remaining) {
    counts[item.severity] = (counts[item.severity] ?? 0) + 1;
  }
  return counts;
});

// Group remaining items by file
const groupedByFile = computed(() => {
  if (!data.value) return [];
  const groups = new Map<string, SweepRemaining[]>();
  for (const item of data.value.remaining) {
    const existing = groups.get(item.file);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(item.file, [item]);
    }
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
});

const expanded = ref<string | null>(null);
function toggleItem(id: string) {
  expanded.value = expanded.value === id ? null : id;
}

// Branch detail expansion
interface BranchDetail {
  branch: string;
  commitMessage: string;
  diff: string;
  exists: boolean;
}

const expandedBranch = ref<string | null>(null);
const branchDetail = ref<BranchDetail | null>(null);
const branchLoading = ref(false);
const branchError = ref<string | null>(null);

async function toggleBranch(branch: string, clusterId: string) {
  const key = branch + clusterId;
  if (expandedBranch.value === key) {
    expandedBranch.value = null;
    return;
  }

  expandedBranch.value = key;

  // Check if the fix log entry already has inline diff data
  const entry = data.value?.fixLog.find((e) => e.clusterId === clusterId && e.branch === branch);
  if (entry?.diff) {
    // Data is inline — no git fetch needed
    return;
  }

  // Fall back to git branch lookup for older entries
  branchDetail.value = null;
  branchLoading.value = true;
  branchError.value = null;

  try {
    const sweepBranch = data.value?.sweepBranch ?? "";
    const params = new URLSearchParams();
    if (clusterId) params.set("clusterId", clusterId);
    if (sweepBranch) params.set("sweepBranch", sweepBranch);
    const qs = params.toString();

    const res = await fetch(`/api/fixed/branch/${encodeURIComponent(branch)}${qs ? `?${qs}` : ""}`);
    if (!res.ok) {
      branchError.value = res.status === 404 ? "Fix detail not available (branch deleted, data predates enriched fix log)" : `Error: ${res.status}`;
      return;
    }
    branchDetail.value = await res.json();
  } catch (e) {
    branchError.value = e instanceof Error ? e.message : "Failed to load branch detail";
  } finally {
    branchLoading.value = false;
  }
}

function diffLines(diff: string): string[] {
  return diff.split("\n");
}

function diffLineClass(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "text-green-400";
  if (line.startsWith("-") && !line.startsWith("---")) return "text-red-400";
  if (line.startsWith("@@")) return "text-cyan-400";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "text-zinc-500 font-bold";
  return "text-zinc-400";
}
</script>

<template>
  <div>
    <router-link :to="`/sweeps/${props.index}`" class="text-xs text-zinc-500 hover:text-zinc-300 mb-4 inline-block">
      &larr; Back to sweep
    </router-link>

    <h1 class="text-xl font-semibold mb-1">
      Layer {{ layerNum }}: {{ LAYER_LABELS[layerNum] ?? "Unknown" }}
    </h1>
    <p class="text-sm text-zinc-500 mb-4">
      Tasks: {{ tasks.join(", ") }}
    </p>

    <div v-if="loading" class="text-zinc-500 text-sm">Loading...</div>
    <div v-else-if="error" class="text-red-400 text-sm">{{ error }}</div>

    <template v-else-if="data">
      <!-- Aggregate stats from sweep report -->
      <div class="grid grid-cols-4 gap-4 text-sm border border-zinc-800 rounded-lg p-4 mb-4">
        <div>
          <span class="text-zinc-500 text-xs">Total found</span>
          <div class="font-mono text-lg">{{ totalStats.findings }}</div>
        </div>
        <div>
          <span class="text-zinc-500 text-xs">Fixed</span>
          <div class="font-mono text-lg text-green-400">{{ totalStats.fixed }}</div>
        </div>
        <div>
          <span class="text-zinc-500 text-xs">Skipped</span>
          <div class="font-mono text-lg text-zinc-400">{{ totalStats.skipped }}</div>
        </div>
        <div>
          <span class="text-zinc-500 text-xs">Failed</span>
          <div class="font-mono text-lg" :class="totalStats.failed > 0 ? 'text-red-400' : 'text-zinc-500'">
            {{ totalStats.failed }}
          </div>
        </div>
      </div>

      <!-- Per-round breakdown -->
      <div v-if="data.layerResults.length > 1" class="mb-6">
        <h2 class="text-sm font-medium text-zinc-400 mb-2">Per-round breakdown</h2>
        <div class="space-y-1">
          <div
            v-for="r in data.layerResults"
            :key="r.round"
            class="flex items-center gap-4 text-xs border border-zinc-800 rounded p-2"
          >
            <span class="text-zinc-500 w-20">
              {{ r.pass ? `Pass ${r.pass}` : `Round ${r.round}` }}
            </span>
            <span>Found <span class="font-mono">{{ r.result?.findings ?? 0 }}</span></span>
            <span>Fixed <span class="font-mono text-green-400">{{ r.result?.fixed ?? 0 }}</span></span>
            <span>Skipped <span class="font-mono">{{ r.result?.skipped ?? 0 }}</span></span>
          </div>
        </div>
      </div>

      <!-- Remaining (unfixed) findings -->
      <div v-if="data.remaining.length > 0" class="mb-6">
        <h2 class="text-lg font-semibold mb-1">
          Remaining findings
          <span class="text-sm font-normal text-zinc-500">({{ data.remaining.length }})</span>
        </h2>

        <div class="mb-4">
          <SeverityBar :counts="severityCounts" />
        </div>

        <div v-for="[file, items] in groupedByFile" :key="file" class="mb-4">
          <h3 class="text-sm font-mono text-zinc-400 mb-2">
            {{ file }}
            <span class="text-zinc-600">({{ items.length }})</span>
          </h3>
          <div class="space-y-1">
            <div
              v-for="item in items"
              :key="item.clusterId"
              class="border border-zinc-800 rounded-lg p-3 hover:border-zinc-700 transition-colors cursor-pointer"
              @click="toggleItem(item.clusterId)"
            >
              <div class="flex items-start gap-2">
                <SeverityBadge :severity="item.severity" />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 text-sm">
                    <span class="font-mono text-zinc-300">{{ item.file }}</span>
                    <span v-if="item.line" class="text-zinc-500">:{{ item.line }}</span>
                    <span class="text-xs text-zinc-600">{{ item.category }}</span>
                  </div>
                  <p class="text-xs text-zinc-300 mt-1" :class="expanded === item.clusterId ? '' : 'line-clamp-2'">
                    {{ item.rationale }}
                  </p>
                  <span class="text-xs mt-1 inline-block" :class="{
                    'text-yellow-600': item.reason === 'not-fixed',
                    'text-red-600': item.reason === 'fix-failed',
                    'text-zinc-600': item.reason === 'no-changes',
                  }">
                    {{ item.reason }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Fixed items with expandable branch detail -->
      <div v-if="totalStats.fixed > 0" class="mb-6">
        <h2 class="text-lg font-semibold mb-2">
          Fixed
          <span class="text-sm font-normal text-green-400">({{ totalStats.fixed }})</span>
        </h2>
        <p class="text-xs text-zinc-500 mb-3">
          Click to view commit message and diff from the fix branch.
        </p>
        <div v-if="data.fixLog.length > 0" class="space-y-1">
          <div
            v-for="entry in data.fixLog"
            :key="`${entry.clusterId}-${entry.branch}`"
            class="border border-zinc-800 rounded-lg overflow-hidden"
          >
            <div
              class="flex items-center gap-3 text-xs p-3 cursor-pointer hover:bg-zinc-900 transition-colors"
              @click="toggleBranch(entry.branch, entry.clusterId)"
            >
              <span class="text-green-400 font-medium">FIXED</span>
              <SeverityBadge v-if="entry.severity" :severity="entry.severity" />
              <span class="font-mono text-zinc-300">{{ entry.file }}</span>
              <span v-if="entry.line" class="text-zinc-500">:{{ entry.line }}</span>
              <span v-if="entry.category" class="text-zinc-600">{{ entry.category }}</span>
              <span class="text-zinc-500">by {{ entry.agent }}</span>
              <span class="text-zinc-600 ml-auto font-mono">{{ entry.branch }}</span>
              <span class="text-zinc-700 text-xs">{{ expandedBranch === entry.branch + entry.clusterId ? '▼' : '▶' }}</span>
            </div>
            <!-- Inline rationale (always visible if available) -->
            <div v-if="entry.rationale" class="px-3 pb-2 text-xs text-zinc-400 line-clamp-2">
              {{ entry.rationale }}
            </div>
            <div v-if="expandedBranch === entry.branch + entry.clusterId" class="border-t border-zinc-800 bg-zinc-900/50">
              <!-- Show inline diff from fix log entry first (always available for new fixes) -->
              <template v-if="entry.diff">
                <div class="p-3">
                  <span class="text-xs text-zinc-500">Diff</span>
                  <pre class="text-xs mt-1 overflow-x-auto max-h-96 overflow-y-auto font-mono leading-relaxed"><template v-for="(line, i) in diffLines(entry.diff)" :key="i"><span :class="diffLineClass(line)">{{ line }}
</span></template></pre>
                </div>
              </template>
              <!-- Fall back to git branch lookup for older entries without inline data -->
              <template v-else>
                <div v-if="branchLoading" class="p-3 text-xs text-zinc-500">Loading from git...</div>
                <div v-else-if="branchError" class="p-3 text-xs text-red-400">{{ branchError }}</div>
                <div v-else-if="branchDetail">
                  <div v-if="branchDetail.source === 'sweep-branch'" class="px-3 pt-2">
                    <span class="text-xs text-zinc-600 italic">Recovered from sweep branch</span>
                  </div>
                  <div v-if="branchDetail.commitMessage" class="p-3 border-b border-zinc-800">
                    <span class="text-xs text-zinc-500">Commit message</span>
                    <pre class="text-xs text-zinc-300 mt-1 whitespace-pre-wrap">{{ branchDetail.commitMessage }}</pre>
                  </div>
                  <div v-if="branchDetail.diff" class="p-3">
                    <span class="text-xs text-zinc-500">Diff</span>
                    <pre class="text-xs mt-1 overflow-x-auto max-h-96 overflow-y-auto font-mono leading-relaxed"><template v-for="(line, i) in diffLines(branchDetail.diff)" :key="i"><span :class="diffLineClass(line)">{{ line }}
</span></template></pre>
                  </div>
                  <div v-if="!branchDetail.commitMessage && !branchDetail.diff" class="p-3 text-xs text-zinc-500">
                    Fix detail not available (branch deleted, data not in fix log).
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <div v-if="data.remaining.length === 0 && totalStats.findings === 0" class="text-zinc-500 text-sm">
        No findings for this layer.
      </div>
    </template>
  </div>
</template>
