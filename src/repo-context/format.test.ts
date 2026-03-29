import { describe, it, expect } from "vitest";
import { formatRepoContext, formatContextForFile } from "./format.js";
import type { RepoContext, ComponentContext } from "./fingerprint.js";

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
    workspacePackages: [],
    languageDistribution: [], components: [],
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
      workspacePackages: ["packages/web", "packages/api"],
      languageDistribution: [], components: [],
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
    expect(result).toContain("- Workspace packages: packages/web, packages/api");
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

  it("uses distribution percentages when languageDistribution is present", () => {
    const ctx = emptyContext();
    ctx.languages = [{ name: "C#", source: "Sonarr.sln" }];
    ctx.languageDistribution = [
      { language: "C#", files: 2799, percentage: 68.4 },
      { language: "TypeScript", files: 1218, percentage: 29.8 },
      { language: "JavaScript", files: 74, percentage: 1.8 },
    ];

    const result = formatRepoContext(ctx);

    expect(result).toContain("C# (68.4%)");
    expect(result).toContain("TypeScript (29.8%)");
    expect(result).toContain("JavaScript (1.8%)");
    expect(result).not.toContain("source");
  });

  it("flattens DetectedSignal to names only (no sources in output)", () => {
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

function makeComponent(componentPath: string, lang: string, framework?: string): ComponentContext {
  return {
    path: componentPath,
    languages: [{ name: lang, source: `${componentPath}/package.json` }],
    frameworks: framework ? [{ name: framework, source: `${componentPath}/package.json` }] : [],
    testRunners: [], linters: [], entryPoints: [],
    packageManager: null, languageDistribution: [],
  };
}

describe("formatContextForFile", () => {
  it("returns component-scoped context when file matches a component", () => {
    const ctx = emptyContext();
    ctx.languages = [{ name: "C#", source: "src/Sonarr.sln" }, { name: "TypeScript", source: "frontend/package.json" }];
    ctx.frameworks = [{ name: "React", source: "frontend/package.json" }, { name: ".NET", source: "src/Sonarr.sln" }];
    ctx.architectureDocs = ["README.md"];
    ctx.components = [
      makeComponent("src", "C#", ".NET"),
      makeComponent("frontend", "TypeScript", "React"),
    ];

    const result = formatContextForFile(ctx, "frontend/src/App.tsx");

    expect(result).toContain("TypeScript");
    expect(result).toContain("React");
    expect(result).toContain('component "frontend"');
    // C# should not appear in Languages/Frameworks lines, only in Project structure
    expect(result).not.toContain("- Languages: C#");
    expect(result).not.toContain("- Frameworks: .NET");
    expect(result).toContain("Project structure");
  });

  it("returns different context for different components", () => {
    const ctx = emptyContext();
    ctx.components = [
      makeComponent("src", "C#", ".NET"),
      makeComponent("frontend", "TypeScript", "React"),
    ];

    const backend = formatContextForFile(ctx, "src/Api/Queue.cs");
    const frontend = formatContextForFile(ctx, "frontend/src/App.tsx");

    expect(backend).toContain("C#");
    expect(backend).not.toContain("React");
    expect(frontend).toContain("TypeScript");
    expect(frontend).not.toContain(".NET");
  });

  it("falls back to repo-wide context when no components exist", () => {
    const ctx = emptyContext();
    ctx.languages = [{ name: "TypeScript", source: "tsconfig.json" }];

    const result = formatContextForFile(ctx, "src/index.ts");

    expect(result).toContain("repo-level hints");
    expect(result).toContain("TypeScript");
  });

  it("includes repo-wide fields in component context", () => {
    const ctx = emptyContext();
    ctx.architectureDocs = ["README.md"];
    ctx.packageManager = "yarn";
    ctx.components = [makeComponent("frontend", "TypeScript")];

    const result = formatContextForFile(ctx, "frontend/src/App.tsx");

    expect(result).toContain("README.md");
    expect(result).toContain("yarn");
  });
});
