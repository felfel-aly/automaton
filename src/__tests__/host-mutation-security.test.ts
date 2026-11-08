import { afterEach, describe, expect, it, vi } from "vitest";
import { createSkill, installSkillFromGit, installSkillFromUrl, removeSkill } from "../skills/registry.js";
import { checkUpstream, getRepoInfo } from "../self-mod/upstream.js";

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
});
