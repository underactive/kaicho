import { ref, onMounted, watch, type Ref } from "vue";
import type { RunRecord } from "../types";
import { api } from "../api";

export function useRuns(filter?: { task?: Ref<string>; agent?: Ref<string> }) {
  const runs = ref<RunRecord[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      runs.value = await api.runs({
        task: filter?.task?.value || undefined,
        agent: filter?.agent?.value || undefined,
      });
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Failed to load runs";
    } finally {
      loading.value = false;
    }
  }

  onMounted(load);

  if (filter?.task) watch(filter.task, load);
  if (filter?.agent) watch(filter.agent, load);

  return { runs, loading, error, reload: load };
}
