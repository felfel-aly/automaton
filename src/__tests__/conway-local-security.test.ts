import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createConwayClient } from "../conway/client.js";

function localClient(root: string | undefined, enabled = false) {
  return createConwayClient({
    apiUrl: "https://example.invalid",
    apiKey: "",
    sandboxId: "",
    localWorkspaceRoot: root,
    localExecEnabled: enabled,
  });
}

describe("Conway local-mode security boundaries", () => {
  let temp: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "conway-local-security-"));
    root = path.join(temp, "work");
    outside = path.join(temp, "outside");
    fs.mkdirSync(root, { mode: 0o700 });
    fs.mkdirSync(outside, { mode: 0o700 });
  });

  afterEach(() => {
    fs.rmSync(temp, { recursive: true, force: true });
  });

  it("rejects using the entire user home or code checkout as a workspace", async () => {
    await expect(localClient(process.env.HOME).writeFile("not-allowed.txt", "bad")).rejects.toThrow(/dedicated directory/);
    await expect(localClient(process.cwd()).writeFile("not-allowed.txt", "bad")).rejects.toThrow(/dedicated directory/);
  });

  it("rejects a replacement of the approved root inode during validation", async () => {
    const originalLstat = fs.lstatSync.bind(fs);
    let switched = false;
    const spy = vi.spyOn(fs, "lstatSync").mockImplementation(((filePath: fs.PathLike, options?: unknown) => {
      const stat = originalLstat(filePath, options as never);
      if (!switched && String(filePath) === root) {
        switched = true;
        fs.renameSync(root, path.join(temp, "renamed-root"));
        fs.mkdirSync(root, { mode: 0o700 });
      }
      return stat;
    }) as typeof fs.lstatSync);
    try {
      await expect(localClient(root).writeFile("sample.txt", "bad"))
        .rejects.toThrow(/changed during validation/);
      expect(switched).toBe(true);
      expect(fs.existsSync(path.join(root, "sample.txt"))).toBe(false);
      expect(fs.existsSync(path.join(temp, "renamed-root", "sample.txt"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("requires an explicitly approved workspace root", async () => {
    await expect(localClient("").writeFile("file.txt", "secret")).rejects.toThrow(/workspace root is required/);
    await expect(localClient("").readFile("file.txt")).rejects.toThrow(/workspace root is required/);
  });

  it("reads and writes ordinary files inside the approved workspace", async () => {
    const client = localClient(root);
    await client.writeFile("sub/file.txt", "safe content");
    expect(await client.readFile("sub/file.txt")).toBe("safe content");
    expect(fs.readFileSync(path.join(root, "sub/file.txt"), "utf8")).toBe("safe content");
  });

  it("never overwrites an existing local file, including direct client writes", async () => {
    const client = localClient(root);
    await client.writeFile("existing.txt", "initial content");
    await expect(client.writeFile("existing.txt", "replacement")).rejects.toThrow();
    expect(fs.readFileSync(path.join(root, "existing.txt"), "utf8")).toBe("initial content");
  });

  it("refuses absolute and relative destinations outside the approved workspace", async () => {
    const client = localClient(root);
    await expect(client.writeFile(path.join(outside, "blocked.txt"), "bad")).rejects.toThrow(/outside the approved workspace/);
    await expect(client.writeFile("../outside/blocked.txt", "bad")).rejects.toThrow(/traversal/);
    expect(fs.existsSync(path.join(outside, "blocked.txt"))).toBe(false);
  });

  it("refuses an existing symlink destination", async () => {
    const target = path.join(outside, "important.txt");
    fs.writeFileSync(target, "unchanged", "utf8");
    fs.symlinkSync(target, path.join(root, "linked.txt"));
    const client = localClient(root);
    await expect(client.writeFile("linked.txt", "bad")).rejects.toThrow(/symlink/);
    await expect(client.readFile("linked.txt")).rejects.toThrow(/symlink/);
    expect(fs.readFileSync(target, "utf8")).toBe("unchanged");
  });

  it("refuses a symlinked parent, including a dangling destination path", async () => {
    fs.symlinkSync(outside, path.join(root, "redirect"), "dir");
    const client = localClient(root);
    await expect(client.writeFile("redirect/new.txt", "bad")).rejects.toThrow(/symlink/);
    await expect(client.readFile("redirect/new.txt")).rejects.toThrow(/symlink/);
    expect(fs.existsSync(path.join(outside, "new.txt"))).toBe(false);
  });

  it("refuses hardlinked external destinations and credential names", async () => {
    const target = path.join(outside, "important.txt");
    fs.writeFileSync(target, "unchanged", "utf8");
    fs.linkSync(target, path.join(root, "link.txt"));
    const client = localClient(root);
    await expect(client.writeFile("link.txt", "bad")).rejects.toThrow(/EEXIST|singly linked/);
    await expect(client.readFile("link.txt")).rejects.toThrow(/singly linked/);
    await expect(client.writeFile(".env.production", "bad")).rejects.toThrow(/credential/);
    await expect(client.readFile("wallet.json")).rejects.toThrow(/credential/);
    expect(fs.readFileSync(target, "utf8")).toBe("unchanged");
  });

  it("rejects a workspace root that is a symlink or world-writable", async () => {
    const alias = path.join(temp, "alias");
    fs.symlinkSync(root, alias, "dir");
    await expect(localClient(alias).writeFile("x.txt", "bad")).rejects.toThrow(/symlinked path components/);
    fs.chmodSync(root, 0o755);
    await expect(localClient(root).writeFile("x.txt", "bad")).rejects.toThrow(/owner-only/);
    fs.chmodSync(root, 0o770);
    await expect(localClient(root).writeFile("x.txt", "bad")).rejects.toThrow(/non-group\/world-writable/);
    fs.chmodSync(root, 0o777);
    await expect(localClient(root).writeFile("x.txt", "bad")).rejects.toThrow(/non-group\/world-writable/);
  });

  it("does not interpret a missing remote-scoped ID as local mode", async () => {
    const client = localClient(root, true);
    expect(() => client.createScopedClient("")).toThrow(/valid sandbox ID/);
    expect(() => client.createScopedClient("undefined")).toThrow(/valid sandbox ID/);
    expect(() => client.createScopedClient(" null ")).toThrow(/valid sandbox ID/);
    expect(client.createScopedClient("remote-test-id")).toBeDefined();
  });

  it("rejects unowned or unsafe intermediate directories", async () => {
    const blockedParent = path.join(root, "unsafe");
    fs.mkdirSync(blockedParent, { mode: 0o777 });
    fs.chmodSync(blockedParent, 0o777);
    const client = localClient(root);
    await expect(client.writeFile("unsafe/file.txt", "bad")).rejects.toThrow(/non-group\/world-writable/);
    expect(fs.existsSync(path.join(blockedParent, "file.txt"))).toBe(false);
  });

  it.skipIf(process.platform !== "linux" || !fs.existsSync("/usr/bin/bwrap"))(
    "refuses an external hardlink before binding the workspace for shell execution",
    async () => {
      const target = path.join(outside, "important.txt");
      fs.writeFileSync(target, "unchanged", "utf8");
      fs.linkSync(target, path.join(root, "linked.txt"));
      await expect(localClient(root, true).exec("printf bad > linked.txt")).rejects.toThrow(/hardlink/);
      expect(fs.readFileSync(target, "utf8")).toBe("unchanged");
    },
  );

  it("denies all local shell commands without an explicit capability grant", async () => {
    await expect(localClient(root).exec("printf never")).rejects.toThrow(/disabled/);
  });

  it.skipIf(process.platform !== "linux" || !fs.existsSync("/usr/bin/bwrap"))(
    "runs approved commands in a private mount and environment namespace",
    async () => {
      const client = localClient(root, true);
      process.env.CONWAY_FAKE_TEST_SECRET = "test-only-fake-value";
      try {
        const result = await client.exec(
          'test ! -e /home && test ! -e /mnt && test -z "$CONWAY_FAKE_TEST_SECRET" && printf sandbox-ok',
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("sandbox-ok");
        const created = await client.exec("printf content > file-created-in-sandbox.txt");
        expect(created.exitCode).toBe(0);
        expect(fs.readFileSync(path.join(root, "file-created-in-sandbox.txt"), "utf8")).toBe("content");
      } finally {
        delete process.env.CONWAY_FAKE_TEST_SECRET;
      }
    },
  );
});
