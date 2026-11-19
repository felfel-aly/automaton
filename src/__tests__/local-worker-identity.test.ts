import { describe, expect, it } from "vitest";
import { createWorkerIdentity } from "../orchestration/local-worker.js";
import type { AutomatonIdentity } from "../types.js";

function parent(sandboxId: string): AutomatonIdentity {
  return {
    name: "parent",
    address: "parent-address",
    account: {} as AutomatonIdentity["account"],
    creatorAddress: "owner",
    sandboxId,
    apiKey: "dummy-not-a-key",
    createdAt: "2026-11-17T00:00:00Z",
  };
}

describe("in-process worker sandbox provenance", () => {
  it("retains the parent's actual remote execution sandbox", () => {
    const realSandbox = "remote-sandbox-1";
    const worker = createWorkerIdentity(parent(realSandbox), "local-worker-01", "coder");
    expect(worker.sandboxId).toBe(realSandbox);
    expect(worker.address).toBe("local://local-worker-01");
    expect(worker.name).toMatch(/^worker-coder-/);
  });

  it("keeps local-only identity empty instead of giving it remote permissions", () => {
    const worker = createWorkerIdentity(parent(""), "local-worker-02", "analyst");
    expect(worker.sandboxId).toBe("");
    expect(worker.address).toBe("local://local-worker-02");
  });

  it("does not mutate the parent's sandbox identity", () => {
    const original = parent("remote-parent");
    createWorkerIdentity(original, "local-worker-03", null);
    expect(original.sandboxId).toBe("remote-parent");
    expect(original.address).toBe("parent-address");
  });
});
