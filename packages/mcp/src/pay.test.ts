import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { Err, Ok } from "@stellar/stellar-sdk/contract";
import { memoryCache } from "./cache.js";
import { NETWORKS } from "./network.js";
import { payFromTreasury, preflightReasons } from "./pay.js";
import type { ServerContext } from "./server.js";
import { memoryExceptionStore } from "./store.js";

const AGENT = "GB4GJNEZ6KLZNU3TE2CHQFNPOEQL5SHPQ246OMRZRLKVVQNLZCDX2QXZ";
const NOW = 1_800_000_000;
const cred = {
  version: 1 as const,
  network: "testnet" as const,
  treasuryId: "CTREASURY",
  agentPublicKey: AGENT,
  agentSecret: "S",
  createdAt: "x",
};

// A read client answering the same snapshot readTreasury() would build.
function readClient(over: Record<string, unknown> = {}) {
  const r = (v: unknown) => Promise.resolve({ result: v });
  return {
    get_config: () =>
      r({ admin: "GADMIN", agent: "GROOT", token: "CTOKEN", daily_limit: 1_000_000_000n, per_task_limit: 100_000_000n }),
    balance: () => r(5_000_000_000n),
    day_spent: () => r(0n),
    locked: () => r(0n),
    get_reputation_policy: () => r(undefined),
    is_paused: () => r(false),
    get_session: () => r({ agent: AGENT, valid_until: BigInt(NOW + 3600), limit: 500_000_000n, spent: 0n }),
    is_payee: () => r(true),
    ...over,
  } as never;
}

function ctx(over: Partial<ServerContext> = {}): ServerContext {
  return {
    net: NETWORKS.testnet,
    treasuryId: "CTREASURY",
    credential: cred,
    cache: memoryCache(),
    exceptions: memoryExceptionStore(),
    now: () => NOW,
    ...over,
  };
}

const diag = (code: number) =>
  new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: null,
      type: xdr.ContractEventType.diagnostic(),
      body: new xdr.ContractEventBody(
        0,
        new xdr.ContractEventV0({
          topics: [nativeToScVal("error", { type: "symbol" }), xdr.ScVal.scvError(xdr.ScError.sceContract(code))],
          data: nativeToScVal("x"),
        }),
      ),
    }),
  });

test("preflightReasons adds the whitelist verdict to the budget's limit reasons", async () => {
  const pre = await preflightReasons(
    ctx(),
    { to: "GPAYEE", amount: 150_000_000n, taskId: 0n },
    { readClient: readClient({ is_payee: () => Promise.resolve({ result: false }) }) },
  );
  assert.deepEqual(pre.reasons.map((r) => r.code), [3, 2]);
  assert.deepEqual(pre.blockers, []);
});

test("no credential → preflight blocker, nothing simulated", async () => {
  const out = await payFromTreasury(
    ctx({ credential: null }),
    { to: "GPAYEE", amount: 1n, taskId: 0n },
    { readClient: readClient() },
  );
  assert.equal(out.paid, false);
  if (!out.paid) {
    assert.equal(out.stage, "preflight");
    assert.match(out.blockers[0], /credential/);
  }
});

test("the contract's Err from simulation becomes a coded reason", async () => {
  const signing = {
    pay: async () => ({
      result: new Err({ message: "ExceedsTaskLimit" }),
      signAndSend: async () => {
        throw new Error("must not send");
      },
    }),
  } as never;
  const out = await payFromTreasury(
    ctx(),
    { to: "GPAYEE", amount: 150_000_000n, taskId: 0n },
    { readClient: readClient(), signingClient: signing },
  );
  assert.equal(out.paid, false);
  if (!out.paid) {
    assert.equal(out.stage, "simulation");
    assert.deepEqual(out.reasons.map((r) => r.code), [3]);
  }
});

test("a non-contract simulation failure is reported without inventing a code", async () => {
  const signing = {
    pay: async () => ({
      get result() {
        throw new Error('Transaction simulation failed: "HostError: Error(Auth, InvalidAction)"');
      },
    }),
  } as never;
  const out = await payFromTreasury(
    ctx(),
    { to: "GPAYEE", amount: 1n, taskId: 0n },
    { readClient: readClient(), signingClient: signing },
  );
  assert.equal(out.paid, false);
  if (!out.paid) {
    assert.equal(out.stage, "simulation");
    assert.deepEqual(out.reasons, []);
    assert.match(out.message, /Auth/);
  }
});

test("Ok + SUCCESS pays; Ok + FAILED reads the verdict from diagnostics", async () => {
  const mk = (status: string, extra: object) =>
    ({
      pay: async () => ({
        result: new Ok(undefined),
        signAndSend: async () => ({
          sendTransactionResponse: { hash: "ab".repeat(32) },
          getTransactionResponse: { status, ledger: 42, ...extra },
        }),
      }),
    }) as never;
  const ok = await payFromTreasury(
    ctx(),
    { to: "GPAYEE", amount: 25_000_000n, taskId: 7n },
    { readClient: readClient(), signingClient: mk("SUCCESS", {}) },
  );
  assert.deepEqual(ok, { paid: true, txHash: "ab".repeat(32), ledger: 42, to: "GPAYEE", amount: 25_000_000n, taskId: 7n });
  const failed = await payFromTreasury(
    ctx(),
    { to: "GPAYEE", amount: 25_000_000n, taskId: 7n },
    { readClient: readClient(), signingClient: mk("FAILED", { diagnosticEventsXdr: [diag(4)] }) },
  );
  assert.equal(failed.paid, false);
  if (!failed.paid) {
    assert.equal(failed.stage, "onchain");
    assert.equal(failed.txHash, "ab".repeat(32));
    assert.deepEqual(failed.reasons.map((r) => r.code), [4]);
  }
});
