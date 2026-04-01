import { ref, onMounted } from "vue";
import type { SweepReport } from "../types";
import { api } from "../api";

export function useSweeps() {
  const sweeps = ref<SweepReport[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  onMounted(async () => {
    try {
      sweeps.value = await api.sweeps();
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Failed to load sweeps";
    } finally {
      loading.value = false;
    }
  });

  return { sweeps, loading, error };
}
