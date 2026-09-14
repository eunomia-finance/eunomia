import { describe, it, expect, beforeEach, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  clearSessionSecret,
  createSession,
  isValidAgentKey,
  loadSessionSecret,
  registerAgentKey,
  saveSessionSecret,
  sessionIsActive,
  sessionSigner,
} from "./session";

// createSession registers the session on-chain, then friendbot-funds its key. Mock the
// on-chain call to succeed and funding to fail, to exercise the partial-success path.
vi.mock("./userTreasury", () => ({
  setSession: vi.fn(async () => ({ ok: true, hash: "TX" })),
  makeTreasury: vi.fn(),
  pay: vi.fn(),
}));
vi.mock("./funding", () => ({
  fundWithFriendbot: vi.fn(async () => {
    throw new Error("friendbot rejected");
  }),
}));

beforeEach(() => {
  const store: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k in store) delete store[k];
    },
    key: () => null,
    length: 0,
  } as Storage;
});

describe("session secret store", () => {
  it("round-trips a secret per treasury", () => {
    saveSessionSecret("CT1", "SECRET1");
    saveSessionSecret("CT2", "SECRET2");
    expect(loadSessionSecret("CT1")).toBe("SECRET1");
    expect(loadSessionSecret("CT2")).toBe("SECRET2");
  });

  it("returns null for an unknown treasury", () => {
    expect(loadSessionSecret("CNONE")).toBeNull();
  });

  it("clears only the given treasury's secret", () => {
    saveSessionSecret("CT1", "S1");
    saveSessionSecret("CT2", "S2");
    clearSessionSecret("CT1");
    expect(loadSessionSecret("CT1")).toBeNull();
    expect(loadSessionSecret("CT2")).toBe("S2");
  });
});

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

describe("sessionSigner", () => {
  it("derives the keypair's public key and a signTransaction fn from the secret", () => {
    const kp = Keypair.random();
    const { publicKey, signer } = sessionSigner(kp.secret());
    expect(publicKey).toBe(kp.publicKey());
    expect(typeof signer.signTransaction).toBe("function");
  });
});

describe("registerAgentKey (external agent, e.g. eunomia-mcp)", () => {
  const PK = Keypair.random().publicKey();

  it("registers the given public key and never generates or stores a secret", async () => {
    saveSessionSecret("CT_EXT", "OLD_LOCAL_SECRET"); // a stale local key must not survive
    const res = await registerAgentKey({} as never, "CT_EXT", `  ${PK}  `, 25, 24);
    expect(res.ok).toBe(true);
    expect(res.registered).toBe(true);
    expect(res.sessionPk).toBe(PK);
    const { setSession } = await import("./userTreasury");
    expect(setSession).toHaveBeenLastCalledWith({}, PK, expect.any(BigInt), 25);
    expect(loadSessionSecret("CT_EXT")).toBeNull();
  });

  it("rejects a malformed public key before touching the wallet", async () => {
    const { setSession } = await import("./userTreasury");
    const calls = vi.mocked(setSession).mock.calls.length;
    const res = await registerAgentKey({} as never, "CT_EXT", "not-a-key", 25, 24);
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

describe("createSession partial success", () => {
  it("marks the session registered and keeps the secret when funding fails", async () => {
    const res = await createSession({} as never, "CT_FUND_FAIL", 25, 24);
    // Registration succeeded on-chain, only funding failed — the session is live and
    // single-spender, so the secret must survive and the caller must learn it registered.
    expect(res.ok).toBe(false);
    expect(res.registered).toBe(true);
    expect(res.sessionPk).toBeTruthy();
    expect(loadSessionSecret("CT_FUND_FAIL")).not.toBeNull();
    expect(res.errorMessage).toMatch(/funding its key failed/i);
  });
});
