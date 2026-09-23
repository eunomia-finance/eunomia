import { gateX402 } from "./gate.js";
import type { GateResult, PaymentRequirements, TreasuryPolicy } from "./types.js";

/** Called for every payment option the gate examines — surfaces refusal reasons
 *  instead of silently filtering them away. */
export type GateDecision = (req: PaymentRequirements, gate: GateResult) => void;

/**
 * Adapt the bounded gate to the x402 client's PaymentPolicy seam
 * (`x402Client.registerPolicy`): payment options that violate the treasury
 * policy are removed BEFORE the client ever signs a payment, so an over-limit
 * or wrong-payee 402 can't produce a signature at all. Structurally compatible
 * with @x402/core's `PaymentPolicy` — no dependency needed here.
 *
 * The policy is a snapshot, and x402 payments leave from the agent's allowance
 * account rather than through `treasury.pay`, so the chain never counts them
 * against the daily limit. The filter counts them itself: every 402 it lets
 * through adds to the day's spend. Which of the kept options the client signs
 * is its own choice, so the largest one is charged — overcounting is the safe
 * direction for a limit.
 */
export function makeBoundedPolicy(policy: TreasuryPolicy, onDecision?: GateDecision) {
  let daySpent = policy.daySpent;
  return (_x402Version: number, reqs: PaymentRequirements[]): PaymentRequirements[] => {
    const current = { ...policy, daySpent };
    let charged = 0n;
    const kept = reqs.filter((req) => {
      const gate = gateX402(req, current);
      onDecision?.(req, gate);
      if (gate.allowed && gate.amount > charged) charged = gate.amount;
      return gate.allowed;
    });
    daySpent += charged;
    return kept;
  };
}
