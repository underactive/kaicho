import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface DetectedSignal {
  name: string;
  source: string;
}

export interface RepoContext {
  languages: DetectedSignal[];
  frameworks: DetectedSignal[];
  testRunners: DetectedSignal[];
  linters: DetectedSignal[];
  entryPoints: string[];
  packageManager: string | null;
  monorepoTool: string | null;
  architectureDocs: string[];
}

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

async function readSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// --- Ecosystem detectors ---

interface PackageJson {
  main?: string;
  module?: string;
  bin?: string | Record<string, string>;
  workspaces?: string[] | { packages: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function detectFromPackageJson(raw: string, ctx: RepoContext): void {
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(raw) as PackageJson;
  } catch {
    return;
  }

  const src = "package.json";
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  ctx.languages.push({ name: "JavaScript", source: src });

  // Frameworks
  const frameworkMap: Record<string, string> = {
    next: "Next.js",
    react: "React",
    vue: "Vue",
    nuxt: "Nuxt",
    svelte: "Svelte",
    "@sveltejs/kit": "SvelteKit",
    express: "Express",
    fastify: "Fastify",
    hono: "Hono",
    koa: "Koa",
    "@nestjs/core": "NestJS",
    "@angular/core": "Angular",
    gatsby: "Gatsby",
    remix: "Remix",
    "@remix-run/node": "Remix",
  };

  const seenFrameworks = new Set<string>();
  for (const [dep, name] of Object.entries(frameworkMap)) {
    if (dep in allDeps && !seenFrameworks.has(name)) {
      seenFrameworks.add(name);
      ctx.frameworks.push({ name, source: src });
    }
  }

  // Test runners
  const testRunnerMap: Record<string, string> = {
    vitest: "vitest",
    jest: "jest",
    mocha: "mocha",
    ava: "ava",
    "@playwright/test": "playwright",
    cypress: "cypress",
  };
  for (const [dep, name] of Object.entries(testRunnerMap)) {
    if (dep in allDeps) {
      ctx.testRunners.push({ name, source: src });
    }
  }

  // Linters / formatters
  const linterMap: Record<string, string> = {
    eslint: "eslint",
    "@biomejs/biome": "biome",
    prettier: "prettier",
    oxlint: "oxlint",
  };
  for (const [dep, name] of Object.entries(linterMap)) {
    if (dep in allDeps) {
      ctx.linters.push({ name, source: src });
    }
  }

  // Entry points
  if (typeof pkg.main === "string") {
    ctx.entryPoints.push(pkg.main);
  } else if (typeof pkg.module === "string") {
    ctx.entryPoints.push(pkg.module);
  }
  if (pkg.bin) {
    if (typeof pkg.bin === "string") {
      ctx.entryPoints.push(pkg.bin);
    } else {
      ctx.entryPoints.push(...Object.values(pkg.bin));
    }
  }

  // Monorepo
  if (pkg.workspaces) {
    ctx.monorepoTool = "npm workspaces";
  }
}

function detectFromGoMod(raw: string, ctx: RepoContext): void {
  ctx.languages.push({ name: "Go", source: "go.mod" });

  // Extract module path for entry point hint
  const modMatch = raw.match(/^module\s+(\S+)/m);
  if (modMatch?.[1]) {
    ctx.entryPoints.push(modMatch[1]);
  }
}

function detectFromCargoToml(raw: string, ctx: RepoContext): void {
  const src = "Cargo.toml";
  ctx.languages.push({ name: "Rust", source: src });

  // Detect [[bin]] entry points
  const binMatches = raw.matchAll(/\[\[bin]]\s*\n(?:.*\n)*?name\s*=\s*"([^"]+)"/gm);
  for (const m of binMatches) {
    if (m[1]) ctx.entryPoints.push(m[1]);
  }

  // Detect workspace
  if (/^\[workspace]/m.test(raw)) {
    ctx.monorepoTool = "cargo workspaces";
  }
}

function detectFromPyprojectToml(raw: string, ctx: RepoContext): void {
  const src = "pyproject.toml";
  ctx.languages.push({ name: "Python", source: src });

  // Test runners — match section headers with optional whitespace
  if (/^\s*\[\s*tool\s*\.\s*pytest/m.test(raw)) {
    ctx.testRunners.push({ name: "pytest", source: src });
  }

  // Linters / formatters
  if (/^\s*\[\s*tool\s*\.\s*ruff/m.test(raw)) {
    ctx.linters.push({ name: "ruff", source: src });
  }
  if (/^\s*\[\s*tool\s*\.\s*black/m.test(raw)) {
    ctx.linters.push({ name: "black", source: src });
  }
  if (/^\s*\[\s*tool\s*\.\s*mypy/m.test(raw)) {
    ctx.linters.push({ name: "mypy", source: src });
  }

  // Frameworks from dependencies (basic heuristic)
  if (/django/i.test(raw)) {
    ctx.frameworks.push({ name: "Django", source: src });
  }
  if (/fastapi/i.test(raw)) {
    ctx.frameworks.push({ name: "FastAPI", source: src });
  }
  if (/flask/i.test(raw)) {
    ctx.frameworks.push({ name: "Flask", source: src });
  }
}

// --- Config file presence detection ---

interface ConfigCheck {
  patterns: string[];
  signal: (ctx: RepoContext, matched: string) => void;
}

const CONFIG_CHECKS: ConfigCheck[] = [
  {
    patterns: ["tsconfig.json"],
    signal: (ctx) => ctx.languages.push({ name: "TypeScript", source: "tsconfig.json" }),
  },
  {
    patterns: [".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.yml", "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts"],
    signal: (ctx, f) => ctx.linters.push({ name: "eslint", source: f }),
  },
  {
    patterns: ["biome.json", "biome.jsonc"],
    signal: (ctx, f) => ctx.linters.push({ name: "biome", source: f }),
  },
  {
    patterns: [".prettierrc", ".prettierrc.json", ".prettierrc.js", ".prettierrc.cjs", "prettier.config.js", "prettier.config.cjs"],
    signal: (ctx, f) => ctx.linters.push({ name: "prettier", source: f }),
  },
  {
    patterns: ["jest.config.js", "jest.config.ts", "jest.config.mjs", "jest.config.cjs"],
    signal: (ctx, f) => ctx.testRunners.push({ name: "jest", source: f }),
  },
  {
    patterns: ["vitest.config.ts", "vitest.config.js", "vitest.config.mts", "vitest.config.mjs"],
    signal: (ctx, f) => ctx.testRunners.push({ name: "vitest", source: f }),
  },
];

// --- Package manager detection ---

const LOCKFILE_TO_PM: Record<string, string> = {
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
  "bun.lockb": "bun",
  "bun.lock": "bun",
};

// --- Architecture docs ---

const ARCH_DOCS = ["CLAUDE.md", "AGENTS.md", "ARCHITECTURE.md", "README.md"];

// --- Monorepo tools ---

const MONOREPO_FILES: Record<string, string> = {
  "pnpm-workspace.yaml": "pnpm workspaces",
  "lerna.json": "lerna",
};

// --- Main fingerprint function ---

/**
 * Fingerprint a repository by reading signal files from its root.
 *
 * v1 scope: root-only. Does not descend into nested package roots
 * or monorepo workspace packages.
 */
export async function fingerprint(repoPath: string): Promise<RepoContext> {
  const ctx = emptyContext();
  const root = path.resolve(repoPath);

  // Phase 1: Read ecosystem manifest files concurrently
  const [packageJsonRaw, goModRaw, cargoTomlRaw, pyprojectRaw] =
    await Promise.all([
      readSafe(path.join(root, "package.json")),
      readSafe(path.join(root, "go.mod")),
      readSafe(path.join(root, "Cargo.toml")),
      readSafe(path.join(root, "pyproject.toml")),
    ]);

  if (packageJsonRaw) detectFromPackageJson(packageJsonRaw, ctx);
  if (goModRaw) detectFromGoMod(goModRaw, ctx);
  if (cargoTomlRaw) detectFromCargoToml(cargoTomlRaw, ctx);
  if (pyprojectRaw) detectFromPyprojectToml(pyprojectRaw, ctx);

  // Phase 2: Check config files, lockfiles, docs, monorepo signals concurrently
  const allChecks: Array<Promise<void>> = [];

  // Config file presence checks (only add if not already detected from package.json)
  for (const check of CONFIG_CHECKS) {
    for (const pattern of check.patterns) {
      allChecks.push(
        exists(path.join(root, pattern)).then((found) => {
          if (found) check.signal(ctx, pattern);
        }),
      );
    }
  }

  // Package manager from lockfiles
  for (const [lockfile, pm] of Object.entries(LOCKFILE_TO_PM)) {
    allChecks.push(
      exists(path.join(root, lockfile)).then((found) => {
        if (found && !ctx.packageManager) ctx.packageManager = pm;
      }),
    );
  }

  // Architecture docs
  for (const doc of ARCH_DOCS) {
    allChecks.push(
      exists(path.join(root, doc)).then((found) => {
        if (found) ctx.architectureDocs.push(doc);
      }),
    );
  }

  // Monorepo tool files
  for (const [file, tool] of Object.entries(MONOREPO_FILES)) {
    allChecks.push(
      exists(path.join(root, file)).then((found) => {
        if (found) ctx.monorepoTool = tool;
      }),
    );
  }

  await Promise.all(allChecks);

  // Deduplicate signals (config file + package.json may both detect eslint)
  ctx.languages = dedup(ctx.languages);
  ctx.frameworks = dedup(ctx.frameworks);
  ctx.testRunners = dedup(ctx.testRunners);
  ctx.linters = dedup(ctx.linters);
  ctx.entryPoints = [...new Set(ctx.entryPoints)];
  ctx.architectureDocs = [...new Set(ctx.architectureDocs)];

  return ctx;
}

function dedup(signals: DetectedSignal[]): DetectedSignal[] {
  const seen = new Set<string>();
  return signals.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}
