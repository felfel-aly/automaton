import { afterEach, describe, expect, it, vi } from "vitest";
import { createSkill, installSkillFromGit, installSkillFromUrl, removeSkill } from "../skills/registry.js";
import { checkUpstream, getRepoInfo } from "../self-mod/upstream.js";
import { hasHostCapability, HOST_CAPABILITY_ENV } from "../conway/host-capabilities.js";

describe("host mutation capability boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses host Git and skill writes without explicit process approval", async () => {
    vi.stubEnv("CONWAY_HOST_MUTATION_ENABLED", "");
    await expect(
      installSkillFromGit("https://example.invalid/skill.git", "valid-skill", "/tmp/unapproved-skills", {} as any, {} as any),
    ).rejects.toThrow(/explicit operator approval/);
    await expect(
      installSkillFromUrl("https://example.invalid/SKILL.md", "valid-skill", "/tmp/unapproved-skills", {} as any, {} as any),
    ).rejects.toThrow(/explicit operator approval/);
    await expect(
      createSkill("valid-skill", "desc", "instructions", "/tmp/unapproved-skills", {} as any, {} as any),
    ).rejects.toThrow(/explicit operator approval/);
    await expect(
      removeSkill("valid-skill", {} as any, {} as any, "/tmp/unapproved-skills", false),
    ).rejects.toThrow(/explicit operator approval/);
  });

  it("refuses direct host Git access without explicit process approval", () => {
    vi.stubEnv("CONWAY_HOST_MUTATION_ENABLED", "");
    expect(() => getRepoInfo()).toThrow(/explicit operator approval/);
    expect(() => checkUpstream()).toThrow(/explicit operator approval/);
  });
  it("does not grant unrelated capabilities through the historical umbrella flag", () => {
    vi.stubEnv("CONWAY_HOST_MUTATION_ENABLED", "1");
    for (const [capability, variable] of Object.entries(HOST_CAPABILITY_ENV)) {
      vi.stubEnv(variable, "");
      expect(hasHostCapability(capability as keyof typeof HOST_CAPABILITY_ENV)).toBe(false);
    }
  });

  it("requires an independent affirmative flag for each host operation", () => {
    const entries = Object.entries(HOST_CAPABILITY_ENV) as
      [keyof typeof HOST_CAPABILITY_ENV, string][];
    for (const [capability, variable] of entries) {
      for (const [, other] of entries) vi.stubEnv(other, "");
      vi.stubEnv(variable, "1");
      expect(hasHostCapability(capability)).toBe(true);
      for (const [otherCapability] of entries) {
        if (otherCapability !== capability) {
          expect(hasHostCapability(otherCapability)).toBe(false);
        }
      }
    }
  });

  it("does not let a review-only grant authorize host skill changes", async () => {
    vi.stubEnv("CONWAY_HOST_MUTATION_ENABLED", "1");
    vi.stubEnv("CONWAY_HOST_REVIEW_UPSTREAM_ENABLED", "1");
    vi.stubEnv("CONWAY_HOST_INSTALL_SKILL_ENABLED", "");
    await expect(
      installSkillFromGit("https://example.invalid/skill.git",
        "valid-skill", "/tmp/no-install-expected", {} as any, {} as any),
    ).rejects.toThrow(/explicit operator approval/);
  });

});
