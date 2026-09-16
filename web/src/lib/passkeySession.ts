// What this device remembers about its passkey sessions, so a returning user is not
// handed a fresh wallet. Two records, both in localStorage (sessionStorage dies with the
// tab, which is exactly how every return visit used to mint a new wallet):
//
//   - the last session (wallet address + credential id): re-attaches the kit on the next
//     visit with no WebAuthn prompt — reading a treasury needs no signature, and every
//     signature still runs the passkey ceremony;
//   - the credential → wallet map: a wallet recovered from a code lives at an address its
//     new passkey does NOT derive, so "sign in with your passkey" needs this to find it.
//
// Pure over an injected key-value store; the browser passes localStorage.

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PasskeySession {
  /** The smart wallet's contract address (C…). */
  address: string;
  /** Base64url credential id of the passkey that signs for it. */
  keyId: string;
}

export const PASSKEY_SESSION_KEY = "prism_passkey_session";
export const PASSKEY_WALLETS_KEY = "prism_passkey_wallets";

const isSession = (v: unknown): v is PasskeySession =>
  !!v &&
  typeof v === "object" &&
  typeof (v as PasskeySession).address === "string" &&
  typeof (v as PasskeySession).keyId === "string";

function readMap(store: KV | undefined): Record<string, string> {
  try {
    const raw = store?.getItem(PASSKEY_WALLETS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function readPasskeySession(store: KV | undefined): PasskeySession | null {
  try {
    const raw = store?.getItem(PASSKEY_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? { address: parsed.address, keyId: parsed.keyId } : null;
  } catch {
    return null;
  }
}

export function rememberPasskeyWallet(store: KV | undefined, keyId: string, address: string): void {
  if (!store) return;
  try {
    store.setItem(PASSKEY_WALLETS_KEY, JSON.stringify({ ...readMap(store), [keyId]: address }));
  } catch {
    /* storage full or blocked — the session still works for this tab */
  }
}

export function lookupPasskeyWallet(store: KV | undefined, keyId: string): string | undefined {
  return readMap(store)[keyId];
}

export function rememberPasskeySession(store: KV | undefined, s: PasskeySession): void {
  if (!store) return;
  rememberPasskeyWallet(store, s.keyId, s.address);
  try {
    store.setItem(PASSKEY_SESSION_KEY, JSON.stringify({ address: s.address, keyId: s.keyId }));
  } catch {
    /* see above */
  }
}

/** Ends the remembered session. The wallet map stays: it is how a later sign-in finds a
 *  recovered wallet, and it holds nothing secret (credential ids and contract addresses). */
export function forgetPasskeySession(store: KV | undefined): void {
  try {
    store?.removeItem(PASSKEY_SESSION_KEY);
  } catch {
    /* nothing to forget */
  }
}
