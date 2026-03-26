import type { AgentConfig } from "../types/index.js";

export const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes per RELIABILITY.md

export const KAICHO_DIR = ".kaicho";
export const RUNS_DIR = "runs";

export const AGENT_CONFIGS: Record<string, AgentConfig> = {
  codex: {
    name: "codex",
    command: "codex",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
};
