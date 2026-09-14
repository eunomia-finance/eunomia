import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBudget, type TreasurySnapshot } from "./budget.js";
import { serializeBudget } from "./tools.js";

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
