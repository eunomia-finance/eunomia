import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBudget, type TreasurySnapshot } from "./budget.js";
import { ownerActionsFor, serializeBudget, serializeOutcome } from "./tools.js";

const AGENT = "GAGENT";
const NOW = 1_800_000_000;

function snap(over: Partial<TreasurySnapshot> = {}): TreasurySnapshot {
  return {
    contractId: "CTREASURY",
    config: { admin: "GADMIN", agent: "GROOT", token: "CTOKEN", daily_limit: 1_000_000_000n, per_task_limit: 100_000_000n },
    balance: 5_000_000_000n,
    locked: 0n,
    daySpent: 0n,
    paused: false,
    session: { agent: AGENT, valid_until: BigInt(NOW + 3600), limit: 500_000_000n, spent: 0n },
    reputationPolicy: null,
    legacy: false,
    ...over,
  };
}

test("serializeBudget renders bigints as decimal strings and keeps raw stroops", () => {
  const out = serializeBudget(computeBudget(snap(), AGENT, NOW, 60_000_000n), "testnet") as Record<string, any>;
  assert.equal(out.treasury, "CTREASURY");
  assert.equal(out.spendableNow, "10");
  assert.equal(out.spendableNowStroops, "100000000");
  assert.equal(out.perPaymentCap, "10");
  assert.equal(out.dailyRemaining, "100");
  assert.equal(out.decision.amount, "6");
  assert.equal(out.decision.allowed, true);
  assert.equal(out.links.contract, "https://stellar.expert/explorer/testnet/contract/CTREASURY");
  assert.equal(typeof out.session.expiresInSec, "number");
  assert.equal(out.session.validUntil, new Date((NOW + 3600) * 1000).toISOString());
  assert.equal(out.session.remaining, "50");
  // Nothing bigint may survive: the MCP transport JSON-serialises structuredContent.
  assert.doesNotThrow(() => JSON.stringify(out));
});

test("serializeBudget keeps nulls explicit and reputation policy stringified", () => {
  const out = serializeBudget(
    computeBudget(snap({ session: null, reputationPolicy: { registry: "CREG", minReputation: 70n } }), null, NOW),
    "pubnet",
  ) as Record<string, any>;
  assert.equal(out.session, null);
  assert.equal(out.decision, undefined);
  assert.deepEqual(out.reputationPolicy, { registry: "CREG", minReputation: "70" });
  assert.equal(out.canSpend, false);
  assert.ok(out.blockers.length >= 1);
  assert.doesNotThrow(() => JSON.stringify(out));
});

test("serializeOutcome is transport-safe and links the tx", () => {
  const paid = serializeOutcome(
    { paid: true, txHash: "ab".repeat(32), ledger: 9, to: "GPAYEE", amount: 25_000_000n, taskId: 0n },
    "testnet",
  ) as Record<string, any>;
  assert.equal(paid.amount, "2.5");
  assert.equal(paid.amountStroops, "25000000");
  assert.equal(paid.taskId, "0");
  assert.equal(paid.links.tx, `https://stellar.expert/explorer/testnet/tx/${"ab".repeat(32)}`);
  assert.doesNotThrow(() => JSON.stringify(paid));
  const refused = serializeOutcome(
    {
      paid: false, stage: "simulation", reasons: [{ code: 3, name: "ExceedsTaskLimit", detail: "d" }], blockers: [],
      message: "m", to: "GPAYEE", amount: 1n, taskId: 0n,
    },
    "testnet",
  ) as Record<string, any>;
  assert.equal(refused.nextStep, "request_exception");
  assert.equal(refused.links.tx, undefined);
  assert.doesNotThrow(() => JSON.stringify(refused));
});

test("every amount says what it is an amount of — and says null when nobody could be asked", () => {
  const budget = computeBudget(snap(), AGENT, NOW);
  const named = serializeBudget(budget, "testnet", "USDC") as Record<string, any>;
  assert.equal(named.unit, "USDC");
  assert.match(named.note, /decimal string in USDC/);
  // `token` stays: the unit is for reading, the contract id is what x402 matching compares.
  assert.equal(named.token, "CTOKEN");

  const unnamed = serializeBudget(budget, "testnet") as Record<string, any>;
  assert.equal(unnamed.unit, null);
  assert.match(unnamed.note, /in the treasury's token/);

  const outcome = { paid: true as const, txHash: "ab".repeat(32), ledger: 9, to: "GPAYEE", amount: 15_000_000n, taskId: 0n };
  assert.equal((serializeOutcome(outcome, "testnet", "USDC") as Record<string, any>).unit, "USDC");
  assert.equal((serializeOutcome(outcome, "testnet") as Record<string, any>).unit, null);
});

test("ownerActionsFor maps codes to what the dashboard can do", () => {
  assert.match(ownerActionsFor([2]).join(" "), /Approve payee/);
  assert.match(ownerActionsFor([3, 4]).join(" "), /limits/);
  assert.match(ownerActionsFor([10]).join(" "), /Leash/);
  assert.match(ownerActionsFor([9]).join(" "), /Resume/);
});
