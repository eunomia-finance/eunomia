import { describe, expect, it } from "vitest";
import {
  PASSKEY_SESSION_KEY,
  PASSKEY_WALLETS_KEY,
  forgetPasskeySession,
  lookupPasskeyWallet,
  readPasskeySession,
  rememberPasskeySession,
  rememberPasskeyWallet,
  type KV,
} from "./passkeySession";

function memory(seed: Record<string, string> = {}): KV & { dump(): Record<string, string> } {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

const WALLET = "CAZTJX3ZOVELKZQKUN75G6TIKEOY7YCOQMXTPJZBMAIKWNG2XO47QTKD";

describe("passkey session memory", () => {
  it("round-trips a session and records the passkey → wallet pair", () => {
    const store = memory();
    rememberPasskeySession(store, { address: WALLET, keyId: "k1" });
    expect(readPasskeySession(store)).toEqual({ address: WALLET, keyId: "k1" });
    expect(lookupPasskeyWallet(store, "k1")).toBe(WALLET);
    expect(Object.keys(store.dump()).sort()).toEqual([PASSKEY_SESSION_KEY, PASSKEY_WALLETS_KEY].sort());
  });

  it("forgetting the session keeps the wallet map — a later sign-in still finds a recovered wallet", () => {
    const store = memory();
    rememberPasskeySession(store, { address: WALLET, keyId: "k1" });
    forgetPasskeySession(store);
    expect(readPasskeySession(store)).toBeNull();
    expect(lookupPasskeyWallet(store, "k1")).toBe(WALLET);
  });

  it("ignores garbage and missing storage", () => {
    expect(readPasskeySession(memory({ [PASSKEY_SESSION_KEY]: "{not json" }))).toBeNull();
    expect(readPasskeySession(memory({ [PASSKEY_SESSION_KEY]: JSON.stringify({ address: 1 }) }))).toBeNull();
    expect(readPasskeySession(undefined)).toBeNull();
    expect(lookupPasskeyWallet(memory({ [PASSKEY_WALLETS_KEY]: "[]" }), "k")).toBeUndefined();
    expect(lookupPasskeyWallet(undefined, "k")).toBeUndefined();
    expect(() => rememberPasskeySession(undefined, { address: WALLET, keyId: "k" })).not.toThrow();
    expect(() => forgetPasskeySession(undefined)).not.toThrow();
  });

  it("keeps several passkeys apart and lets a recovered wallet be registered on its own", () => {
    const store = memory();
    rememberPasskeyWallet(store, "old", "C1");
    rememberPasskeyWallet(store, "new", "C2");
    expect(lookupPasskeyWallet(store, "old")).toBe("C1");
    expect(lookupPasskeyWallet(store, "new")).toBe("C2");
    expect(lookupPasskeyWallet(store, "other")).toBeUndefined();
  });
});
