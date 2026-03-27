import type { AgentConfig } from "../types/index.js";

export const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes — full-repo scans take 5-9 min

export const KAICHO_DIR = ".kaicho";
export const RUNS_DIR = "runs";

export const AGENT_CONFIGS: Record<string, AgentConfig> = {
  claude: {
    name: "claude",
    command: "claude",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  codex: {
    name: "codex",
    command: "codex",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  cursor: {
    name: "cursor",
    command: "agent",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  gemini: {
    name: "gemini",
    command: "gemini",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
};
