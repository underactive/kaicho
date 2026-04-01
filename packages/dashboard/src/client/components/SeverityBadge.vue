<script setup lang="ts">
import { SEVERITY_COLORS } from "../types";

const props = defineProps<{ severity: string }>();
const colorClass = SEVERITY_COLORS[props.severity] ?? "bg-zinc-600";
</script>

<template>
  <span
    class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white uppercase tracking-wide"
    :class="colorClass"
  >
    {{ severity }}
  </span>
</template>
