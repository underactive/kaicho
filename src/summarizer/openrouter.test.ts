import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenRouterProvider } from "./openrouter.js";

describe("OpenRouterProvider", () => {
  const originalEnv = process.env["OPENROUTER_API_KEY"];

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv !== undefined) {
      process.env["OPENROUTER_API_KEY"] = originalEnv;
    } else {
      delete process.env["OPENROUTER_API_KEY"];
    }
  });

  describe("isAvailable", () => {
    it("returns false when env var is unset", async () => {
      delete process.env["OPENROUTER_API_KEY"];
      const provider = new OpenRouterProvider("openai/gpt-4o-mini");
      expect(await provider.isAvailable()).toBe(false);
    });

    it("returns false when env var is empty", async () => {
      process.env["OPENROUTER_API_KEY"] = "";
      const provider = new OpenRouterProvider("openai/gpt-4o-mini");
      expect(await provider.isAvailable()).toBe(false);
    });

    it("returns true when env var is set", async () => {
      process.env["OPENROUTER_API_KEY"] = "sk-or-test-key";
      const provider = new OpenRouterProvider("openai/gpt-4o-mini");
      expect(await provider.isAvailable()).toBe(true);
    });
  });

  describe("complete", () => {
    beforeEach(() => {
      process.env["OPENROUTER_API_KEY"] = "sk-or-test-key";
    });

    it("returns null when API key is missing", async () => {
      delete process.env["OPENROUTER_API_KEY"];
      const provider = new OpenRouterProvider("openai/gpt-4o-mini");
      expect(await provider.complete("test prompt")).toBeNull();
    });

    it("sends correct request and extracts response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "  A concise summary.  " } }],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const provider = new OpenRouterProvider("openai/gpt-4o-mini");
      const result = await provider.complete("Summarize this");

      expect(result).toBe("A concise summary.");
      expect(mockFetch).toHaveBeenCalledOnce();

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(opts.method).toBe("POST");
      expect(opts.headers["Authorization"]).toBe("Bearer sk-or-test-key");

      const body = JSON.parse(opts.body);
      expect(body.model).toBe("openai/gpt-4o-mini");
      expect(body.messages).toEqual([{ role: "user", content: "Summarize this" }]);
      expect(body.max_tokens).toBe(150);
    });

    it("returns null on non-ok response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      }));

      const provider = new OpenRouterProvider("openai/gpt-4o-mini");
      expect(await provider.complete("test")).toBeNull();
    });

    it("returns null on network error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

      const provider = new OpenRouterProvider("openai/gpt-4o-mini");
      expect(await provider.complete("test")).toBeNull();
    });

    it("returns null on malformed response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [] }),
      }));

      const provider = new OpenRouterProvider("openai/gpt-4o-mini");
      expect(await provider.complete("test")).toBeNull();
    });
  });
});
