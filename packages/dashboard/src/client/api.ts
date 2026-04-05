import type { SweepReport, RunRecord, SuggestionCluster, FixLogEntry, DiscardedFixEntry } from "./types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  sweeps: () => get<SweepReport[]>("/sweeps"),
  runs: (filter?: { task?: string; agent?: string }) => {
    const params = new URLSearchParams();
    if (filter?.task) params.set("task", filter.task);
    if (filter?.agent) params.set("agent", filter.agent);
    const qs = params.toString();
    return get<RunRecord[]>(`/runs${qs ? `?${qs}` : ""}`);
  },
  clusters: (filter?: { task?: string; minSeverity?: string }) => {
    const params = new URLSearchParams();
    if (filter?.task) params.set("task", filter.task);
    if (filter?.minSeverity) params.set("minSeverity", filter.minSeverity);
    const qs = params.toString();
    return get<SuggestionCluster[]>(`/clusters${qs ? `?${qs}` : ""}`);
  },
  fixed: () => get<FixLogEntry[]>("/fixed"),
  discarded: () => get<DiscardedFixEntry[]>("/discarded"),
};
