import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { log } from "../logger/index.js";

const CONFIG_FILENAME = "kaicho.config.json";
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".config", "kaicho");
export const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, "config.json");

export interface KaichoConfig {
  agents?: string[];
  agent?: string;
  task?: string;
  timeout?: number;
  scope?: string;
  files?: string;
  minSeverity?: string;
  models?: Record<string, string>;
  fixModels?: Record<string, string>;
  reviewer?: string;
  retention?: number;
  summarizerModel?: string;
  maxSweepRounds?: number;
}

/**
 * Load config: global (~/.config/kaicho/config.json) merged with
 * per-repo (kaicho.config.json). Per-repo values override global.
 */
export async function loadConfig(repoPath: string): Promise<KaichoConfig> {
  const globalConfig = await loadConfigFile(GLOBAL_CONFIG_PATH);
  const repoConfig = await loadConfigFile(path.join(repoPath, CONFIG_FILENAME));

  // Per-repo overrides global. For models maps, per-repo replaces entirely (not merged key-by-key).
  const merged: KaichoConfig = {};
  for (const key of Object.keys({ ...globalConfig, ...repoConfig }) as (keyof KaichoConfig)[]) {
    const repoVal = repoConfig[key];
    const globalVal = globalConfig[key];
    (merged as Record<string, unknown>)[key] = repoVal ?? globalVal;
  }

  return merged;
}

/**
 * Load and parse a single config file. Returns empty object if not found.
 */
async function loadConfigFile(configPath: string): Promise<KaichoConfig> {
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
      agents: isStringArray(raw["agents"]) ? raw["agents"] : undefined,
      agent: str(raw["agent"]),
      task: str(raw["task"]),
      timeout: num(raw["timeout"]),
      scope: str(raw["scope"]),
      files: str(raw["files"]),
      minSeverity: str(raw["minSeverity"]),
      models: isModelsMap(raw["models"]) ? raw["models"] : undefined,
      fixModels: isModelsMap(raw["fixModels"]) ? raw["fixModels"] : undefined,
      reviewer: str(raw["reviewer"]),
      retention: num(raw["retention"]),
      summarizerModel: str(raw["summarizerModel"]),
      maxSweepRounds: num(raw["maxSweepRounds"]),
    };
  } catch {
    log("warn", "Invalid config file, ignoring", { path: configPath });
    return {};
  }
}

function isModelsMap(val: unknown): val is Record<string, string> {
  if (typeof val !== "object" || val === null || Array.isArray(val)) return false;
  const entries = Object.values(val as Record<string, unknown>);
  if (entries.length === 0) return false; // empty {} treated as unset
  return entries.every((v) => typeof v === "string");
}

function str(val: unknown): string | undefined {
  return typeof val === "string" && val !== "" ? val : undefined;
}

function num(val: unknown): number | undefined {
  return typeof val === "number" ? val : undefined;
}

function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.length > 0 && val.every((v) => typeof v === "string");
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
