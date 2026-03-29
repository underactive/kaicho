import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { fingerprint, formatRepoContext } from "../../repo-context/index.js";

const NO_COLOR = "NO_COLOR" in process.env;

function color(text: string, code: string): string {
  if (NO_COLOR) return text;
  return `${code}${text}\x1b[0m`;
}

const LANG_COLORS: Record<string, string> = {
  "TypeScript": "\x1b[34m", "JavaScript": "\x1b[33m", "Python": "\x1b[34m",
  "Rust": "\x1b[31m", "Go": "\x1b[36m", "Java": "\x1b[31m", "Kotlin": "\x1b[35m",
  "C#": "\x1b[32m", "F#": "\x1b[34m", "C++": "\x1b[31m", "C": "\x1b[90m",
  "C/C++": "\x1b[31m", "Swift": "\x1b[33m", "Ruby": "\x1b[31m", "PHP": "\x1b[35m",
  "Dart": "\x1b[36m", "Lua": "\x1b[34m", "Zig": "\x1b[33m",
  "Elixir": "\x1b[35m", "Scala": "\x1b[31m",
};

function buildDistributionBar(shares: { language: string; percentage: number }[], width: number): string {
  if (NO_COLOR) {
    return shares.map((s) => `${s.language} ${s.percentage}%`).join(" | ");
  }
  let bar = "";
  for (const s of shares) {
    const chars = Math.max(1, Math.round((s.percentage / 100) * width));
    const c = LANG_COLORS[s.language] ?? "\x1b[90m";
    bar += `${c}${"█".repeat(chars)}\x1b[0m`;
  }
  return bar;
}

export const fingerprintCommand = new Command("fingerprint")
  .description("Show what Kaicho detects about a repository")
  .argument("[repo]", "Path to target repository", ".")
  .option("--json", "Output raw RepoContext as JSON")
  .action(async (rawRepo: string, opts: { json?: boolean }) => {
    const expanded = rawRepo.startsWith("~")
      ? path.join(os.homedir(), rawRepo.slice(1))
      : rawRepo;
    const repoPath = path.resolve(expanded);
    const out = process.stdout;

    try {
      const ctx = await fingerprint(repoPath);

      if (opts.json === true || !process.stdout.isTTY) {
        out.write(JSON.stringify(ctx, null, 2) + "\n");
        return;
      }

      out.write(`\n  ${color("Fingerprint:", "\x1b[1m")} ${repoPath}\n\n`);

      const field = (label: string, values: { name: string; source: string }[]) => {
        if (values.length === 0) return;
        const items = values.map((v) =>
          `${color(v.name, "\x1b[1m")} ${color(`(${v.source})`, "\x1b[90m")}`,
        );
        out.write(`  ${label.padEnd(16)} ${items.join(", ")}\n`);
      };

      // Language distribution (GitHub Linguist-style)
      if (ctx.languageDistribution.length > 0) {
        const top = ctx.languageDistribution.slice(0, 8);
        const bar = buildDistributionBar(top, 40);
        out.write(`  ${color("Distribution", "\x1b[1m")}   ${bar}\n`);
        // Two-column layout
        for (let i = 0; i < top.length; i += 2) {
          const left = `${color(top[i]!.language, "\x1b[1m")} ${top[i]!.percentage}%`;
          const right = top[i + 1]
            ? `${color(top[i + 1]!.language, "\x1b[1m")} ${top[i + 1]!.percentage}%`
            : "";
          out.write(`  ${" ".repeat(16)} ${left.padEnd(38)}${right}\n`);
        }
        out.write("\n");
      }

      field("Languages", ctx.languages);
      field("Frameworks", ctx.frameworks);
      field("Test runners", ctx.testRunners);
      field("Linters", ctx.linters);

      if (ctx.entryPoints.length > 0) {
        out.write(`  ${"Entry points".padEnd(16)} ${ctx.entryPoints.map((e) => color(e, "\x1b[1m")).join(", ")}\n`);
      }
      if (ctx.packageManager) {
        out.write(`  ${"Package mgr".padEnd(16)} ${color(ctx.packageManager, "\x1b[1m")}\n`);
      }
      if (ctx.monorepoTool) {
        out.write(`  ${"Monorepo".padEnd(16)} ${color(ctx.monorepoTool, "\x1b[1m")}\n`);
      }
      if (ctx.workspacePackages.length > 0) {
        out.write(`  ${"Workspaces".padEnd(16)} ${ctx.workspacePackages.map((w) => color(w, "\x1b[1m")).join(", ")}\n`);
      }
      if (ctx.architectureDocs.length > 0) {
        out.write(`  ${"Arch docs".padEnd(16)} ${ctx.architectureDocs.map((d) => color(d, "\x1b[90m")).join(", ")}\n`);
      }

      // Show component breakdown
      if (ctx.components.length > 0) {
        out.write(`\n  ${color("Components:", "\x1b[1m")}\n`);
        for (const comp of ctx.components) {
          const label = comp.path || "(root)";
          const langs = comp.languages.map((l) => l.name).join(", ");
          const fws = comp.frameworks.length > 0 ? ` + ${comp.frameworks.map((f) => f.name).join(", ")}` : "";
          out.write(`    ${color(label, "\x1b[1m")} — ${langs}${fws}\n`);
        }
      }

      // Show what agents would see
      const formatted = formatRepoContext(ctx);
      if (formatted) {
        out.write(`\n  ${color("Prompt block:", "\x1b[1m")}\n`);
        for (const line of formatted.split("\n")) {
          out.write(`  ${color(line, "\x1b[90m")}\n`);
        }
      } else {
        out.write(`\n  ${color("No signals detected.", "\x1b[33m")}\n`);
      }

      out.write("\n");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  ${color("Error:", "\x1b[31m")} ${msg}\n\n`);
      process.exit(1);
    }
  });
