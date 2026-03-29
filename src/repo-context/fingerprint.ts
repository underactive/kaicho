import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  detectFromPackageJson,
  detectFromGoMod,
  detectFromCargoToml,
  detectFromPlatformioIni,
  detectFromSwiftProject,
  detectFromGradle,
  detectFromPomXml,
  detectFromPyprojectToml,
  CONFIG_CHECKS,
  LOCKFILE_TO_PM,
  ARCH_DOCS,
  MONOREPO_FILES,
} from "./detectors.js";
import { countFilesByLanguage } from "./file-distribution.js";
import { scanSubdirectories } from "./subdirectory-scan.js";
import { extractWorkspacePatterns, resolveWorkspacePaths, fingerprintPackage } from "./workspace.js";

export interface DetectedSignal {
  name: string;
  source: string;
}

export interface LanguageShare {
  language: string;
  files: number;
  percentage: number;
}

export interface ComponentContext {
  /** Relative path prefix, e.g. "frontend", "src", or "" for root */
  path: string;
  languages: DetectedSignal[];
  frameworks: DetectedSignal[];
  testRunners: DetectedSignal[];
  linters: DetectedSignal[];
  entryPoints: string[];
  packageManager: string | null;
  languageDistribution: LanguageShare[];
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
  workspacePackages: string[];
  languageDistribution: LanguageShare[];
  components: ComponentContext[];
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
    workspacePackages: [],
    languageDistribution: [],
    components: [],
  };
}

export async function readSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findDotNetProject(dir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir);
    return entries.find((e) =>
      e.endsWith(".sln") || e.endsWith(".slnx") || e.endsWith(".csproj") || e.endsWith(".fsproj"),
    ) ?? null;
  } catch {
    return null;
  }
}

export async function findXcodeproj(dir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir);
    const proj = entries.find((e) => e.endsWith(".xcodeproj") || e.endsWith(".xcworkspace"));
    return proj ?? null;
  } catch {
    return null;
  }
}

export function emptyComponent(componentPath: string): ComponentContext {
  return {
    path: componentPath,
    languages: [],
    frameworks: [],
    testRunners: [],
    linters: [],
    entryPoints: [],
    packageManager: null,
    languageDistribution: [],
  };
}

/**
 * Build per-component contexts by grouping signals by their source directory.
 * A signal with source "frontend/package.json" belongs to component "frontend".
 */
function buildComponents(ctx: RepoContext): ComponentContext[] {
  const componentMap = new Map<string, ComponentContext>();

  function getOrCreate(componentPath: string): ComponentContext {
    let comp = componentMap.get(componentPath);
    if (!comp) {
      comp = emptyComponent(componentPath);
      componentMap.set(componentPath, comp);
    }
    return comp;
  }

  function componentPathFromSource(source: string): string | null {
    // Sources like "frontend/package.json" → "frontend"
    // Sources like "package.json" or "tsconfig.json" → "" (root)
    // Sources like "file distribution (68.4%)" → skip
    if (source.includes("(")) return null;
    const idx = source.indexOf("/");
    if (idx === -1) return "";
    return source.slice(0, idx);
  }

  // Group language and framework signals by component
  for (const sig of ctx.languages) {
    const cp = componentPathFromSource(sig.source);
    if (cp !== null) getOrCreate(cp).languages.push(sig);
  }
  for (const sig of ctx.frameworks) {
    const cp = componentPathFromSource(sig.source);
    if (cp !== null) getOrCreate(cp).frameworks.push(sig);
  }
  for (const sig of ctx.testRunners) {
    const cp = componentPathFromSource(sig.source);
    if (cp !== null) getOrCreate(cp).testRunners.push(sig);
  }
  for (const sig of ctx.linters) {
    const cp = componentPathFromSource(sig.source);
    if (cp !== null) getOrCreate(cp).linters.push(sig);
  }

  // Only return components if there are at least 2 distinct ones with language signals
  const withLanguages = [...componentMap.values()].filter((c) => c.languages.length > 0);
  if (withLanguages.length < 2) return [];

  // Dedup within each component
  for (const comp of withLanguages) {
    comp.languages = dedup(comp.languages);
    comp.frameworks = dedup(comp.frameworks);
    comp.testRunners = dedup(comp.testRunners);
    comp.linters = dedup(comp.linters);
  }

  return withLanguages;
}

/**
 * Build components by running per-directory file distribution.
 * Used when manifest-based detection didn't find distinct components
 * but the repo has multiple languages (e.g., Sonarr: root manifests for JS/TS,
 * but src/ is mostly C# and frontend/ is mostly TypeScript).
 */
async function buildComponentsFromDistribution(
  root: string,
  ctx: RepoContext,
): Promise<ComponentContext[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS_SET.has(e.name))
    .slice(0, 10);

  const components: ComponentContext[] = [];
  const primaryLangs = new Set<string>();

  for (const dir of dirs) {
    const dist = await countFilesByLanguage(path.join(root, dir.name));
    if (dist.length === 0 || dist[0]!.files < 5) continue;

    const primary = dist[0]!.language;
    primaryLangs.add(primary);

    const comp = emptyComponent(dir.name);
    comp.languageDistribution = dist;
    comp.languages = [{ name: primary, source: `${dir.name}/ (${dist[0]!.percentage}% of files)` }];

    // Copy manifest-detected frameworks that belong to this directory
    for (const fw of ctx.frameworks) {
      if (fw.source.startsWith(dir.name + "/")) {
        comp.frameworks.push(fw);
      }
    }
    for (const tr of ctx.testRunners) {
      if (tr.source.startsWith(dir.name + "/")) {
        comp.testRunners.push(tr);
      }
    }
    for (const lt of ctx.linters) {
      if (lt.source.startsWith(dir.name + "/")) {
        comp.linters.push(lt);
      }
    }
    // For distribution-based detection, only include frameworks from this directory.
    // Root-level frameworks (e.g., React from root package.json) are ambiguous and excluded.

    components.push(comp);
  }

  // Only return if different directories have different primary languages
  if (primaryLangs.size < 2) return [];

  // Dedup frameworks within each component
  for (const comp of components) {
    comp.frameworks = dedup(comp.frameworks);
  }

  return components;
}

const SKIP_DIRS_SET = new Set([
  "node_modules", ".git", "vendor", "third_party", "thirdparty",
  "dist", "build", "out", ".pio", "__pycache__", ".next",
  "target", "Pods", ".gradle", "bin", "obj",
  "doc", "docs", "assets", "scripts", "tools",
]);

function dedup(signals: DetectedSignal[]): DetectedSignal[] {
  const seen = new Set<string>();
  return signals.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}

// --- Main fingerprint function ---

/**
 * Fingerprint a repository by reading signal files from its root
 * and workspace packages (if a monorepo is detected).
 */
export async function fingerprint(repoPath: string): Promise<RepoContext> {
  const ctx = emptyContext();
  const root = path.resolve(repoPath);

  // Phase 1: Read ecosystem manifest files concurrently
  const [packageJsonRaw, goModRaw, cargoTomlRaw, pyprojectRaw, platformioIniRaw, gradleRaw, gradleKtsRaw, pomXmlRaw] =
    await Promise.all([
      readSafe(path.join(root, "package.json")),
      readSafe(path.join(root, "go.mod")),
      readSafe(path.join(root, "Cargo.toml")),
      readSafe(path.join(root, "pyproject.toml")),
      readSafe(path.join(root, "platformio.ini")),
      readSafe(path.join(root, "build.gradle")),
      readSafe(path.join(root, "build.gradle.kts")),
      readSafe(path.join(root, "pom.xml")),
    ]);

  if (packageJsonRaw) detectFromPackageJson(packageJsonRaw, ctx);
  if (goModRaw) detectFromGoMod(goModRaw, ctx);
  if (cargoTomlRaw) detectFromCargoToml(cargoTomlRaw, ctx);
  if (pyprojectRaw) detectFromPyprojectToml(pyprojectRaw, ctx);
  if (platformioIniRaw) detectFromPlatformioIni(platformioIniRaw, ctx);
  if (gradleRaw) detectFromGradle(gradleRaw, ctx);
  else if (gradleKtsRaw) detectFromGradle(gradleKtsRaw, ctx, "build.gradle.kts");
  if (pomXmlRaw) detectFromPomXml(pomXmlRaw, ctx);

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

  // .NET solution files (.sln, .slnx, .csproj, .fsproj)
  allChecks.push(
    findDotNetProject(root).then((name) => {
      if (name) {
        ctx.languages.push({ name: name.endsWith(".fsproj") ? "F#" : "C#", source: name });
        ctx.frameworks.push({ name: ".NET", source: name });
      }
    }),
  );

  // Swift / Xcode detection
  allChecks.push(
    exists(path.join(root, "Package.swift")).then((found) => {
      if (found) detectFromSwiftProject(ctx, "Package.swift");
    }),
  );
  allChecks.push(
    exists(path.join(root, "project.yml")).then((found) => {
      if (found) detectFromSwiftProject(ctx, "project.yml");
    }),
  );
  allChecks.push(
    findXcodeproj(root).then((name) => {
      if (name) detectFromSwiftProject(ctx, name);
    }),
  );

  await Promise.all(allChecks);

  // Phase 3: Fingerprint workspace packages (if monorepo detected)
  if (ctx.monorepoTool) {
    const pnpmWorkspaceRaw = ctx.monorepoTool === "pnpm workspaces"
      ? await readSafe(path.join(root, "pnpm-workspace.yaml"))
      : null;
    const lernaJsonRaw = ctx.monorepoTool === "lerna"
      ? await readSafe(path.join(root, "lerna.json"))
      : null;

    const patterns = extractWorkspacePatterns(
      ctx.monorepoTool, packageJsonRaw, cargoTomlRaw, pnpmWorkspaceRaw, lernaJsonRaw,
    );

    if (patterns.length > 0) {
      const pkgPaths = await resolveWorkspacePaths(root, patterns);
      ctx.workspacePackages = pkgPaths.map((p) => path.relative(root, p));
      await Promise.all(pkgPaths.map((p) => fingerprintPackage(p, root, ctx)));
    }
  }

  // Phase 4: Scan immediate subdirectories for manifest files
  // Catches multi-project repos (e.g., firmware/ + macos/, backend/ + frontend/)
  await scanSubdirectories(root, ctx);

  // Phase 5: File extension language distribution (like GitHub Linguist)
  ctx.languageDistribution = await countFilesByLanguage(root);

  // Merge languages found by distribution but missed by manifest detection
  const knownLangs = new Set(ctx.languages.map((s) => s.name));
  for (const share of ctx.languageDistribution) {
    if (share.percentage >= 5 && !knownLangs.has(share.language)) {
      ctx.languages.push({ name: share.language, source: `file distribution (${share.percentage}%)` });
    }
  }

  // Deduplicate signals (config file + package.json may both detect eslint)
  ctx.languages = dedup(ctx.languages);
  ctx.frameworks = dedup(ctx.frameworks);
  ctx.testRunners = dedup(ctx.testRunners);
  ctx.linters = dedup(ctx.linters);
  ctx.entryPoints = [...new Set(ctx.entryPoints)];
  ctx.architectureDocs = [...new Set(ctx.architectureDocs)];

  // Phase 6: Build per-component contexts from signal sources
  ctx.components = buildComponents(ctx);

  // If manifest-based detection didn't find components, try distribution-based detection.
  // Check if top-level directories have distinct primary languages.
  if (ctx.components.length === 0 && ctx.languageDistribution.length > 1) {
    ctx.components = await buildComponentsFromDistribution(root, ctx);
  }

  // Per-component language distribution (only when components detected)
  if (ctx.components.length > 0) {
    await Promise.all(
      ctx.components.map(async (comp) => {
        if (comp.path && comp.languageDistribution.length === 0) {
          comp.languageDistribution = await countFilesByLanguage(path.join(root, comp.path));
        }
      }),
    );
  }

  return ctx;
}
