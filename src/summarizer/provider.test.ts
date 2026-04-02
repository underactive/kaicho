import { describe, it, expect } from "vitest";
import { parseModelSpec } from "./provider.js";

describe("parseModelSpec", () => {
  it("treats bare name as Ollama", () => {
    expect(parseModelSpec("llama3")).toEqual({
      provider: "ollama",
      model: "llama3",
    });
  });

  it("treats Ollama-style tag as Ollama", () => {
    expect(parseModelSpec("gemma3:1b")).toEqual({
      provider: "ollama",
      model: "gemma3:1b",
    });
  });

  it("treats unknown prefix as Ollama model tag", () => {
    expect(parseModelSpec("mistral:7b")).toEqual({
      provider: "ollama",
      model: "mistral:7b",
    });
  });

  it("parses openrouter prefix", () => {
    expect(parseModelSpec("openrouter:openai/gpt-4o-mini")).toEqual({
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
    });
  });

  it("parses openrouter with anthropic model", () => {
    expect(parseModelSpec("openrouter:anthropic/claude-haiku-4-5-20251001")).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-haiku-4-5-20251001",
    });
  });

  it("parses openrouter with google model", () => {
    expect(parseModelSpec("openrouter:google/gemini-2.0-flash")).toEqual({
      provider: "openrouter",
      model: "google/gemini-2.0-flash",
    });
  });

  it("throws on empty model after openrouter prefix", () => {
    expect(() => parseModelSpec("openrouter:")).toThrow("Invalid model spec");
  });

  it("preserves colons in Ollama model with multiple colons", () => {
    expect(parseModelSpec("qwen3:1.7b")).toEqual({
      provider: "ollama",
      model: "qwen3:1.7b",
    });
  });
});
