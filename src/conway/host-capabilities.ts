/** Explicit, independent per-operation grants for host mutations.
 * The historical process-wide CONWAY_HOST_MUTATION_ENABLED must never
 * authorize all skill and Git operations at once. */
export const HOST_CAPABILITY_ENV = {
  install_skill: "CONWAY_HOST_INSTALL_SKILL_ENABLED",
  create_skill: "CONWAY_HOST_CREATE_SKILL_ENABLED",
  remove_skill: "CONWAY_HOST_REMOVE_SKILL_ENABLED",
  review_upstream_changes: "CONWAY_HOST_REVIEW_UPSTREAM_ENABLED",
  pull_upstream: "CONWAY_HOST_PULL_UPSTREAM_ENABLED",
} as const;

export type HostCapability = keyof typeof HOST_CAPABILITY_ENV;

export function hasHostCapability(capability: HostCapability): boolean {
  // Only the exact, affirmative per-operation flag grants execution.
  return process.env[HOST_CAPABILITY_ENV[capability]] === "1";
}

export function requireHostCapability(capability: HostCapability): void {
  if (!hasHostCapability(capability)) {
    throw new Error(
      "Conway host operation " + capability +
      " is disabled: explicit operator approval is required.",
    );
  }
}
