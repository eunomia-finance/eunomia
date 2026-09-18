// Shared input validation for user-entered amounts and payment destinations. Pure and
// unit-testable, so the same checks front-run every wallet popup — a bad amount or address
// is caught with a clear message BEFORE we build a transaction, instead of surfacing an
// opaque SDK/Horizon error (or, for empty limit fields, a raw toStroops(NaN) throw).
import { StrKey } from "@stellar/stellar-sdk";

export type AmountResult = { ok: true; value: number } | { ok: false; msg: string };

/** Parse an XLM amount that must be a finite, strictly-positive number. */
export function parseXlmAmount(raw: string, label = "amount"): AmountResult {
  const s = raw.trim();
  if (!s) return { ok: false, msg: `Enter ${aOrAn(label)}.` };
  const value = Number(s);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, msg: `Enter a valid ${label} greater than zero.` };
  }
  return { ok: true, value };
}

/** Parse an amount that may be left out: blank and zero both mean "none". Anything else has
 *  to be a real amount. Starting funds are the case — the form says "0 opens it empty", and
 *  the strict parser above made that sentence false by refusing the zero. */
export function parseOptionalXlmAmount(raw: string, label = "amount"): AmountResult {
  const s = raw.trim();
  if (!s || Number(s) === 0) return { ok: true, value: 0 };
  return parseXlmAmount(s, label);
}

/** How many payments the compliance circuit can attest to in one period. Mirrors the
 *  treasury's `MAX_BATCH`, which rejects a policy that breaks this on-chain. */
export const MAX_BATCH = 16;

/** Whether a pair of limits is one the whole system can honour, worded for the person
 *  typing them.
 *
 *  The daily limit cannot exceed what MAX_BATCH payments of the per-payment limit add up
 *  to: the circuit proves a fixed batch of that size and must account for the period's
 *  entire spend, so a wider daily limit buys spending capacity no attestation could ever
 *  cover — and an unprovable day leaves the record silently, since the verifier only asks
 *  periods to move forward. The contract refuses such a policy; this says so first, in
 *  language that suggests the fix. */
export function checkLimits(daily: number, perTask: number): { ok: true } | { ok: false; msg: string } {
  if (perTask > daily) return { ok: false, msg: "Per-payment limit can't exceed the daily limit." };
  if (daily > MAX_BATCH * perTask) {
    const lowest = Math.ceil(daily / MAX_BATCH);
    return {
      ok: false,
      msg:
        `A daily limit above ${MAX_BATCH}x the per-payment limit can't be proved compliant, ` +
        `because a day could hold more payments than one proof covers. Raise the per-payment ` +
        `limit to at least ${lowest}, or lower the daily limit to ${MAX_BATCH * perTask}.`,
    };
  }
  return { ok: true };
}

/** Whether a string is a valid classic payment destination — a G… account or an
 *  M… muxed account. Contract (C…) addresses are not valid payment destinations. */
export function isValidPaymentDest(raw: string): boolean {
  const s = raw.trim();
  return StrKey.isValidEd25519PublicKey(s) || StrKey.isValidMed25519PublicKey(s);
}

function aOrAn(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}
