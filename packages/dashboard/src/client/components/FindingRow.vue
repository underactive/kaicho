<script setup lang="ts">
import { ref } from "vue";
import type { SuggestionCluster } from "../types";
import SeverityBadge from "./SeverityBadge.vue";

defineProps<{
  cluster: SuggestionCluster;
}>();

const expanded = ref(false);
</script>

<template>
  <div
    class="border border-zinc-800 rounded-lg p-3 hover:border-zinc-700 transition-colors cursor-pointer"
    @click="expanded = !expanded"
  >
    <div class="flex items-start gap-2">
      <SeverityBadge :severity="cluster.severity" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 text-sm">
          <span class="font-mono text-zinc-300 truncate">{{ cluster.file }}</span>
          <span v-if="cluster.line" class="text-zinc-500">:{{ cluster.line }}</span>
          <span v-if="cluster.fixed" class="text-green-400 text-xs font-medium">FIXED</span>
        </div>
        <div class="text-xs text-zinc-400 mt-1">
          <span class="text-zinc-500">{{ cluster.category }}</span>
          <span class="mx-1 text-zinc-700">|</span>
          <span>{{ cluster.agents.join(", ") }}</span>
          <span v-if="cluster.agreement > 1" class="ml-1 text-zinc-500">
            ({{ cluster.agreement }} agents agree)
          </span>
        </div>
        <p class="text-xs text-zinc-300 mt-1 line-clamp-2">
          {{ cluster.rationales[0]?.rationale }}
        </p>
      </div>
    </div>

    <div v-if="expanded" class="mt-3 pl-4 border-l border-zinc-800 space-y-2">
      <div v-for="r in cluster.rationales" :key="r.agent" class="text-xs">
        <span class="text-zinc-500 font-medium">{{ r.agent }}:</span>
        <span class="text-zinc-300 ml-1">{{ r.rationale }}</span>
      </div>
      <div v-if="cluster.suggestedChange" class="mt-2">
        <span class="text-xs text-zinc-500">Suggested change:</span>
        <pre class="text-xs text-green-300 bg-zinc-900 rounded p-2 mt-1 overflow-x-auto">{{ cluster.suggestedChange }}</pre>
      </div>
    </div>
  </div>
</template>
