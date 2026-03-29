import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { RepoContext } from "./fingerprint.js";
import { readSafe, exists } from "./fingerprint.js";
import type { PackageJson } from "./detectors.js";
import { detectFromPackageJson, detectFromCargoToml, detectFromPyprojectToml } from "./detectors.js";

const MAX_WORKSPACE_PACKAGES = 20;

/**
 * Extract workspace glob patterns from the monorepo config.
 */
export function extractWorkspacePatterns(
  monorepoTool: string,
  packageJsonRaw: string | null,
  cargoTomlRaw: string | null,
  pnpmWorkspaceRaw: string | null,
  lernaJsonRaw: string | null,
): string[] {
  if (monorepoTool === "npm workspaces" && packageJsonRaw) {
    try {
      const pkg = JSON.parse(packageJsonRaw) as PackageJson;
      if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
      if (pkg.workspaces && Array.isArray((pkg.workspaces as { packages: string[] }).packages)) {
        return (pkg.workspaces as { packages: string[] }).packages;
      }
    } catch { /* skip */ }
  }

  if (monorepoTool === "pnpm workspaces" && pnpmWorkspaceRaw) {
    // Simple regex parse: lines after "packages:" starting with "- "
    const lines = pnpmWorkspaceRaw.split("\n");
    const patterns: string[] = [];
    let inPackages = false;
    for (const line of lines) {
      if (/^packages\s*:/i.test(line)) { inPackages = true; continue; }
      if (inPackages) {
        const match = line.match(/^\s*-\s*['"]?([^'"#\s]+)['"]?\s*/);
        if (match?.[1]) {
          patterns.push(match[1]);
        } else if (/^\S/.test(line)) {
          break; // New top-level key
        }
      }
    }
    return patterns;
  }

  if (monorepoTool === "lerna" && lernaJsonRaw) {
    try {
      const lerna = JSON.parse(lernaJsonRaw) as { packages?: string[] };
      if (Array.isArray(lerna.packages)) return lerna.packages;
    } catch { /* skip */ }
    return ["packages/*"]; // Lerna default
  }

  if (monorepoTool === "cargo workspaces" && cargoTomlRaw) {
    const membersMatch = cargoTomlRaw.match(/\[workspace]\s*\n[\s\S]*?members\s*=\s*\[([^\]]*)\]/m);
    if (membersMatch?.[1]) {
      return membersMatch[1].match(/"([^"]+)"/g)?.map((s) => s.replace(/"/g, "")) ?? [];
    }
  }

  return [];
}

/**
 * Resolve workspace glob patterns to actual directories.
 * Supports simple `dir/*` patterns via fs.readdir. Literal paths checked directly.
 */
export async function resolveWorkspacePaths(root: string, patterns: string[]): Promise<string[]> {
  const results: string[] = [];

  for (const pattern of patterns) {
    if (pattern.endsWith("/*")) {
      // Glob: list parent directory, filter for dirs with a manifest
      const parent = path.join(root, pattern.slice(0, -2));
      try {
        const entries = await fs.readdir(parent, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith(".")) continue;
          results.push(path.join(parent, entry.name));
          if (results.length >= MAX_WORKSPACE_PACKAGES) return results;
        }
      } catch {
        // Parent doesn't exist, skip
      }
    } else {
      // Literal path
      const dir = path.join(root, pattern);
      if (await exists(dir)) {
        results.push(dir);
        if (results.length >= MAX_WORKSPACE_PACKAGES) return results;
      }
    }
  }

  return results;
}

/**
 * Fingerprint a single workspace package by reading its manifest.
 */
export async function fingerprintPackage(pkgPath: string, root: string, ctx: RepoContext): Promise<void> {
  const rel = path.relative(root, pkgPath);

  // Try each manifest type concurrently
  const [pkgJson, cargoToml, pyproject] = await Promise.all([
    readSafe(path.join(pkgPath, "package.json")),
    readSafe(path.join(pkgPath, "Cargo.toml")),
    readSafe(path.join(pkgPath, "pyproject.toml")),
  ]);

  if (pkgJson) detectFromPackageJson(pkgJson, ctx, `${rel}/package.json`);
  if (cargoToml) detectFromCargoToml(cargoToml, ctx, `${rel}/Cargo.toml`);
  if (pyproject) detectFromPyprojectToml(pyproject, ctx, `${rel}/pyproject.toml`);
}
