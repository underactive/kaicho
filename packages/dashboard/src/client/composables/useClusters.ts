import { ref, onMounted, watch, type Ref } from "vue";
import type { SuggestionCluster } from "../types";
import { api } from "../api";

export function useClusters(filter?: { task?: Ref<string> }) {
  const clusters = ref<SuggestionCluster[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      clusters.value = await api.clusters({
        task: filter?.task?.value || undefined,
      });
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Failed to load clusters";
    } finally {
      loading.value = false;
    }
  }

  onMounted(load);

  if (filter?.task) watch(filter.task, load);

  return { clusters, loading, error, reload: load };
}
