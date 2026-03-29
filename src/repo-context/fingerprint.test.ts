import { describe, it, expect, vi, beforeEach } from "vitest";
import { fingerprint } from "./fingerprint.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  access: vi.fn(),
}));

import * as fs from "node:fs/promises";

const mockReadFile = vi.mocked(fs.readFile);
const mockAccess = vi.mocked(fs.access);

function failAll(): void {
  mockReadFile.mockRejectedValue(new Error("ENOENT"));
  mockAccess.mockRejectedValue(new Error("ENOENT"));
}

function allowAccess(...filenames: string[]): void {
  mockAccess.mockImplementation((p) => {
    const path = String(p);
    if (filenames.some((f) => path.endsWith(`/${f}`))) {
      return Promise.resolve();
    }
    return Promise.reject(new Error("ENOENT"));
  });
}

function serveFile(filename: string, content: string): void {
  const prev = mockReadFile.getMockImplementation();
  mockReadFile.mockImplementation((p, ...args) => {
    if (String(p).endsWith(`/${filename}`)) {
      return Promise.resolve(content) as ReturnType<typeof fs.readFile>;
    }
    if (prev) return prev(p, ...args);
    return Promise.reject(new Error("ENOENT"));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  failAll();
});

describe("fingerprint", () => {
  it("returns empty context when no signal files exist", async () => {
    const ctx = await fingerprint("/empty");

    expect(ctx.languages).toEqual([]);
    expect(ctx.frameworks).toEqual([]);
    expect(ctx.testRunners).toEqual([]);
    expect(ctx.linters).toEqual([]);
    expect(ctx.entryPoints).toEqual([]);
    expect(ctx.packageManager).toBeNull();
    expect(ctx.monorepoTool).toBeNull();
    expect(ctx.architectureDocs).toEqual([]);
  });

  it("detects Node.js project with Next.js, vitest, eslint", async () => {
    const pkg = JSON.stringify({
      main: "dist/index.js",
      dependencies: { next: "14.0.0", react: "18.0.0" },
      devDependencies: { vitest: "1.0.0", eslint: "8.0.0" },
    });
    serveFile("package.json", pkg);
    allowAccess("tsconfig.json");

    const ctx = await fingerprint("/repo");

    expect(ctx.languages.map((s) => s.name)).toContain("JavaScript");
    expect(ctx.languages.map((s) => s.name)).toContain("TypeScript");
    expect(ctx.frameworks.map((s) => s.name)).toEqual(["Next.js", "React"]);
    expect(ctx.testRunners.map((s) => s.name)).toContain("vitest");
    expect(ctx.linters.map((s) => s.name)).toContain("eslint");
    expect(ctx.entryPoints).toContain("dist/index.js");
  });

  it("detects Go project from go.mod", async () => {
    serveFile("go.mod", "module github.com/user/repo\n\ngo 1.21\n");

    const ctx = await fingerprint("/repo");

    expect(ctx.languages.map((s) => s.name)).toEqual(["Go"]);
    expect(ctx.entryPoints).toContain("github.com/user/repo");
  });

  it("detects Rust project with [[bin]] entries", async () => {
    const cargo = `
[package]
name = "myapp"
version = "0.1.0"

[[bin]]
name = "cli-tool"
path = "src/main.rs"

[[bin]]
name = "server"
path = "src/server.rs"
`;
    serveFile("Cargo.toml", cargo);

    const ctx = await fingerprint("/repo");

    expect(ctx.languages.map((s) => s.name)).toEqual(["Rust"]);
    expect(ctx.entryPoints).toContain("cli-tool");
    expect(ctx.entryPoints).toContain("server");
  });

  it("detects Rust workspace as monorepo", async () => {
    serveFile("Cargo.toml", "[workspace]\nmembers = [\"crates/*\"]\n");

    const ctx = await fingerprint("/repo");

    expect(ctx.monorepoTool).toBe("cargo workspaces");
  });

  it("detects Python project with pytest (standard section header)", async () => {
    serveFile("pyproject.toml", "[tool.pytest.ini_options]\ntestpaths = [\"tests\"]\n");

    const ctx = await fingerprint("/repo");

    expect(ctx.languages.map((s) => s.name)).toEqual(["Python"]);
    expect(ctx.testRunners.map((s) => s.name)).toContain("pytest");
  });

  it("detects Python project with pytest (spaces in section header)", async () => {
    serveFile("pyproject.toml", "[ tool . pytest . ini_options ]\ntestpaths = [\"tests\"]\n");

    const ctx = await fingerprint("/repo");

    expect(ctx.testRunners.map((s) => s.name)).toContain("pytest");
  });

  it("detects Python project with pytest (short section header)", async () => {
    serveFile("pyproject.toml", "[tool.pytest]\naddopts = \"-v\"\n");

    const ctx = await fingerprint("/repo");

    expect(ctx.testRunners.map((s) => s.name)).toContain("pytest");
  });

  it("detects Python linters: ruff, black, mypy", async () => {
    const content = `
[tool.ruff]
line-length = 88

[tool.black]
target-version = ["py311"]

[tool.mypy]
strict = true
`;
    serveFile("pyproject.toml", content);

    const ctx = await fingerprint("/repo");

    const linterNames = ctx.linters.map((s) => s.name);
    expect(linterNames).toContain("ruff");
    expect(linterNames).toContain("black");
    expect(linterNames).toContain("mypy");
  });

  it("detects Python frameworks: Django, FastAPI, Flask", async () => {
    serveFile("pyproject.toml", 'dependencies = ["django>=4.0", "fastapi", "flask"]\n');

    const ctx = await fingerprint("/repo");

    const frameworkNames = ctx.frameworks.map((s) => s.name);
    expect(frameworkNames).toContain("Django");
    expect(frameworkNames).toContain("FastAPI");
    expect(frameworkNames).toContain("Flask");
  });

  it("detects npm workspaces monorepo", async () => {
    const pkg = JSON.stringify({
      workspaces: ["packages/*"],
      devDependencies: {},
    });
    serveFile("package.json", pkg);

    const ctx = await fingerprint("/repo");

    expect(ctx.monorepoTool).toBe("npm workspaces");
  });

  it("detects pnpm workspaces from pnpm-workspace.yaml", async () => {
    allowAccess("pnpm-workspace.yaml");

    const ctx = await fingerprint("/repo");

    expect(ctx.monorepoTool).toBe("pnpm workspaces");
  });

  it("detects lerna monorepo", async () => {
    allowAccess("lerna.json");

    const ctx = await fingerprint("/repo");

    expect(ctx.monorepoTool).toBe("lerna");
  });

  it("detects package manager from pnpm-lock.yaml", async () => {
    allowAccess("pnpm-lock.yaml");

    const ctx = await fingerprint("/repo");

    expect(ctx.packageManager).toBe("pnpm");
  });

  it("detects package manager from yarn.lock", async () => {
    allowAccess("yarn.lock");

    const ctx = await fingerprint("/repo");

    expect(ctx.packageManager).toBe("yarn");
  });

  it("detects package manager from package-lock.json", async () => {
    allowAccess("package-lock.json");

    const ctx = await fingerprint("/repo");

    expect(ctx.packageManager).toBe("npm");
  });

  it("detects architecture docs", async () => {
    allowAccess("CLAUDE.md", "README.md", "ARCHITECTURE.md");

    const ctx = await fingerprint("/repo");

    expect(ctx.architectureDocs).toContain("CLAUDE.md");
    expect(ctx.architectureDocs).toContain("README.md");
    expect(ctx.architectureDocs).toContain("ARCHITECTURE.md");
  });

  it("detects config-file-based linters and test runners", async () => {
    allowAccess("eslint.config.js", "biome.json", "vitest.config.ts", ".prettierrc");

    const ctx = await fingerprint("/repo");

    const linterNames = ctx.linters.map((s) => s.name);
    expect(linterNames).toContain("eslint");
    expect(linterNames).toContain("biome");
    expect(linterNames).toContain("prettier");
    expect(ctx.testRunners.map((s) => s.name)).toContain("vitest");
  });

  it("deduplicates signals from multiple sources", async () => {
    // eslint detected from both package.json and config file
    const pkg = JSON.stringify({
      devDependencies: { eslint: "8.0.0", vitest: "1.0.0" },
    });
    serveFile("package.json", pkg);
    allowAccess("eslint.config.js", "vitest.config.ts");

    const ctx = await fingerprint("/repo");

    const eslintCount = ctx.linters.filter((s) => s.name === "eslint").length;
    expect(eslintCount).toBe(1);
    const vitestCount = ctx.testRunners.filter((s) => s.name === "vitest").length;
    expect(vitestCount).toBe(1);
  });

  it("handles mixed project (Node.js + Go)", async () => {
    const pkg = JSON.stringify({
      dependencies: { express: "4.0.0" },
    });
    serveFile("package.json", pkg);
    serveFile("go.mod", "module example.com/svc\n\ngo 1.21\n");

    const ctx = await fingerprint("/repo");

    const langNames = ctx.languages.map((s) => s.name);
    expect(langNames).toContain("JavaScript");
    expect(langNames).toContain("Go");
    expect(ctx.frameworks.map((s) => s.name)).toContain("Express");
  });

  it("handles package.json with bin as object", async () => {
    const pkg = JSON.stringify({
      bin: { kaicho: "dist/cli.js", "kaicho-init": "dist/init.js" },
    });
    serveFile("package.json", pkg);

    const ctx = await fingerprint("/repo");

    expect(ctx.entryPoints).toContain("dist/cli.js");
    expect(ctx.entryPoints).toContain("dist/init.js");
  });

  it("handles malformed package.json gracefully", async () => {
    serveFile("package.json", "{ not valid json }}}");

    const ctx = await fingerprint("/repo");

    // Should not crash, just skip package.json signals
    expect(ctx.languages).toEqual([]);
  });

  it("never throws even when all reads fail", async () => {
    // failAll() is already set in beforeEach
    await expect(fingerprint("/broken")).resolves.toBeDefined();
  });
});
