import type { RepoContext } from "./fingerprint.js";

/**
 * Format a RepoContext into a prompt-ready string block.
 *
 * Returns empty string if nothing was detected (graceful no-op).
 * Only includes lines for fields that have values.
 */
export function formatRepoContext(ctx: RepoContext): string {
  const lines: string[] = [];

  if (ctx.languages.length > 0) {
    lines.push(`- Languages: ${ctx.languages.map((s) => s.name).join(", ")}`);
  }
  if (ctx.frameworks.length > 0) {
    lines.push(`- Frameworks: ${ctx.frameworks.map((s) => s.name).join(", ")}`);
  }
  if (ctx.testRunners.length > 0) {
    lines.push(`- Test runner: ${ctx.testRunners.map((s) => s.name).join(", ")}`);
  }
  if (ctx.linters.length > 0) {
    lines.push(`- Linters: ${ctx.linters.map((s) => s.name).join(", ")}`);
  }
  if (ctx.entryPoints.length > 0) {
    lines.push(`- Entry points: ${ctx.entryPoints.join(", ")}`);
  }
  if (ctx.packageManager) {
    lines.push(`- Package manager: ${ctx.packageManager}`);
  }
  if (ctx.monorepoTool) {
    lines.push(`- Monorepo: ${ctx.monorepoTool}`);
  }
  if (ctx.architectureDocs.length > 0) {
    lines.push(`- Architecture docs: ${ctx.architectureDocs.join(", ")}`);
  }

  if (lines.length === 0) return "";

  return `PROJECT CONTEXT (best-effort repo-level hints — may be incomplete or outdated):\n${lines.join("\n")}`;
}
