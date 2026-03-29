import type { RepoContext, ComponentContext } from "./fingerprint.js";

/**
 * Find the component that best matches a file path.
 * Uses longest-prefix matching against component paths.
 *
 * Returns null if no components exist or no component matches,
 * signaling the caller should use repo-wide context.
 */
export function resolveComponentForFile(
  ctx: RepoContext,
  filePath: string,
): ComponentContext | null {
  if (ctx.components.length === 0) return null;

  // Normalize: strip leading ./ and ensure forward slashes
  const normalized = filePath.replace(/^\.\//, "").replace(/\\/g, "/");

  let bestMatch: ComponentContext | null = null;
  let bestLen = -1;

  for (const comp of ctx.components) {
    if (comp.path === "") {
      // Root component matches everything, but prefer more specific
      if (bestLen < 0) {
        bestMatch = comp;
        bestLen = 0;
      }
      continue;
    }

    // Check if file is under this component's path
    if (normalized.startsWith(comp.path + "/") || normalized === comp.path) {
      if (comp.path.length > bestLen) {
        bestMatch = comp;
        bestLen = comp.path.length;
      }
    }
  }

  return bestMatch;
}
