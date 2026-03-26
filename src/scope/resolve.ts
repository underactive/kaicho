import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";
import { log } from "../logger/index.js";

export interface ScopeOptions {
  /** Directory path(s) relative to repo root, e.g. "src/" or "src/,lib/" */
  scope?: string;
  /** Glob pattern(s) for files, e.g. "*.ts" or "*.ts,*.js" */
  files?: string;
}

/**
 * Resolve a scoped file list from the repo.
 *
 * Uses `git ls-files` to get tracked files (respects .gitignore),
 * then filters by scope directories and file glob patterns.
 *
 * Returns the file list as a newline-separated string for prompt injection,
 * or null if no scoping was requested (full repo scan).
 */
export async function resolveScope(
  repoPath: string,
  options: ScopeOptions,
): Promise<string[] | null> {
  if (!options.scope && !options.files) {
    return null; // No scoping — full repo scan
  }

  const allFiles = await listRepoFiles(repoPath);

  let filtered = allFiles;

  // Filter by directory scope
  if (options.scope) {
    const dirs = options.scope.split(",").map((d) => d.trim().replace(/\/$/, ""));
    filtered = filtered.filter((f) =>
      dirs.some((dir) => f.startsWith(dir + "/") || f === dir),
    );
  }

  // Filter by file glob patterns
  if (options.files) {
    const patterns = options.files.split(",").map((p) => p.trim());
    filtered = filtered.filter((f) =>
      patterns.some((pattern) => matchGlob(f, pattern)),
    );
  }

  log("info", "Scope resolved", {
    total: allFiles.length,
    filtered: filtered.length,
    scope: options.scope ?? null,
    files: options.files ?? null,
  });

  return filtered;
}

/**
 * Build a file manifest string for prompt injection.
 */
export function buildFileManifest(files: string[]): string {
  if (files.length === 0) return "No files match the given scope.";

  const MAX_FILES = 200;
  const shown = files.slice(0, MAX_FILES);
  const header = `Files to review (${files.length} total):`;
  const list = shown.join("\n");
  const truncated = files.length > MAX_FILES
    ? `\n... and ${files.length - MAX_FILES} more files`
    : "";

  return `${header}\n${list}${truncated}`;
}

async function listRepoFiles(repoPath: string): Promise<string[]> {
  try {
    // git ls-files gives us tracked files, respecting .gitignore
    const result = await execa("git", ["ls-files"], {
      cwd: repoPath,
      reject: false,
    });

    if (result.exitCode === 0 && result.stdout.trim()) {
      return result.stdout.trim().split("\n");
    }
  } catch {
    // Not a git repo or git not available
  }

  // Fallback: walk the directory (skip common non-source dirs)
  return walkDir(repoPath, repoPath);
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".kaicho",
  "vendor", "__pycache__", ".next", ".nuxt", "coverage",
]);

async function walkDir(dir: string, root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walkDir(fullPath, root));
    } else if (entry.isFile()) {
      files.push(path.relative(root, fullPath));
    }
  }

  return files;
}

/**
 * Simple glob matching supporting * and ** patterns.
 * Matches against the full relative path or just the filename.
 */
function matchGlob(filePath: string, pattern: string): boolean {
  const fileName = path.basename(filePath);

  // Simple extension match: "*.ts" matches any .ts file
  if (pattern.startsWith("*.")) {
    const ext = pattern.slice(1); // ".ts"
    return fileName.endsWith(ext);
  }

  // Directory prefix: "src/**" matches anything under src/
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return filePath.startsWith(prefix + "/") || filePath === prefix;
  }

  // Exact match
  return filePath === pattern || fileName === pattern;
}
