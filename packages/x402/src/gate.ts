import type { GateResult, PaymentRequirements, TreasuryPolicy } from "./types.js";

/**
 * Decide whether an x402 payment is allowed under the treasury's policy — the
 * "bounded x402" pre-flight. Mirrors the on-chain gate (asset, per-task limit,
 * daily limit, payee whitelist OR reputation) so the agent never even attempts a
 * payment the contract would reject. For a payment settled through `treasury.pay`
 * the chain is the final word; one paid from the allowance account (the x402 client
 * path) is bounded only by this gate and the allowance balance.
 */
export function gateX402(req: PaymentRequirements, policy: TreasuryPolicy): GateResult {
  if (req.scheme !== "exact") {
    return { allowed: false, amount: 0n, reason: `unsupported scheme "${req.scheme}"` };
  }
  const amount = BigInt(req.amount);

  if (req.asset !== policy.token) {
    return { allowed: false, amount, reason: "asset mismatch with treasury token" };
  }
  if (amount <= 0n) {
    return { allowed: false, amount, reason: "non-positive amount" };
  }
  if (amount > policy.perTaskLimit) {
    return { allowed: false, amount, reason: "exceeds per-task limit" };
  }
  if (policy.daySpent + amount > policy.dailyLimit) {
    return { allowed: false, amount, reason: "exceeds daily limit" };
  }
  if (!policy.isAllowedPayee(req.payTo)) {
    return { allowed: false, amount, reason: "payee not whitelisted and below reputation threshold" };
  }
  return { allowed: true, amount };
}
