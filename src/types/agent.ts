import type { Suggestion } from "./suggestion.js";

export interface AgentConfig {
  name: string;
  command: string;
  timeoutMs: number;
  model?: string;
}

export type RunStatus =
  | "success"
  | "timeout"
  | "parse-error"
  | "agent-error"
  | "skipped";

export interface RunResult {
  agent: string;
  status: RunStatus;
  suggestions: Suggestion[];
  rawOutput: string;
  rawError: string;
  durationMs: number;
  startedAt: string;
  error?: string;
}

export type AgentMode = "scan" | "fix";

export interface AgentAdapter {
  readonly config: AgentConfig;

  /**
   * Check if the agent CLI is installed and reachable.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Execute the agent against a target repo with a given prompt.
   * MUST NOT throw — always returns a RunResult.
   *
   * @param mode "scan" = read-only (default), "fix" = write access
   */
  run(repoPath: string, prompt: string, mode?: AgentMode): Promise<RunResult>;
}
