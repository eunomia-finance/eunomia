import { describe, it, expect, vi } from "vitest";
import { Address, xdr } from "@stellar/stellar-sdk";
import { allowedWasmHashes, authEntriesAreSafe, isAllowedContract, isRelayAllowed } from "./relayGuard";
import { LEGACY_TREASURY_WASM_HASHES, TREASURY_WASM_HASH } from "./treasuryWasm";

describe("allowedWasmHashes", () => {
  it("always admits the treasury wasm the app deploys, with no env set at all", () => {
    // The regression this exists for: the app moved to treasury v3.4 while the deploy
    // allowlist stayed an env var listing the old hash, so every passkey user's "create
    // treasury" was refused by the relay with 403 for two days. The hash the app ships is
    // not configuration — it cannot drift away from what the relay admits.
    expect(allowedWasmHashes(undefined)).toContain(TREASURY_WASM_HASH);
    expect(allowedWasmHashes("")).toContain(TREASURY_WASM_HASH);
  });

  it("keeps env-listed hashes alongside it, so older treasuries stay reachable", () => {
    const older = "56a4d9264b5eb9dd8fa4b0e8ba2e3b7bb0b2d63e0b0dcbdc1a1b1c1d1e1f6795";
    const list = allowedWasmHashes(` ${older} , `);
    expect(list).toContain(older);
    expect(list).toContain(TREASURY_WASM_HASH);
  });

  it("keeps sponsoring the treasuries this app deployed before, with no env at all", () => {
    // Shipping v3.5 moved the allowlist off v3.4 and locked every treasury created that
    // week out of the passkey path — the owner's funds sit in an immutable contract the
    // relay had stopped paying fees for. Old code versions are not configuration.
    const list = allowedWasmHashes(undefined);
    for (const legacy of LEGACY_TREASURY_WASM_HASHES) expect(list).toContain(legacy);
  });

  it("does not list the shipped hash twice when the env already names it", () => {
    expect(allowedWasmHashes(TREASURY_WASM_HASH).filter((h) => h === TREASURY_WASM_HASH)).toHaveLength(1);
  });
});

// A real testnet contract id, so the shape check is exercised against the genuine article.
const TREASURY = "CBEPVXK6RGYUMHZCJ4H2TQZKGCVWZC5X6LPUZQ6ZOEXTPZ63DZMD4ZE7";
const ALLOW = [TREASURY];

describe("isAllowedContract", () => {
  it("allows a contract on the list", () => {
    expect(isAllowedContract(TREASURY, ALLOW)).toBe(true);
  });

  it("rejects a contract that is not on the list", () => {
    expect(isAllowedContract("CDQ6ZOEXTPZ63DZMD4ZE7BEPVXK6RGYUMHZCJ4H2TQZKGCVWZC5X", ALLOW)).toBe(false);
  });

  it("rejects empty or malformed input rather than passing it through", () => {
    expect(isAllowedContract("", ALLOW)).toBe(false);
    expect(isAllowedContract("not-a-contract", ALLOW)).toBe(false);
    // An account address, not a contract — the relay only ever calls contracts.
    expect(isAllowedContract("GBGHXQXR7BQZMZ3EPWXVMBNVFHXHVZQJPVWQGCTLPXQHRTFHXQXR7BQZ", ALLOW)).toBe(false);
  });

  it("rejects everything when the allowlist is empty — fail closed", () => {
    // A misconfigured deploy (env var missing) must not turn the relay into an open one.
    expect(isAllowedContract(TREASURY, [])).toBe(false);
  });

  it("does not treat a prefix or substring as a match", () => {
    expect(isAllowedContract(TREASURY.slice(0, 55), ALLOW)).toBe(false);
  });
});

// User treasuries are deployed per user, so no fixed address list can cover them. What they
// DO share is the wasm they run. The relay therefore admits a call when the contract is either
// one of our fixed contracts (the registry) or runs our treasury wasm.
const REGISTRY = "CBEPVXK6RGYUMHZCJ4H2TQZKGCVWZC5X6LPUZQ6ZOEXTPZ63DZMD4ZE7";
const USER_TREASURY = "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ";
const TREASURY_WASM = "475cfbe2ca79d7977c8e4d29438ae70b9d95a12cb2bfcd9fed4e4f7a26d798b2";

const guard = (readWasmHash: (id: string) => Promise<string | null>) => ({
  contracts: [REGISTRY],
  wasmHashes: [TREASURY_WASM],
  readWasmHash,
});

describe("isRelayAllowed", () => {
  it("admits a fixed contract without asking the chain", async () => {
    const readWasmHash = vi.fn();
    await expect(isRelayAllowed(REGISTRY, guard(readWasmHash))).resolves.toBe(true);
    expect(readWasmHash).not.toHaveBeenCalled();
  });

  it("admits an unknown contract that runs our treasury wasm", async () => {
    const readWasmHash = vi.fn().mockResolvedValue(TREASURY_WASM);
    await expect(isRelayAllowed(USER_TREASURY, guard(readWasmHash))).resolves.toBe(true);
    expect(readWasmHash).toHaveBeenCalledWith(USER_TREASURY);
  });

  it("rejects a contract running someone else's wasm", async () => {
    const readWasmHash = vi.fn().mockResolvedValue("dead".repeat(16));
    await expect(isRelayAllowed(USER_TREASURY, guard(readWasmHash))).resolves.toBe(false);
  });

  it("rejects when the contract cannot be found on chain", async () => {
    const readWasmHash = vi.fn().mockResolvedValue(null);
    await expect(isRelayAllowed(USER_TREASURY, guard(readWasmHash))).resolves.toBe(false);
  });

  it("rejects a malformed id without touching the chain", async () => {
    const readWasmHash = vi.fn();
    await expect(isRelayAllowed("not-a-contract", guard(readWasmHash))).resolves.toBe(false);
    expect(readWasmHash).not.toHaveBeenCalled();
  });

  it("fails closed when the chain lookup throws", async () => {
    // An RPC outage must not turn the relay into an open one.
    const readWasmHash = vi.fn().mockRejectedValue(new Error("rpc down"));
    await expect(isRelayAllowed(USER_TREASURY, guard(readWasmHash))).resolves.toBe(false);
  });

  it("is case-insensitive about the wasm hash hex", async () => {
    const readWasmHash = vi.fn().mockResolvedValue(TREASURY_WASM.toUpperCase());
    await expect(isRelayAllowed(USER_TREASURY, guard(readWasmHash))).resolves.toBe(true);
  });
});

describe("authEntriesAreSafe", () => {
  const NATIVE_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  const WALLET = "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ";
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(NATIVE_SAC).toScAddress(),
        functionName: "transfer",
        args: [],
      }),
    ),
    subInvocations: [],
  });

  const addressEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(WALLET).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 100,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: invocation,
  });

  it("admits the address-bound entries a passkey signs", () => {
    expect(authEntriesAreSafe([addressEntry])).toBe(true);
    expect(authEntriesAreSafe([])).toBe(true);
  });

  it("refuses a source-account entry, which would authorise as the relay itself", () => {
    // The relay is the transaction source, so this entry is satisfied by the relay's own
    // signature: a transfer out of the dispenser that anyone could post.
    const asRelay = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: invocation,
    });
    expect(authEntriesAreSafe([asRelay])).toBe(false);
    expect(authEntriesAreSafe([addressEntry, asRelay])).toBe(false);
  });
});
