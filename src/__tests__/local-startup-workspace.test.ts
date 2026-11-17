import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateWorkspaceBeforeStartup } from "../conway/local-startup.js";

describe("local startup workspace preflight", () => {
  let temp: string;
  let root: string;

  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "conway-startup-"));
    root = path.join(temp, "approved");
    fs.mkdirSync(root, { mode: 0o700 });
  });

  afterEach(() => {
    fs.rmSync(temp, { recursive: true, force: true });
  });

  it("never requires local workspace configuration for a remote sandbox", () => {
    expect(validateWorkspaceBeforeStartup("remote-sandbox", undefined)).toBeNull();
  });

  it.skipIf(process.platform !== "linux")("rejects local startup without a workspace before side effects", () => {
    expect(() => validateWorkspaceBeforeStartup("", undefined))
      .toThrow(/workspace root is required/);
  });

  it.skipIf(process.platform !== "linux")("accepts an existing owner-only dedicated workspace", () => {
    expect(validateWorkspaceBeforeStartup("", root)).toBe(root);
  });

  it.skipIf(process.platform !== "linux")("rejects unsafe or symlinked local workspaces", () => {
    fs.chmodSync(root, 0o777);
    expect(() => validateWorkspaceBeforeStartup("", root))
      .toThrow(/owner-only/);
    fs.chmodSync(root, 0o700);
    const alias = path.join(temp, "alias");
    fs.symlinkSync(root, alias, "dir");
    expect(() => validateWorkspaceBeforeStartup("", alias))
      .toThrow(/symlinked path components/);
  });
});
