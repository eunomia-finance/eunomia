// The relay endpoint is public in an open-source repo: without this gate anyone could spend
// our OZ Channels fee quota. Kept as a pure function so it is testable without the Node
// runtime the proxy itself runs in.
// Explicit .js extension, unlike the rest of src/: the serverless relay imports this module,
// and Vercel compiles api/* with node16 resolution, where an extensionless relative import
// does not resolve and the function dies at cold start with a 500. `npm run check:api-types`
// guards it. (Vite and vitest map the .js back to this .ts, so the bundle is unaffected.)
import type { xdr } from "@stellar/stellar-sdk";
import { LEGACY_TREASURY_WASM_HASHES, TREASURY_WASM_HASH } from "./treasuryWasm.js";

/** Soroban contract ids are StrKey-encoded, start with `C`, and are 56 characters long. */
const CONTRACT_ID = /^C[A-Z2-7]{55}$/;

/** Wasm hashes the relay will sponsor: whatever the environment names, plus every treasury
 *  version this app has deployed — the current one and the ones before it.
 *
 *  Neither of those is configuration, for the same reason the native SAC is hardcoded in
 *  the contract allowlist. Miss the current hash and nobody can create a treasury at all;
 *  miss an old one and the people who already have a treasury cannot spend from it, because
 *  their contract is immutable and the passkey path has no other way to pay a fee. Both
 *  mistakes were made a day apart: the first refused every sign-up with 403 for two days,
 *  the second locked out every treasury created that week the moment v3.5 shipped.
 *
 *  The env remains an escape hatch for a hash we forgot to carry forward. */
export function allowedWasmHashes(envValue: string | undefined): string[] {
  const listed = (envValue ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ours = [TREASURY_WASM_HASH, ...LEGACY_TREASURY_WASM_HASHES];
  return [...listed, ...ours.filter((h) => !listed.includes(h))];
}

/** Whether the relay may forward a call to this contract.
 *  Fails closed: a malformed id, a non-contract StrKey, or a missing allowlist all reject. */
export function isAllowedContract(id: string, allowlist: string[]): boolean {
  if (!CONTRACT_ID.test(id)) return false;
  return allowlist.includes(id);
}

export interface RelayGuardConfig {
  /** Contracts admitted by address — ours and fixed, e.g. the treasury registry. */
  contracts: string[];
  /** Wasm hashes admitted by code — covers the per-user treasuries we cannot enumerate. */
  wasmHashes: string[];
  /** Reads the wasm hash a deployed contract runs; null when the contract isn't on chain. */
  readWasmHash: (contractId: string) => Promise<string | null>;
}

/** The relay's admission decision.
 *
 *  A fixed address list alone cannot work here: treasuries are deployed per user, so their
 *  ids are unknown up front. What every genuine treasury shares is the wasm it runs, so an
 *  unlisted contract is admitted only when its code is ours.
 *
 *  Fails closed throughout — malformed ids, missing contracts and RPC outages all reject,
 *  because the alternative is an open relay paying fees for anyone. */
export async function isRelayAllowed(
  contractId: string,
  cfg: RelayGuardConfig,
): Promise<boolean> {
  if (!CONTRACT_ID.test(contractId)) return false;
  if (cfg.contracts.includes(contractId)) return true;

  let hash: string | null;
  try {
    hash = await cfg.readWasmHash(contractId);
  } catch {
    return false;
  }
  if (!hash) return false;

  const seen = hash.toLowerCase();
  return cfg.wasmHashes.some((h) => h.toLowerCase() === seen);
}

/** Whether caller-supplied auth entries are safe to submit with the relay as the source.
 *
 *  The relay sources and signs the transaction, so a `sourceAccount` credential is
 *  satisfied by the relay's own signature: it authorises as the fee account, not the user.
 *  Admitted alongside the native SAC, one such entry on `transfer(from = relay, ...)` would
 *  hand anyone the dispenser's balance. Genuine passkey calls always carry address-bound
 *  credentials signed by the user's wallet, so nothing legitimate is refused. */
export function authEntriesAreSafe(entries: xdr.SorobanAuthorizationEntry[]): boolean {
  return entries.every(
    (entry) => entry.credentials().switch().name !== "sorobanCredentialsSourceAccount",
  );
}
