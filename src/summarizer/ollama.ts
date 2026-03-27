import { log } from "../logger/index.js";
import type { SuggestionCluster } from "../dedup/index.js";

const DEFAULT_MODEL = "qwen3:1.7b";
const DEFAULT_URL = "http://localhost:11434";

export interface SummarizerOptions {
  model?: string;
  ollamaUrl?: string;
}

/**
 * Check if Ollama is running and the model is available.
 */
export async function isOllamaAvailable(options: SummarizerOptions = {}): Promise<boolean> {
  const url = options.ollamaUrl ?? DEFAULT_URL;
  try {
    const res = await fetch(`${url}/api/tags`);
    if (!res.ok) return false;
    const data = await res.json() as { models?: Array<{ name: string }> };
    const model = options.model ?? DEFAULT_MODEL;
    const available = data.models?.some((m) => m.name === model || m.name.startsWith(model.split(":")[0] + ":")) ?? false;
    return available;
  } catch {
    return false;
  }
}

/**
 * Summarize a single cluster's rationales into one sentence using a local LLM.
 */
async function summarizeOne(
  cluster: SuggestionCluster,
  options: SummarizerOptions,
): Promise<string | null> {
  const url = options.ollamaUrl ?? DEFAULT_URL;
  const model = options.model ?? DEFAULT_MODEL;

  const rationales = cluster.rationales
    .map((r) => `${r.agent}: ${r.rationale}`)
    .join("\n");

  try {
    const res = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: `Summarize this code finding in exactly one sentence. Be concise and specific. No preamble.\n\n${rationales}`,
          },
        ],
        stream: false,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      message?: { content?: string };
    };

    const content = data.message?.content?.trim();
    if (!content) return null;

    return content;
  } catch (err) {
    log("warn", "Ollama summary failed", { error: String(err), cluster: cluster.id });
    return null;
  }
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
  const available = await isOllamaAvailable(options);
  if (!available) {
    const model = options.model ?? DEFAULT_MODEL;
    log("info", "Ollama not available, skipping summaries", { model });
    return 0;
  }

  let count = 0;
  for (const cluster of clusters) {
    if (cluster.summary) continue;

    const summary = await summarizeOne(cluster, options);
    if (summary) {
      cluster.summary = summary;
      count++;
    }
  }

  log("info", "Generated summaries", { count, total: clusters.length });
  return count;
}
