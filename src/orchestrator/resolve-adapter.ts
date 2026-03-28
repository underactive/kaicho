import type { AgentAdapter } from "../types/index.js";
import {
  ClaudeAdapter,
  CodexAdapter,
  CursorAdapter,
  GeminiAdapter,
} from "../agent-adapters/index.js";
import { AGENT_CONFIGS, parseAgentSpec } from "../config/index.js";

const ALL_AGENT_NAMES = Object.keys(AGENT_CONFIGS);

export { ALL_AGENT_NAMES };

export function resolveAdapter(agent: string, timeoutMs?: number, model?: string, verbose?: boolean): AgentAdapter {
  const spec = parseAgentSpec(agent);

  if (!AGENT_CONFIGS[spec.base]) {
    throw new Error(
      `Unknown agent: ${spec.base}. Available: ${ALL_AGENT_NAMES.join(", ")}`,
    );
  }

  const opts: Partial<import("../types/index.js").AgentConfig> = {};
  opts.name = spec.fullName;
  if (timeoutMs) opts.timeoutMs = timeoutMs;
  opts.model = model ?? spec.model;
  if (verbose) opts.verbose = true;

  switch (spec.base) {
    case "claude":
      return new ClaudeAdapter(opts);
    case "codex":
      return new CodexAdapter(opts);
    case "cursor":
      return new CursorAdapter(opts);
    case "gemini":
      return new GeminiAdapter(opts);
    default:
      throw new Error(
        `Unknown agent: ${spec.base}. Available: ${ALL_AGENT_NAMES.join(", ")}`,
      );
  }
}
