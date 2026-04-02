import { log } from "../logger/index.js";
import type { SummarizerProvider } from "./provider.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ENV_KEY = "OPENROUTER_API_KEY";

/**
 * Summarizer provider that routes through OpenRouter's OpenAI-compatible API.
 * Model names follow OpenRouter convention: "org/model" (e.g. "openai/gpt-4o-mini").
 */
export class OpenRouterProvider implements SummarizerProvider {
  readonly name = "openrouter";
  constructor(
    private readonly model: string,
  ) {}

  async isAvailable(): Promise<boolean> {
    const key = process.env[ENV_KEY];
    return typeof key === "string" && key.length > 0;
  }

  async complete(prompt: string): Promise<string | null> {
    const apiKey = process.env[ENV_KEY];
    if (!apiKey) return null;

    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 150,
        }),
      });

      if (!res.ok) {
        log("warn", "OpenRouter request failed", {
          status: res.status,
          model: this.model,
        });
        return null;
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      return data.choices?.[0]?.message?.content?.trim() ?? null;
    } catch (err) {
      log("warn", "OpenRouter summary failed", {
        error: String(err),
        model: this.model,
      });
      return null;
    }
  }
}
