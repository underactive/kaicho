import * as path from "node:path";

import type { DetectedSignal, RepoContext } from "./fingerprint.js";

// --- Ecosystem detectors ---

export interface PackageJson {
  main?: string;
  module?: string;
  bin?: string | Record<string, string>;
  workspaces?: string[] | { packages: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function detectFromPackageJson(raw: string, ctx: RepoContext, source = "package.json"): void {
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(raw) as PackageJson;
  } catch {
    return;
  }

  const src = source;
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

export function detectFromGoMod(raw: string, ctx: RepoContext): void {
  ctx.languages.push({ name: "Go", source: "go.mod" });

  // Extract module path for entry point hint
  const modMatch = raw.match(/^module\s+(\S+)/m);
  if (modMatch?.[1]) {
    ctx.entryPoints.push(modMatch[1]);
  }
}

export function detectFromCargoToml(raw: string, ctx: RepoContext, source = "Cargo.toml"): void {
  const src = source;
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

export function detectFromPlatformioIni(raw: string, ctx: RepoContext, source = "platformio.ini"): void {
  const src = source;
  ctx.languages.push({ name: "C/C++", source: src });

  // Detect framework (arduino, espidf, etc.)
  const fwMatch = raw.match(/^framework\s*=\s*(\S+)/m);
  if (fwMatch?.[1]) {
    const fw = fwMatch[1].toLowerCase();
    if (fw === "arduino") ctx.frameworks.push({ name: "Arduino", source: src });
    else if (fw === "espidf") ctx.frameworks.push({ name: "ESP-IDF", source: src });
    else ctx.frameworks.push({ name: fwMatch[1], source: src });
  }

  // Detect platform/board for richer context
  const platMatch = raw.match(/^platform\s*=\s*(\S+)/m);
  if (platMatch?.[1]) {
    const plat = platMatch[1].toLowerCase();
    if (plat.includes("espressif32")) ctx.frameworks.push({ name: "ESP32", source: src });
    else if (plat.includes("nordicnrf52")) ctx.frameworks.push({ name: "nRF52", source: src });
    else if (plat.includes("atmelavr")) ctx.frameworks.push({ name: "AVR", source: src });
    else if (plat.includes("ststm32")) ctx.frameworks.push({ name: "STM32", source: src });
  }
}

export function detectFromSwiftProject(ctx: RepoContext, source: string): void {
  ctx.languages.push({ name: "Swift", source });
  const basename = path.basename(source);
  if (source.endsWith(".xcodeproj") || source.endsWith(".xcworkspace") || basename === "project.yml") {
    ctx.frameworks.push({ name: "Xcode", source });
  }
  if (basename === "Package.swift") {
    ctx.frameworks.push({ name: "Swift Package Manager", source });
  }
}

export function detectFromGradle(raw: string, ctx: RepoContext, source = "build.gradle"): void {
  const src = source;
  ctx.frameworks.push({ name: "Gradle", source: src });

  // Android
  if (/com\.android\.tools\.build:gradle/m.test(raw) || /com\.android\.(application|library)/m.test(raw)) {
    ctx.languages.push({ name: "Java", source: src });
    ctx.frameworks.push({ name: "Android", source: src });
  }

  // Kotlin
  if (/kotlin|org\.jetbrains\.kotlin/m.test(raw)) {
    ctx.languages.push({ name: "Kotlin", source: src });
  }

  // Java (if not already added via Android)
  if (/plugin.*java|java-library|application/m.test(raw) && !ctx.languages.some((l) => l.name === "Java")) {
    ctx.languages.push({ name: "Java", source: src });
  }

  // Spring Boot
  if (/org\.springframework\.boot/m.test(raw)) {
    ctx.frameworks.push({ name: "Spring Boot", source: src });
  }

  // Test frameworks
  if (/junit/i.test(raw)) {
    ctx.testRunners.push({ name: "JUnit", source: src });
  }
}

export function detectFromPomXml(raw: string, ctx: RepoContext, source = "pom.xml"): void {
  const src = source;
  ctx.languages.push({ name: "Java", source: src });
  ctx.frameworks.push({ name: "Maven", source: src });

  if (/spring-boot/m.test(raw)) {
    ctx.frameworks.push({ name: "Spring Boot", source: src });
  }
  if (/kotlin/m.test(raw)) {
    ctx.languages.push({ name: "Kotlin", source: src });
  }
  if (/junit/i.test(raw)) {
    ctx.testRunners.push({ name: "JUnit", source: src });
  }
}

export function detectFromPyprojectToml(raw: string, ctx: RepoContext, source = "pyproject.toml"): void {
  const src = source;

  // Only classify as a Python project if it has [project] or [build-system].
  // A pyproject.toml with only [tool.*] sections is tooling config (e.g., ruff/mypy
  // for a C++ project's build scripts), not a Python project itself.
  const isPythonProject = /^\s*\[(project|build-system)]/m.test(raw);
  if (isPythonProject) {
    ctx.languages.push({ name: "Python", source: src });
  }

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

export interface ConfigCheck {
  patterns: string[];
  signal: (ctx: RepoContext, matched: string) => void;
}

export const CONFIG_CHECKS: ConfigCheck[] = [
  {
    patterns: ["tsconfig.json"],
    signal: (ctx) => ctx.languages.push({ name: "TypeScript", source: "tsconfig.json" }),
  },
  {
    patterns: ["CMakeLists.txt"],
    signal: (ctx) => ctx.languages.push({ name: "C/C++", source: "CMakeLists.txt" }),
  },
  {
    patterns: ["Makefile", "GNUmakefile", "makefile"],
    signal: (ctx, f) => ctx.frameworks.push({ name: "Make", source: f }),
  },
  {
    patterns: ["Directory.Build.props", "Directory.Build.targets", "Directory.Packages.props"],
    signal: (ctx, f) => {
      ctx.languages.push({ name: "C#", source: f });
      ctx.frameworks.push({ name: ".NET", source: f });
    },
  },
  {
    patterns: ["nuget.config", "NuGet.Config", "NuGet.config"],
    signal: (ctx, f) => {
      ctx.languages.push({ name: "C#", source: f });
      ctx.frameworks.push({ name: "NuGet", source: f });
    },
  },
  {
    patterns: ["SConstruct"],
    signal: (ctx) => {
      ctx.languages.push({ name: "C/C++", source: "SConstruct" });
      ctx.frameworks.push({ name: "SCons", source: "SConstruct" });
    },
  },
  {
    patterns: ["meson.build"],
    signal: (ctx) => {
      ctx.languages.push({ name: "C/C++", source: "meson.build" });
      ctx.frameworks.push({ name: "Meson", source: "meson.build" });
    },
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

export const LOCKFILE_TO_PM: Record<string, string> = {
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
  "bun.lockb": "bun",
  "bun.lock": "bun",
};

// --- Architecture docs ---

export const ARCH_DOCS = ["CLAUDE.md", "AGENTS.md", "ARCHITECTURE.md", "README.md"];

// --- Monorepo tools ---

export const MONOREPO_FILES: Record<string, string> = {
  "pnpm-workspace.yaml": "pnpm workspaces",
  "lerna.json": "lerna",
};
