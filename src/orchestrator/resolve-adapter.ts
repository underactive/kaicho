import type { AgentAdapter } from "../types/index.js";
import {
  ClaudeAdapter,
  CodexAdapter,
  CursorAdapter,
  GeminiAdapter,
} from "../agent-adapters/index.js";
import { AGENT_CONFIGS } from "../config/index.js";

const ALL_AGENT_NAMES = Object.keys(AGENT_CONFIGS);

export { ALL_AGENT_NAMES };

export function resolveAdapter(agent: string, timeoutMs?: number, model?: string, verbose?: boolean): AgentAdapter {
  const opts: Partial<import("../types/index.js").AgentConfig> = {};
  if (timeoutMs) opts.timeoutMs = timeoutMs;
  if (model) opts.model = model;
  if (verbose) opts.verbose = true;
  const hasOpts = Object.keys(opts).length > 0 ? opts : undefined;

  switch (agent) {
    case "claude":
      return new ClaudeAdapter(hasOpts);
    case "codex":
      return new CodexAdapter(hasOpts);
    case "cursor":
      return new CursorAdapter(hasOpts);
    case "gemini":
      return new GeminiAdapter(hasOpts);
    default:
      throw new Error(
        `Unknown agent: ${agent}. Available: ${ALL_AGENT_NAMES.join(", ")}`,
      );
  }
}
