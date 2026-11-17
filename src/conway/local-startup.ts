/** Validate local-only workspace before initializing wallets, state or agents. */
import { requireApprovedLocalRoot } from "./local-security.js";

export function validateWorkspaceBeforeStartup(
  sandboxId: string,
  configuredRoot: string | undefined,
): string | null {
  if (sandboxId) return null;
  return requireApprovedLocalRoot(configuredRoot);
}
