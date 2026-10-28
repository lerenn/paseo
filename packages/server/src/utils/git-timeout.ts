export const DEFAULT_GIT_TIMEOUT_MS = 90_000;

/**
 * Default timeout for git commands, overridable with PASEO_GIT_TIMEOUT_MS (positive integer ms).
 * Invalid values fall back to the default.
 */
export function resolveGitTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PASEO_GIT_TIMEOUT_MS?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    return DEFAULT_GIT_TIMEOUT_MS;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_GIT_TIMEOUT_MS;
}
