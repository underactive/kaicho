import type { RepoContext, ComponentContext, DetectedSignal, LanguageShare } from "./fingerprint.js";
import { resolveComponentForFile } from "./component-resolver.js";

/**
 * Format a RepoContext into a prompt-ready string block.
 *
 * Returns empty string if nothing was detected (graceful no-op).
 * Only includes lines for fields that have values.
 */
export function formatRepoContext(ctx: RepoContext): string {
  const lines: string[] = [];

  if (ctx.languageDistribution.length > 0) {
    const top = ctx.languageDistribution.slice(0, 5);
    lines.push(`- Languages: ${top.map((s) => `${s.language} (${s.percentage}%)`).join(", ")}`);
  } else if (ctx.languages.length > 0) {
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
  if (ctx.workspacePackages.length > 0) {
    const MAX_DISPLAY = 10;
    const shown = ctx.workspacePackages.slice(0, MAX_DISPLAY);
    const suffix = ctx.workspacePackages.length > MAX_DISPLAY
      ? ` (+${ctx.workspacePackages.length - MAX_DISPLAY} more)`
      : "";
    lines.push(`- Workspace packages: ${shown.join(", ")}${suffix}`);
  }
  if (ctx.architectureDocs.length > 0) {
    lines.push(`- Architecture docs: ${ctx.architectureDocs.join(", ")}`);
  }
  if (ctx.components.length > 0) {
    const map = ctx.components.map((c) => {
      const lang = c.languages[0]?.name ?? "unknown";
      const fws = c.frameworks.length > 0 ? ` (${c.frameworks.map((f) => f.name).join(", ")})` : "";
      return `${c.path || "(root)"}=${lang}${fws}`;
    });
    lines.push(`- Project structure: ${map.join(", ")}`);
  }

  if (lines.length === 0) return "";

  return `PROJECT CONTEXT (best-effort repo-level hints — may be incomplete or outdated):\n${lines.join("\n")}`;
}

/**
 * Format context scoped to the component that contains a specific file.
 * Falls back to repo-wide context if no component matches.
 */
export function formatContextForFile(ctx: RepoContext, filePath: string): string {
  const comp = resolveComponentForFile(ctx, filePath);
  if (!comp) return formatRepoContext(ctx);
  return formatComponent(comp, ctx);
}

function formatLanguages(dist: LanguageShare[], signals: DetectedSignal[]): string | null {
  if (dist.length > 0) {
    const top = dist.slice(0, 5);
    return `- Languages: ${top.map((s) => `${s.language} (${s.percentage}%)`).join(", ")}`;
  }
  if (signals.length > 0) {
    return `- Languages: ${signals.map((s) => s.name).join(", ")}`;
  }
  return null;
}

function formatComponent(comp: ComponentContext, ctx: RepoContext): string {
  const lines: string[] = [];

  const langLine = formatLanguages(comp.languageDistribution, comp.languages);
  if (langLine) lines.push(langLine);

  if (comp.frameworks.length > 0) {
    lines.push(`- Frameworks: ${comp.frameworks.map((s) => s.name).join(", ")}`);
  }
  if (comp.testRunners.length > 0) {
    lines.push(`- Test runner: ${comp.testRunners.map((s) => s.name).join(", ")}`);
  }
  if (comp.linters.length > 0) {
    lines.push(`- Linters: ${comp.linters.map((s) => s.name).join(", ")}`);
  }
  if (comp.entryPoints.length > 0) {
    lines.push(`- Entry points: ${comp.entryPoints.join(", ")}`);
  }

  // Include repo-wide fields that are always relevant
  if (comp.packageManager ?? ctx.packageManager) {
    lines.push(`- Package manager: ${comp.packageManager ?? ctx.packageManager}`);
  }
  if (ctx.monorepoTool) {
    lines.push(`- Monorepo: ${ctx.monorepoTool}`);
  }
  if (ctx.architectureDocs.length > 0) {
    lines.push(`- Architecture docs: ${ctx.architectureDocs.join(", ")}`);
  }
  if (ctx.components.length > 1) {
    const map = ctx.components.map((c) => {
      const lang = c.languages[0]?.name ?? "unknown";
      return `${c.path || "(root)"}=${lang}`;
    });
    lines.push(`- Project structure: ${map.join(", ")}`);
  }

  if (lines.length === 0) return formatRepoContext(ctx);

  const scope = comp.path ? `component "${comp.path}"` : "root component";
  return `PROJECT CONTEXT (best-effort hints for ${scope} — may be incomplete or outdated):\n${lines.join("\n")}`;
}
