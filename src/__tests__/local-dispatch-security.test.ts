import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createBuiltinTools, executeTool, hasPendingLocalDrafts, LOCAL_DRAFT_QUEUE,
} from "../agent/tools.js";
import { createConwayClient } from "../conway/client.js";
import { createTestConfig, createTestIdentity } from "./mocks.js";
import type { AutomatonTool, ToolContext } from "../types.js";

describe("local dispatch security invariants", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("checks completion in the approved physical workspace, rejecting unsafe entries", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "conway-local-progress-"));
    const root = path.join(fixture, "approved");
    fs.mkdirSync(root, { mode: 0o700 });
    vi.stubEnv("CONWAY_LOCAL_WORKSPACE_ROOT", root);
    try {
      expect(hasPendingLocalDrafts()).toBe(true);
      for (const filePath of LOCAL_DRAFT_QUEUE) {
        fs.writeFileSync(path.join(root, path.posix.basename(filePath)), "draft", { mode: 0o600 });
      }
      expect(hasPendingLocalDrafts()).toBe(false);
      const finalPath = path.join(root, "portfolio-summary.md");
      fs.unlinkSync(finalPath);
      fs.symlinkSync(path.join(root, "demo-plan.md"), finalPath);
      expect(hasPendingLocalDrafts()).toBe(true);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("maps local virtual draft files only into the approved workspace", async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "conway-tool-workspace-"));
    const root = path.join(fixture, "approved");
    fs.mkdirSync(root, { mode: 0o700 });
    vi.stubEnv("CONWAY_LOCAL_WORKSPACE_ROOT", root);
    const client = createConwayClient({
      apiUrl: "https://example.invalid",
      apiKey: "",
      sandboxId: "",
      localWorkspaceRoot: root,
    });
    const context = {
      identity: { ...createTestIdentity(), sandboxId: "" },
      config: createTestConfig({ sandboxId: "", ollamaBaseUrl: undefined }),
      conway: client,
    } as unknown as ToolContext;
    const tools = createBuiltinTools("");
    const content = "A locally drafted service offering with factual, non-promotional information. ".repeat(2);
    try {
      const write = tools.find((tool) => tool.name === "write_file")!;
      const read = tools.find((tool) => tool.name === "read_file")!;
      const output = await write.execute({ path: "/root/work/service-offer.md", content }, context);
      expect(output).toContain("File written:");
      expect(fs.readFileSync(path.join(root, "service-offer.md"), "utf8")).toBe(content);
      const readback = await read.execute({ path: "/root/work/service-offer.md" }, context);
      expect(readback).toBe(content);
      const denied = await write.execute({ path: "/root/work/service-offer.md", content }, context);
      expect(denied).toContain("already exists");
      expect(fs.existsSync(path.join(fixture, "service-offer.md"))).toBe(false);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });


  it("denies unlisted local capabilities before invoking their implementation", async () => {
    let invoked = 0;
    const unsafe: AutomatonTool = {
      name: "transfer_credits",
      description: "mock financial tool, never executed",
      category: "vm",
      riskLevel: "caution",
      parameters: {},
      execute: async () => {
        invoked += 1;
        return "unexpected";
      },
    };
    const context = {
      identity: createTestIdentity(),
      config: createTestConfig({ sandboxId: "", ollamaBaseUrl: undefined }),
    } as ToolContext;
    const result = await executeTool("transfer_credits", {}, [unsafe], context);
    expect(result.error).toContain("LOCAL_MODE_CAPABILITY_DISABLED");
    expect(invoked).toBe(0);
  });

  it("fails closed when identity and config disagree on sandbox mode", async () => {
    let calls = 0;
    const unsafe: AutomatonTool = {
      name: "transfer_credits",
      description: "never execute",
      category: "vm",
      riskLevel: "dangerous",
      parameters: {},
      execute: async () => { calls++; return "unexpected"; },
    };
    for (const [identityId, configId] of [
      ["", "remote-sandbox-id"],
      ["remote-sandbox-id", ""],
    ]) {
      const context = {
        identity: { ...createTestIdentity(), sandboxId: identityId },
        config: createTestConfig({ sandboxId: configId, ollamaBaseUrl: undefined }),
      } as ToolContext;
      const result = await executeTool("transfer_credits", {}, [unsafe], context);
      expect(result.error).toContain("LOCAL_MODE_CAPABILITY_DISABLED");
    }
    expect(calls).toBe(0);
  });

  it("enforces local file boundaries without Ollama enabled", async () => {
    const writeFile = vi.fn(async () => undefined);
    const context = {
      identity: { ...createTestIdentity(), sandboxId: "" },
      config: createTestConfig({ sandboxId: "", ollamaBaseUrl: undefined }),
      conway: { writeFile },
    } as unknown as ToolContext;
    const result = await executeTool(
      "write_file",
      { path: "/root/outside-queue.txt", content: "content".repeat(20) },
      createBuiltinTools(""),
      context,
    );
    expect(result.result).toContain("Blocked: path is outside /root/work");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("blocks nonempty sandbox identity mismatches and a mismatched bound client", async () => {
    let ran = 0;
    const tool: AutomatonTool = {
      name: "exec",
      description: "mock execution; no process invoked",
      category: "vm",
      riskLevel: "dangerous",
      parameters: {},
      execute: async () => { ran++; return "unexpected"; },
    };
    const inconsistent = {
      identity: { ...createTestIdentity(), sandboxId: "remote-A" },
      config: createTestConfig({ sandboxId: "remote-B" }),
      conway: { sandboxId: "remote-A" },
    } as unknown as ToolContext;
    const result = await executeTool("exec", {}, [tool], inconsistent);
    expect(result.error).toContain("SANDBOX_ID_MISMATCH");

    const boundMismatch = {
      identity: { ...createTestIdentity(), sandboxId: "remote-A" },
      config: createTestConfig({ sandboxId: "remote-A" }),
      conway: { sandboxId: "remote-C" },
    } as unknown as ToolContext;
    const result2 = await executeTool("exec", {}, [tool], boundMismatch);
    expect(result2.error).toContain("SANDBOX_ID_MISMATCH");
    expect(ran).toBe(0);
  });

  it("rejects unsafe local draft queue placeholders", async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "conway-queue-security-"));
    const root = path.join(fixture, "approved");
    fs.mkdirSync(root, { mode: 0o700 });
    fs.mkdirSync(path.join(root, "service-offer.md"), { mode: 0o700 });
    vi.stubEnv("CONWAY_LOCAL_WORKSPACE_ROOT", root);
    const context = {
      identity: { ...createTestIdentity(), sandboxId: "" },
      config: createTestConfig({ sandboxId: "", ollamaBaseUrl: undefined }),
      conway: { writeFile: vi.fn() },
    } as unknown as ToolContext;
    try {
      const tool = createBuiltinTools("").find((candidate) => candidate.name === "write_file")!;
      const result = await tool.execute({
        path: "/root/work/demo-plan.md",
        content: "This locally drafted plan contains only factual, original testing content. ".repeat(2),
      }, context);
      expect(result).toContain("unsafe entry");
      expect(context.conway.writeFile).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("does not bypass remote file-read errors through a shell command", async () => {
    let commands = 0;
    const context = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      conway: {
        readFile: async () => { throw new Error("mock remote authorization failure"); },
        exec: async () => {
          commands += 1;
          return { exitCode: 0, stdout: "should not appear", stderr: "" };
        },
      },
    } as unknown as ToolContext;
    const result = await executeTool(
      "read_file",
      { path: "/root/work/sample.txt" },
      createBuiltinTools("remote-sandbox-id"),
      context,
    );
    expect(result.result).toContain("Remote sandbox file read failed");
    expect(result.result).not.toContain("should not appear");
    expect(commands).toBe(0);
  });

  it("blocks host installation even when a remote sandbox ID is configured", async () => {
    let calls = 0;
    const hostTool: AutomatonTool = {
      name: "install_skill",
      description: "mock host mutation; never executed",
      category: "skills",
      riskLevel: "dangerous",
      parameters: {},
      execute: async () => {
        calls++;
        return "unexpected";
      },
    };
    const context = {
      identity: { ...createTestIdentity(), sandboxId: "remote-sandbox-id" },
      config: createTestConfig({ sandboxId: "remote-sandbox-id" }),
    } as ToolContext;
    const result = await executeTool("install_skill", {}, [hostTool], context);
    expect(result.error).toContain("HOST_MUTATION_CAPABILITY_DISABLED");
    expect(calls).toBe(0);
  });

});
