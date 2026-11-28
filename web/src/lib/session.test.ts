// These tests assert the English sentences; the app language otherwise follows the machine locale.
import { resetLangForTest } from "./i18n";
resetLangForTest("en");

import { describe, it, expect, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { isValidAgentKey, registerAgentKey, sessionIsActive } from "./session";

vi.mock("./userTreasury", () => ({
  setSession: vi.fn(async () => ({ ok: true, hash: "TX" })),
}));

describe("sessionIsActive", () => {
  const nowMs = 1_000_000_000 * 1000; // fixed clock

  it("is false for no session", () => {
    expect(sessionIsActive(null, nowMs)).toBe(false);
  });

  it("is true while valid_until is in the future", () => {
    expect(sessionIsActive({ valid_until: BigInt(1_000_000_100) }, nowMs)).toBe(true);
  });

  it("is false at exactly valid_until and after (contract's `<` rule)", () => {
    expect(sessionIsActive({ valid_until: BigInt(1_000_000_000) }, nowMs)).toBe(false);
    expect(sessionIsActive({ valid_until: BigInt(999_999_900) }, nowMs)).toBe(false);
  });
});

describe("registerAgentKey (the agent's own key, from eunomia-mcp)", () => {
  const PK = Keypair.random().publicKey();

  it("registers the given public key and never generates or stores a secret", async () => {
    const res = await registerAgentKey({} as never, `  ${PK}  `, 25, 24);
    expect(res.ok).toBe(true);
    expect(res.registered).toBe(true);
    expect(res.sessionPk).toBe(PK);
    const { setSession } = await import("./userTreasury");
    expect(setSession).toHaveBeenLastCalledWith({}, PK, expect.any(BigInt), 25);
  });

  it("rejects a malformed public key before touching the wallet", async () => {
    const { setSession } = await import("./userTreasury");
    const calls = vi.mocked(setSession).mock.calls.length;
    const res = await registerAgentKey({} as never, "not-a-key", 25, 24);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toMatch(/public key/i);
    expect(vi.mocked(setSession).mock.calls.length).toBe(calls);
  });

  it("isValidAgentKey accepts G… keys only", () => {
    expect(isValidAgentKey(PK)).toBe(true);
    expect(isValidAgentKey(Keypair.random().secret())).toBe(false);
    expect(isValidAgentKey("CBCBYWUMRD7L6GFTRJME232JUAEJ2B263N5O7MDGCMDFG4FI6GJ5JN36")).toBe(false);
    expect(isValidAgentKey("")).toBe(false);
  });
});
