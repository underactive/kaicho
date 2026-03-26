import * as fs from "node:fs/promises";
import * as path from "node:path";
import { log } from "../logger/index.js";

const CONFIG_FILENAME = "kaicho.config.json";

export interface KaichoConfig {
  agent?: string;
  task?: string;
  timeout?: number;
  scope?: string;
  files?: string;
  minSeverity?: string;
}

/**
 * Load config from kaicho.config.json in the target repo root.
 * Returns empty object if no config file found.
 */
export async function loadConfig(repoPath: string): Promise<KaichoConfig> {
  const configPath = path.join(repoPath, CONFIG_FILENAME);

  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch {
    return {};
  }

  try {
    const raw = JSON.parse(content) as Record<string, unknown>;
    log("info", "Loaded config", { path: configPath });

    return {
      agent: typeof raw["agent"] === "string" ? raw["agent"] : undefined,
      task: typeof raw["task"] === "string" ? raw["task"] : undefined,
      timeout: typeof raw["timeout"] === "number" ? raw["timeout"] : undefined,
      scope: typeof raw["scope"] === "string" ? raw["scope"] : undefined,
      files: typeof raw["files"] === "string" ? raw["files"] : undefined,
      minSeverity: typeof raw["minSeverity"] === "string" ? raw["minSeverity"] : undefined,
    };
  } catch {
    log("warn", "Invalid config file, ignoring", { path: configPath });
    return {};
  }
}

/**
 * Merge CLI options over config defaults. CLI wins when present.
 */
export function mergeWithConfig<T extends Record<string, unknown>>(
  cliOpts: T,
  config: KaichoConfig,
): T {
  const merged = { ...cliOpts };

  for (const [key, configValue] of Object.entries(config)) {
    if (configValue === undefined) continue;

    const cliValue = merged[key];
    // CLI flag was not provided — use config value
    // Commander sets missing options to undefined; defaults are already applied
    if (cliValue === undefined) {
      (merged as Record<string, unknown>)[key] = configValue;
    }
  }

  return merged;
}
