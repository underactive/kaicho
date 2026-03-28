import { describe, it, expect } from "vitest";
import { parseAgentSpec, getBase, resolveModel } from "./agent-spec.js";

describe("parseAgentSpec", () => {
  it("parses a bare agent name", () => {
    const spec = parseAgentSpec("cursor");
    expect(spec).toEqual({
      fullName: "cursor",
      base: "cursor",
      variant: undefined,
      model: undefined,
    });
  });

  it("parses a variant with model", () => {
    const spec = parseAgentSpec("cursor:gemini-3.1-pro");
    expect(spec).toEqual({
      fullName: "cursor:gemini-3.1-pro",
      base: "cursor",
      variant: "gemini-3.1-pro",
      model: "gemini-3.1-pro",
    });
  });

  it("handles variant with multiple colons (only splits on first)", () => {
    const spec = parseAgentSpec("claude:model:v2");
    expect(spec).toEqual({
      fullName: "claude:model:v2",
      base: "claude",
      variant: "model:v2",
      model: "model:v2",
    });
  });

  it("throws on empty base", () => {
    expect(() => parseAgentSpec(":foo")).toThrow("Invalid agent variant");
  });

  it("throws on empty variant", () => {
    expect(() => parseAgentSpec("cursor:")).toThrow("Invalid agent variant");
  });

  it("throws on bare colon", () => {
    expect(() => parseAgentSpec(":")).toThrow("Invalid agent variant");
  });
});

describe("getBase", () => {
  it("returns the name for bare agents", () => {
    expect(getBase("claude")).toBe("claude");
  });

  it("strips the variant", () => {
    expect(getBase("cursor:gemini-3.1-pro")).toBe("cursor");
  });
});

describe("resolveModel", () => {
  it("returns undefined when no models map", () => {
    expect(resolveModel("cursor:gemini-3.1-pro")).toBeUndefined();
  });

  it("returns undefined when agent not in map", () => {
    expect(resolveModel("cursor:gemini-3.1-pro", { claude: "opus" })).toBeUndefined();
  });

  it("returns exact match for variant name", () => {
    const models = {
      "cursor:gemini-3.1-pro": "custom-model",
      cursor: "default-cursor-model",
    };
    expect(resolveModel("cursor:gemini-3.1-pro", models)).toBe("custom-model");
  });

  it("falls back to base name for variants", () => {
    const models = { cursor: "default-cursor-model" };
    expect(resolveModel("cursor:gemini-3.1-pro", models)).toBe("default-cursor-model");
  });

  it("does not fall back for bare names", () => {
    const models = { claude: "opus" };
    expect(resolveModel("cursor", models)).toBeUndefined();
  });

  it("returns exact match for bare names", () => {
    const models = { cursor: "some-model" };
    expect(resolveModel("cursor", models)).toBe("some-model");
  });
});
