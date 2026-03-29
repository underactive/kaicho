import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { LanguageShare } from "./fingerprint.js";

const EXT_TO_LANGUAGE: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".pyw": "Python",
  ".rs": "Rust",
  ".go": "Go",
  ".java": "Java",
  ".kt": "Kotlin", ".kts": "Kotlin",
  ".cs": "C#",
  ".fs": "F#", ".fsx": "F#",
  ".cpp": "C++", ".cc": "C++", ".cxx": "C++", ".hpp": "C++", ".hxx": "C++", ".h": "C++",
  ".c": "C",
  ".m": "Objective-C", ".mm": "Objective-C++",
  ".swift": "Swift",
  ".rb": "Ruby", ".erb": "Ruby",
  ".php": "PHP",
  ".dart": "Dart",
  ".lua": "Lua",
  ".zig": "Zig",
  ".ex": "Elixir", ".exs": "Elixir",
  ".scala": "Scala",
  ".clj": "Clojure", ".cljs": "Clojure",
  ".ino": "Arduino",
  ".vue": "Vue",
  ".svelte": "Svelte",
};

const SKIP_DIRS = new Set([
  "node_modules", ".git", "vendor", "third_party", "thirdparty",
  "dist", "build", "out", ".pio", "__pycache__", ".next",
  "target", "Pods", ".gradle", "bin", "obj",
]);

const MAX_FILES_SCANNED = 250_000;

/**
 * Walk the file tree and count files by language (via extension).
 * Lightweight Linguist-style distribution without reading file contents.
 */
export async function countFilesByLanguage(root: string): Promise<LanguageShare[]> {
  const counts = new Map<string, number>();
  let total = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 10 || total >= MAX_FILES_SCANNED) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (total >= MAX_FILES_SCANNED) return;
      if (entry.name.startsWith(".")) continue;

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(path.join(dir, entry.name), depth + 1);
        }
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const lang = EXT_TO_LANGUAGE[ext];
        if (lang) {
          counts.set(lang, (counts.get(lang) ?? 0) + 1);
          total++;
        }
      }
    }
  }

  await walk(root, 0);

  if (total === 0) return [];

  return [...counts.entries()]
    .map(([language, files]) => ({
      language,
      files,
      percentage: Math.round((files / total) * 1000) / 10,
    }))
    .sort((a, b) => b.files - a.files);
}
