// Pure budget arithmetic over a treasury snapshot. Mirrors the contract's checks so an
// agent can pre-flight a payment and read the same rejection vocabulary the chain uses;
// the treasury contract remains the final word at payment time.
import { Errors } from "./bindings/treasury.js";

export interface TreasurySnapshot {
  contractId: string;
  config: { admin: string; agent: string; token: string; daily_limit: bigint; per_task_limit: bigint };
  balance: bigint;
  locked: bigint;
  /** spend inside the rolling 24h window */
  daySpent: bigint;
  paused: boolean;
  session: { agent: string; valid_until: bigint; limit: bigint; spent: bigint } | null;
  reputationPolicy: { registry: string; minReputation: bigint } | null;
  /** pre-M2 treasury: no session / pause surface at all */
  legacy: boolean;
}

export interface SessionView {
  agent: string;
  isThisAgent: boolean;
  active: boolean;
  /** unix seconds */
  validUntil: number;
  /** 0 once expired */
  expiresInSec: number;
  cap: bigint;
  spent: bigint;
  remaining: bigint;
}

export interface Reason {
  /** the treasury contract's error code (see `Errors` in the binding) */
  code: number;
  name: string;
  detail: string;
}

export interface Budget {
  contractId: string;
  token: string;
  paused: boolean;
  perPaymentCap: bigint;
  dailyLimit: bigint;
  daySpent: bigint;
  dailyRemaining: bigint;
  freeBalance: bigint;
  session: SessionView | null;
  canSpend: boolean;
  spendableNow: bigint;
  blockers: string[];
  reputationPolicy: TreasurySnapshot["reputationPolicy"];
  decision?: { amount: bigint; allowed: boolean; reasons: Reason[] };
}

const max0 = (v: bigint) => (v < 0n ? 0n : v);
const min = (...v: bigint[]) => v.reduce((a, b) => (a < b ? a : b));
const reason = (code: keyof typeof Errors, detail: string): Reason => ({
  code,
  name: Errors[code].message,
  detail,
});

export function computeBudget(
  s: TreasurySnapshot,
  agentPk: string | null,
  nowSec: number,
  amount?: bigint,
): Budget {
  const dailyRemaining = max0(s.config.daily_limit - s.daySpent);
  const freeBalance = max0(s.balance - s.locked);
  const blockers: string[] = [];
  let session: SessionView | null = null;

  if (s.session) {
    const validUntil = Number(s.session.valid_until);
    const active = nowSec < validUntil; // the contract uses the same strict rule
    session = {
      agent: s.session.agent,
      isThisAgent: agentPk !== null && s.session.agent === agentPk,
      active,
      validUntil,
      expiresInSec: active ? validUntil - nowSec : 0,
      cap: s.session.limit,
      spent: s.session.spent,
      remaining: max0(s.session.limit - s.session.spent),
    };
  }

  if (s.paused) {
    blockers.push("Treasury is paused by its owner — no payments until it is resumed.");
  }
  // With no active Leash the contract's spender is the treasury's own agent (`cfg.agent`),
  // so that key needs no Leash at all.
  const rootSpends = agentPk !== null && agentPk === s.config.agent && !session?.active;

  if (agentPk === null) {
    blockers.push(
      "No agent credential configured — run `eunomia-mcp init --treasury <id>` and have the owner start a Leash for the printed public key.",
    );
  } else if (rootSpends) {
    // nothing to add: the root agent spends under the treasury's own limits
  } else if (!session) {
    blockers.push(
      "No active Leash for this treasury — the owner must start one for this agent's public key from the Eunomia dashboard.",
    );
  } else if (!session.isThisAgent) {
    blockers.push(
      "The active Leash belongs to another agent — the owner must revoke it and start one for this agent's public key.",
    );
  } else if (!session.active) {
    blockers.push(
      `The Leash expired at ${new Date(session.validUntil * 1000).toISOString()} — the owner must start a new one.`,
    );
  } else if (session.remaining === 0n) {
    blockers.push("The Leash's spending cap is used up — the owner must start a new one.");
  }
  if (dailyRemaining === 0n) {
    blockers.push("The treasury's rolling 24h limit is reached — wait for spend to roll off the window.");
  }
  if (freeBalance === 0n) {
    blockers.push("The treasury has no free balance — the owner must fund it.");
  }

  const canSpend = blockers.length === 0;
  const spendableNow =
    !canSpend
      ? 0n
      : rootSpends
        ? min(s.config.per_task_limit, dailyRemaining, freeBalance)
        : session
          ? min(s.config.per_task_limit, dailyRemaining, session.remaining, freeBalance)
          : 0n;

  const b: Budget = {
    contractId: s.contractId,
    token: s.config.token,
    paused: s.paused,
    perPaymentCap: s.config.per_task_limit,
    dailyLimit: s.config.daily_limit,
    daySpent: s.daySpent,
    dailyRemaining,
    freeBalance,
    session,
    canSpend,
    spendableNow,
    blockers,
    reputationPolicy: s.reputationPolicy,
  };

  if (amount !== undefined) {
    const reasons: Reason[] = [];
    if (amount <= 0n) {
      reasons.push(reason(1, "amount must be positive"));
    } else {
      if (s.paused) reasons.push(reason(9, "treasury paused"));
      if (amount > s.config.per_task_limit) {
        reasons.push(reason(3, `amount exceeds the per-payment cap (${s.config.per_task_limit} stroops)`));
      }
      if (amount > dailyRemaining) {
        reasons.push(reason(4, `amount exceeds what is left of the rolling 24h limit (${dailyRemaining} stroops)`));
      }
      if (session && session.isThisAgent && session.active && amount > session.remaining) {
        reasons.push(reason(10, `amount exceeds what is left of the Leash cap (${session.remaining} stroops)`));
      }
      if (amount > freeBalance) {
        reasons.push(reason(6, `amount exceeds the treasury's free balance (${freeBalance} stroops)`));
      }
    }
    b.decision = { amount, allowed: canSpend && reasons.length === 0, reasons };
  }
  return b;
}
