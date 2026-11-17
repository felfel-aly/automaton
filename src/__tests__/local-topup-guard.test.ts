import { describe, expect, it, vi } from "vitest";
import { BUILTIN_TASKS } from "../heartbeat/tasks.js";
import type { TickContext, HeartbeatLegacyContext } from "../types.js";

describe("local-only heartbeat funding boundary", () => {
  const execute = async (configSandboxId: string, identitySandboxId: string) => {
    const setKV = vi.fn();
    const getKV = vi.fn(() => "");
    const taskCtx = {
      config: { sandboxId: configSandboxId },
      identity: { sandboxId: identitySandboxId },
      db: { setKV, getKV },
    } as unknown as HeartbeatLegacyContext;
    const ctx = {
      usdcBalance: 100,
      creditBalance: 0,
      survivalTier: "critical",
    } as TickContext;

    const result = await BUILTIN_TASKS.check_usdc_balance(ctx, taskCtx);
    return { result, setKV, getKV };
  };

  it("does not attempt a USDC topup when both sandbox IDs are empty", async () => {
    const { result, setKV, getKV } = await execute("", "");
    expect(result).toEqual({ shouldWake: false });
    expect(setKV).toHaveBeenCalledWith("last_usdc_check", expect.any(String));
    expect(setKV).not.toHaveBeenCalledWith(
      "last_auto_topup_attempt", expect.any(String),
    );
    expect(getKV).not.toHaveBeenCalled();
  });

  it("does not attempt a topup when the config is local-only", async () => {
    const { result, getKV } = await execute("", "remote-worker");
    expect(result).toEqual({ shouldWake: false });
    expect(getKV).not.toHaveBeenCalled();
  });

  it("does not attempt a topup when the identity is local-only", async () => {
    const { result, getKV } = await execute("remote-worker", "");
    expect(result).toEqual({ shouldWake: false });
    expect(getKV).not.toHaveBeenCalled();
  });
});
