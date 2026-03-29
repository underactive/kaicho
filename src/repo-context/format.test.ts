import { describe, it, expect } from "vitest";
import { formatRepoContext } from "./format.js";
import type { RepoContext } from "./fingerprint.js";

function emptyContext(): RepoContext {
  return {
    languages: [],
    frameworks: [],
    testRunners: [],
    linters: [],
    entryPoints: [],
    packageManager: null,
    monorepoTool: null,
    architectureDocs: [],
  };
}

describe("formatRepoContext", () => {
  it("returns empty string for empty context", () => {
    expect(formatRepoContext(emptyContext())).toBe("");
  });

  it("formats full context with all fields", () => {
    const ctx: RepoContext = {
      languages: [
        { name: "TypeScript", source: "tsconfig.json" },
        { name: "JavaScript", source: "package.json" },
      ],
      frameworks: [{ name: "Next.js", source: "package.json" }],
      testRunners: [{ name: "vitest", source: "package.json" }],
      linters: [
        { name: "eslint", source: "package.json" },
        { name: "prettier", source: ".prettierrc" },
      ],
      entryPoints: ["src/index.ts"],
      packageManager: "pnpm",
      monorepoTool: "pnpm workspaces",
      architectureDocs: ["CLAUDE.md", "README.md"],
    };

    const result = formatRepoContext(ctx);

    expect(result).toContain("PROJECT CONTEXT");
    expect(result).toContain("best-effort");
    expect(result).toContain("- Languages: TypeScript, JavaScript");
    expect(result).toContain("- Frameworks: Next.js");
    expect(result).toContain("- Test runner: vitest");
    expect(result).toContain("- Linters: eslint, prettier");
    expect(result).toContain("- Entry points: src/index.ts");
    expect(result).toContain("- Package manager: pnpm");
    expect(result).toContain("- Monorepo: pnpm workspaces");
    expect(result).toContain("- Architecture docs: CLAUDE.md, README.md");
  });

  it("only includes lines for populated fields", () => {
    const ctx = emptyContext();
    ctx.languages = [{ name: "Go", source: "go.mod" }];

    const result = formatRepoContext(ctx);

    expect(result).toContain("- Languages: Go");
    expect(result).not.toContain("Frameworks");
    expect(result).not.toContain("Test runner");
    expect(result).not.toContain("Linters");
    expect(result).not.toContain("Entry points");
    expect(result).not.toContain("Package manager");
    expect(result).not.toContain("Monorepo");
    expect(result).not.toContain("Architecture docs");
  });

  it("flattens DetectedSignal to names only (no sources)", () => {
    const ctx = emptyContext();
    ctx.linters = [
      { name: "eslint", source: "package.json" },
      { name: "prettier", source: ".prettierrc" },
    ];

    const result = formatRepoContext(ctx);

    expect(result).toContain("eslint, prettier");
    expect(result).not.toContain("package.json");
    expect(result).not.toContain(".prettierrc");
  });
});
