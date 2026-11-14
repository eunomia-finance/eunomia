// How much the relay may spend on fees in one UTC day, across every caller.
//
// The rate limiters slow one address or one wallet down; they do not bound the bill. Wallets
// and IPs are free to mint, so the only limit that holds against a determined caller is a
// total. Each transaction is charged at the most it may cost (its fee bid, resource fee
// included) before it is sent, so the day's spend can never pass the budget even if every
// transaction burns its whole bid. Soroban refunds what goes unused; the budget does not, which
// errs on the side of stopping early.
//
// One thing is given back: a charge for a transaction the network refused to take in. No fee
// can be collected for it, and keeping the charge let anyone empty the day with transactions
// that were never going to be accepted (fifth review, F1) — which cost nothing to send and
// left every passkey owner unable to revoke, pause or withdraw until midnight UTC.
//
// A budget has lanes: the day's total, a reserve only an owner's exit calls may draw on once
// the total is gone, and a count of how often each wallet has drawn on that reserve. A lane
// is just a second counter under the same day.
//
// The count has to be shared by every instance of the worker, so it lives in one Durable
// Object (worker/relayBudget.ts). This file is the host-neutral part: the interface the relay
// sees and the accounting, unit-tested without a runtime.

/** The reserve an owner's exit calls draw on when the day's total is spent. */
export const SAFETY_LANE = "safety";

/** The counter of one wallet's draws on the reserve. */
export const safetyCallsLane = (wallet: string): string => `${SAFETY_LANE}:${wallet}`;

/** What a lane name may look like: it becomes part of a storage key. */
const LANE = /^[A-Za-z0-9:]{1,80}$/;

export const isLane = (lane: unknown): lane is string => typeof lane === "string" && LANE.test(lane);

export interface FeeBudget {
  /** Charge `stroops` against today's spend in `lane` (the day's total when left out); false
   *  when that would take it past `limit`. */
  reserve(stroops: bigint, limit: bigint, lane?: string): Promise<boolean>;
  /** Give a charge back: the network took no fee for it. Best effort — a release that fails
   *  leaves the day short, never over. */
  release(stroops: bigint, lane?: string): Promise<void>;
}

/** The storage a budget needs: one counter per day and lane. */
export interface BudgetStore {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
}

/** The UTC day a charge lands on. */
export const budgetDay = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 10);

/** The storage key of `lane` on `day`. The day's total keeps the bare date it always had. */
export const budgetKey = (day: string, lane?: string): string => (lane ? `${day}:${lane}` : day);

/** Add `stroops` to `key` unless that passes `limit`. The read and the write must not be split
 *  by another charge, which a Durable Object's input gate guarantees for its storage calls. */
export async function reserveIn(store: BudgetStore, key: string, stroops: bigint, limit: bigint): Promise<boolean> {
  if (stroops <= 0n) return true;
  const spent = BigInt((await store.get(key)) ?? "0");
  if (spent + stroops > limit) return false;
  await store.put(key, (spent + stroops).toString());
  return true;
}

/** Take `stroops` back off `key`, never below zero: a release for a day that has since turned
 *  finds nothing to give back and leaves it that way. */
export async function releaseIn(store: BudgetStore, key: string, stroops: bigint): Promise<void> {
  if (stroops <= 0n) return;
  const spent = BigInt((await store.get(key)) ?? "0");
  if (spent === 0n) return;
  await store.put(key, (spent > stroops ? spent - stroops : 0n).toString());
}
