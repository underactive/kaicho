import { log } from "../logger/index.js";

/**
 * Minimal interface for a summarizer LLM provider.
 * Each provider checks availability and generates a single completion.
 */
export interface SummarizerProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  complete(prompt: string): Promise<string | null>;
}

export interface ParsedModel {
  provider: "ollama" | "openrouter";
  model: string;
}

const KNOWN_PROVIDERS = new Set(["openrouter"]);

/**
 * Parse a model string into provider + model name.
 *
 * Format: "provider:model" or bare "model" (defaults to ollama).
 * Only recognized provider prefixes are extracted — unknown prefixes
 * are treated as Ollama model tags (e.g. "gemma3:1b").
 */
export function parseModelSpec(modelStr: string): ParsedModel {
  const colonIdx = modelStr.indexOf(":");
  if (colonIdx === -1) {
    return { provider: "ollama", model: modelStr };
  }

  const prefix = modelStr.slice(0, colonIdx);
  if (KNOWN_PROVIDERS.has(prefix)) {
    const model = modelStr.slice(colonIdx + 1);
    if (!model) {
      throw new Error(`Invalid model spec: "${modelStr}". Expected "provider:model".`);
    }
    return { provider: prefix as ParsedModel["provider"], model };
  }

  // Colon present but not a known provider — Ollama tag (e.g. "gemma3:1b")
  return { provider: "ollama", model: modelStr };
}

/**
 * Instantiate the right provider for a parsed model spec.
 */
export async function resolveProvider(
  parsed: ParsedModel,
  ollamaUrl?: string,
): Promise<SummarizerProvider> {
  switch (parsed.provider) {
    case "openrouter": {
      const { OpenRouterProvider } = await import("./openrouter.js");
      return new OpenRouterProvider(parsed.model);
    }
    case "ollama": {
      const { OllamaProvider } = await import("./ollama.js");
      return new OllamaProvider(parsed.model, ollamaUrl);
    }
    default: {
      log("warn", "Unknown summarizer provider, falling back to Ollama", {
        provider: (parsed as ParsedModel).provider,
      });
      const { OllamaProvider } = await import("./ollama.js");
      return new OllamaProvider(parsed.model, ollamaUrl);
    }
  }
}
