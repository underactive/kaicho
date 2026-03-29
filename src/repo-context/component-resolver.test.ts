import { describe, it, expect } from "vitest";
import { resolveComponentForFile } from "./component-resolver.js";
import type { RepoContext, ComponentContext } from "./fingerprint.js";

function emptyContext(): RepoContext {
  return {
    languages: [], frameworks: [], testRunners: [], linters: [],
    entryPoints: [], packageManager: null, monorepoTool: null,
    architectureDocs: [], workspacePackages: [], languageDistribution: [],
    components: [],
  };
}

function makeComponent(path: string, lang: string): ComponentContext {
  return {
    path,
    languages: [{ name: lang, source: `${path}/package.json` }],
    frameworks: [], testRunners: [], linters: [],
    entryPoints: [], packageManager: null, languageDistribution: [],
  };
}

describe("resolveComponentForFile", () => {
  it("returns null when no components exist", () => {
    const ctx = emptyContext();
    expect(resolveComponentForFile(ctx, "src/index.ts")).toBeNull();
  });

  it("matches file to component by path prefix", () => {
    const ctx = emptyContext();
    ctx.components = [makeComponent("frontend", "TypeScript"), makeComponent("src", "C#")];

    const result = resolveComponentForFile(ctx, "frontend/src/App.tsx");
    expect(result?.path).toBe("frontend");
  });

  it("matches file to different component", () => {
    const ctx = emptyContext();
    ctx.components = [makeComponent("frontend", "TypeScript"), makeComponent("src", "C#")];

    const result = resolveComponentForFile(ctx, "src/Api/Queue.cs");
    expect(result?.path).toBe("src");
  });

  it("uses longest prefix match", () => {
    const ctx = emptyContext();
    ctx.components = [makeComponent("packages", "TypeScript"), makeComponent("packages/web", "TypeScript")];

    const result = resolveComponentForFile(ctx, "packages/web/src/App.tsx");
    expect(result?.path).toBe("packages/web");
  });

  it("matches root component when no specific component matches", () => {
    const ctx = emptyContext();
    ctx.components = [makeComponent("", "C++"), makeComponent("tools", "Python")];

    const result = resolveComponentForFile(ctx, "core/main.cpp");
    expect(result?.path).toBe("");
  });

  it("prefers specific component over root", () => {
    const ctx = emptyContext();
    ctx.components = [makeComponent("", "C++"), makeComponent("tools", "Python")];

    const result = resolveComponentForFile(ctx, "tools/build.py");
    expect(result?.path).toBe("tools");
  });

  it("returns null when file matches no component and no root exists", () => {
    const ctx = emptyContext();
    ctx.components = [makeComponent("frontend", "TypeScript")];

    const result = resolveComponentForFile(ctx, "backend/api.go");
    expect(result).toBeNull();
  });

  it("strips leading ./ from file path", () => {
    const ctx = emptyContext();
    ctx.components = [makeComponent("src", "TypeScript")];

    const result = resolveComponentForFile(ctx, "./src/index.ts");
    expect(result?.path).toBe("src");
  });
});
