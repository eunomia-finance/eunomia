import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBudget, type TreasurySnapshot } from "./budget.js";

const AGENT = "GAGENT";
const NOW = 1_800_000_000;

export function snap(over: Partial<TreasurySnapshot> = {}): TreasurySnapshot {
  return {
    contractId: "CTREASURY",
    config: {
      admin: "GADMIN",
      agent: "GROOT",
      token: "CTOKEN",
      daily_limit: 1_000_000_000n,
      per_task_limit: 100_000_000n,
    },
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

test("healthy session: spendable = min(per-payment, daily left, session left, free balance)", () => {
  const b = computeBudget(snap(), AGENT, NOW);
  assert.equal(b.canSpend, true);
  assert.deepEqual(b.blockers, []);
  assert.equal(b.spendableNow, 100_000_000n);
  assert.equal(b.session?.isThisAgent, true);
  assert.equal(b.session?.active, true);
  assert.equal(b.session?.expiresInSec, 3600);
  assert.equal(b.session?.remaining, 500_000_000n);
});

test("daily limit partly used narrows spendable", () => {
  const b = computeBudget(snap({ daySpent: 950_000_000n }), AGENT, NOW);
  assert.equal(b.dailyRemaining, 50_000_000n);
  assert.equal(b.spendableNow, 50_000_000n);
});

test("session cap nearly used narrows spendable", () => {
  const b = computeBudget(
    snap({ session: { agent: AGENT, valid_until: BigInt(NOW + 10), limit: 500_000_000n, spent: 490_000_000n } }),
    AGENT,
    NOW,
  );
  assert.equal(b.spendableNow, 10_000_000n);
});

test("free balance (balance - locked) caps spendable", () => {
  const b = computeBudget(snap({ balance: 30_000_000n, locked: 25_000_000n }), AGENT, NOW);
  assert.equal(b.freeBalance, 5_000_000n);
  assert.equal(b.spendableNow, 5_000_000n);
});

test("no session → blocked with an actionable reason", () => {
  const b = computeBudget(snap({ session: null }), AGENT, NOW);
  assert.equal(b.canSpend, false);
  assert.equal(b.spendableNow, 0n);
  assert.match(b.blockers[0], /no active Leash/i);
});

test("session for another agent → blocked", () => {
  const b = computeBudget(
    snap({ session: { agent: "GOTHER", valid_until: BigInt(NOW + 10), limit: 1n, spent: 0n } }),
    AGENT,
    NOW,
  );
  assert.equal(b.session?.isThisAgent, false);
  assert.match(b.blockers[0], /another agent/i);
});

test("expired session → blocked", () => {
  const b = computeBudget(
    snap({ session: { agent: AGENT, valid_until: BigInt(NOW - 1), limit: 1n, spent: 0n } }),
    AGENT,
    NOW,
  );
  assert.equal(b.session?.active, false);
  assert.equal(b.session?.expiresInSec, 0);
  assert.match(b.blockers[0], /expired/i);
});

test("session cap used up → blocked", () => {
  const b = computeBudget(
    snap({ session: { agent: AGENT, valid_until: BigInt(NOW + 10), limit: 5n, spent: 5n } }),
    AGENT,
    NOW,
  );
  assert.match(b.blockers[0], /cap is used up/i);
});

test("paused → blocked, and it is the first blocker", () => {
  const b = computeBudget(snap({ paused: true }), AGENT, NOW);
  assert.match(b.blockers[0], /paused/i);
  assert.equal(b.canSpend, false);
});

test("unknown agent (no credential) still reports the treasury numbers", () => {
  const b = computeBudget(snap(), null, NOW);
  assert.equal(b.canSpend, false);
  assert.match(b.blockers[0], /credential/i);
  assert.equal(b.perPaymentCap, 100_000_000n);
  assert.equal(b.dailyRemaining, 1_000_000_000n);
});

test("amount pre-flight mirrors the contract's error codes", () => {
  const over = computeBudget(snap(), AGENT, NOW, 150_000_000n);
  assert.equal(over.decision?.allowed, false);
  assert.deepEqual(over.decision?.reasons.map((r) => r.code), [3]); // ExceedsTaskLimit
  assert.equal(over.decision?.reasons[0].name, "ExceedsTaskLimit");

  const daily = computeBudget(snap({ daySpent: 950_000_000n }), AGENT, NOW, 60_000_000n);
  assert.deepEqual(daily.decision?.reasons.map((r) => r.code), [4]); // ExceedsDailyLimit

  const sess = computeBudget(
    snap({ session: { agent: AGENT, valid_until: BigInt(NOW + 10), limit: 50_000_000n, spent: 0n } }),
    AGENT,
    NOW,
    60_000_000n,
  );
  assert.deepEqual(sess.decision?.reasons.map((r) => r.code), [10]); // ExceedsSessionLimit

  const broke = computeBudget(snap({ balance: 10_000_000n }), AGENT, NOW, 60_000_000n);
  assert.deepEqual(broke.decision?.reasons.map((r) => r.code), [6]); // InsufficientFreeBalance

  const ok = computeBudget(snap(), AGENT, NOW, 60_000_000n);
  assert.equal(ok.decision?.allowed, true);
  assert.deepEqual(ok.decision?.reasons, []);

  const zero = computeBudget(snap(), AGENT, NOW, 0n);
  assert.deepEqual(zero.decision?.reasons.map((r) => r.code), [1]); // InvalidAmount
});

test("a blocked agent gets allowed:false even when the amount itself is fine", () => {
  const b = computeBudget(snap({ session: null }), AGENT, NOW, 10_000_000n);
  assert.equal(b.decision?.allowed, false);
  assert.deepEqual(b.decision?.reasons, []); // nothing wrong with the amount — the blocker is the Leash
});
