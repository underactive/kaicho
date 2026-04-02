import { SqliteStore } from "../suggestion-store/index.js";
import { log } from "../logger/index.js";
import type { SuggestionCluster } from "../dedup/index.js";
import type { SummarizerProvider } from "./provider.js";
import { parseModelSpec, resolveProvider } from "./provider.js";

const DEFAULT_MODEL = "gemma3:1b";
const DEFAULT_URL = "http://localhost:11434";

export interface SummarizerProgress {
  current: number;
  total: number;
  clusterId: string;
  file: string;
  status: "started" | "done" | "skipped" | "failed";
}

export interface SummarizerOptions {
  model?: string;
  ollamaUrl?: string;
  onProgress?: (progress: SummarizerProgress) => void;
}

/**
 * Ollama-backed summarizer provider (local LLM).
 */
export class OllamaProvider implements SummarizerProvider {
  readonly name = "ollama";
  constructor(
    private readonly model: string = DEFAULT_MODEL,
    private readonly url: string = DEFAULT_URL,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/api/tags`);
      if (!res.ok) return false;
      const data = await res.json() as { models?: Array<{ name: string }> };
      return data.models?.some(
        (m) => m.name === this.model || m.name.startsWith(this.model.split(":")[0] + ":"),
      ) ?? false;
    } catch {
      return false;
    }
  }

  async complete(prompt: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
        }),
      });

      if (!res.ok) return null;

      const data = await res.json() as { message?: { content?: string } };
      return data.message?.content?.trim() ?? null;
    } catch (err) {
      log("warn", "Ollama summary failed", { error: String(err), model: this.model });
      return null;
    }
  }
}

/**
 * Check if Ollama is running and the model is available.
 * Kept for backward compatibility — delegates to OllamaProvider.
 */
export async function isOllamaAvailable(options: SummarizerOptions = {}): Promise<boolean> {
  const provider = new OllamaProvider(
    options.model ?? DEFAULT_MODEL,
    options.ollamaUrl ?? DEFAULT_URL,
  );
  return provider.isAvailable();
}

/**
 * Summarize a single cluster using the given provider.
 */
async function summarizeOne(
  cluster: SuggestionCluster,
  provider: SummarizerProvider,
): Promise<string | null> {
  const rationales = cluster.rationales
    .map((r) => `${r.agent}: ${r.rationale}`)
    .join("\n");

  const prompt = `Summarize this code finding in exactly one sentence. Be concise and specific. No preamble.\n\n${rationales}`;
  return provider.complete(prompt);
}

/**
 * Enrich an array of clusters with LLM-generated summaries.
 * Skips clusters that already have summaries.
 * Returns the number of summaries generated.
 */
export async function summarizeClusters(
  clusters: SuggestionCluster[],
  options: SummarizerOptions = {},
): Promise<number> {
  const modelStr = options.model ?? DEFAULT_MODEL;
  const parsed = parseModelSpec(modelStr);
  const provider = await resolveProvider(parsed, options.ollamaUrl);

  const available = await provider.isAvailable();
  if (!available) {
    log("info", "Summarizer not available, skipping summaries", {
      provider: parsed.provider,
      model: parsed.model,
    });
    return 0;
  }

  const pending = clusters.filter((c) => !c.summary);
  const total = pending.length;
  let count = 0;

  for (let i = 0; i < pending.length; i++) {
    const cluster = pending[i]!;

    options.onProgress?.({
      current: i + 1,
      total,
      clusterId: cluster.id,
      file: cluster.file,
      status: "started",
    });

    const summary = await summarizeOne(cluster, provider);
    if (summary) {
      cluster.summary = summary;
      count++;
      options.onProgress?.({
        current: i + 1,
        total,
        clusterId: cluster.id,
        file: cluster.file,
        status: "done",
      });
    } else {
      options.onProgress?.({
        current: i + 1,
        total,
        clusterId: cluster.id,
        file: cluster.file,
        status: "failed",
      });
    }
  }

  log("info", "Generated summaries", { count, total });
  return count;
}

/**
 * Persist enriched summaries to the SQLite store so report/fix can load them.
 */
export async function saveEnrichedCache(
  repoPath: string,
  clusters: SuggestionCluster[],
  task?: string,
): Promise<void> {
  const entries = clusters
    .filter((c) => c.summary)
    .map((c) => ({ id: c.id, file: c.file, summary: c.summary! }));

  if (entries.length === 0) return;

  const store = new SqliteStore(repoPath);
  try {
    for (const e of entries) {
      store.saveEnrichment(e.id, e.file, e.summary, "auto", task);
    }
  } finally {
    store.close();
  }
}
