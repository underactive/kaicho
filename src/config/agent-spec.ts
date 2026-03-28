/**
 * Agent variant naming: "base:variant" (e.g. "cursor:gemini-3.1-pro").
 * The variant part doubles as the default model name.
 * Bare names like "cursor" are unchanged — no variant, no implied model.
 */

export interface AgentSpec {
  /** Full variant name as used in storage and attribution (e.g. "cursor:gemini-3.1-pro") */
  fullName: string;
  /** Base adapter name — key in AGENT_CONFIGS (e.g. "cursor") */
  base: string;
  /** Variant label, or undefined for bare names */
  variant: string | undefined;
  /** Model to pass to the adapter (same as variant when present) */
  model: string | undefined;
}

export function parseAgentSpec(agent: string): AgentSpec {
  const colonIdx = agent.indexOf(":");
  if (colonIdx === -1) {
    return { fullName: agent, base: agent, variant: undefined, model: undefined };
  }
  const base = agent.slice(0, colonIdx);
  const variant = agent.slice(colonIdx + 1);
  if (!base || !variant) {
    throw new Error(`Invalid agent variant: "${agent}". Expected "base:variant".`);
  }
  return { fullName: agent, base, variant, model: variant };
}

/** Get the base adapter name from any agent name (strips variant if present). */
export function getBase(agent: string): string {
  const idx = agent.indexOf(":");
  return idx === -1 ? agent : agent.slice(0, idx);
}

/**
 * Look up a model for an agent in a models map.
 * Checks exact match first (e.g. "cursor:gemini-3.1-pro"),
 * then falls back to base name (e.g. "cursor").
 */
export function resolveModel(
  agentName: string,
  models?: Record<string, string>,
): string | undefined {
  if (!models) return undefined;
  if (models[agentName] !== undefined) return models[agentName];
  const base = getBase(agentName);
  if (base !== agentName) return models[base];
  return undefined;
}
