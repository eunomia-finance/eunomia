// The contract speaks in error codes (binding `Errors`). Everything here turns what the
// RPC or the ledger said into that same vocabulary, so an agent reads one set of names
// whether the refusal came from a pre-flight, a simulation or a transaction on-chain.
import type { xdr } from "@stellar/stellar-sdk";
import { Errors } from "./bindings/treasury.js";
import type { Reason } from "./budget.js";

const CONTRACT_ERROR_RE = /Error\(Contract,\s*#?(\d+)\)/;

/** Plain-language detail for the codes an agent can actually run into while paying. */
const DETAILS: Record<number, string> = {
  1: "amount must be positive",
  2: "payee is not on the owner's whitelist",
  3: "amount exceeds the per-payment cap",
  4: "amount exceeds what is left of the rolling 24h limit",
  5: "payee's reputation is below the owner's threshold",
  6: "amount exceeds the treasury's free balance",
  9: "treasury is paused by its owner",
  10: "amount exceeds what is left of the Leash cap",
};

/** Codes the token contract raises from inside pay(), not the treasury's policy. They reach
 *  the agent as the same `Error(Contract, #N)`; the treasury's own codes end at 12
 *  (errors.test.ts pins that), so these numbers cannot be confused with a policy verdict. */
const TOKEN_ERRORS: Record<number, { name: string; detail: string }> = {
  13: {
    name: "TrustlineMissing",
    detail:
      "the payee cannot hold the treasury's token: a G… account needs a trustline for the asset first. " +
      "The token contract refused, not the treasury's policy — approving the payee or raising limits will not help; " +
      "the payee's owner must add the trustline, or pay a different address",
  },
};

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function contractCodeFromMessage(msg: string): number | null {
  const m = CONTRACT_ERROR_RE.exec(msg);
  return m ? Number(m[1]) : null;
}

export function reasonFromCode(code: number, detail?: string): Reason {
  const known = (Errors as Record<number, { message: string }>)[code];
  const token = known ? undefined : TOKEN_ERRORS[code];
  if (token) return { code, name: token.name, detail: detail ?? token.detail };
  return {
    code,
    name: known?.message ?? `ContractError${code}`,
    detail: detail ?? DETAILS[code] ?? `the treasury contract refused with error #${code}`,
  };
}

/** The binding hands simulation refusals back as `Err({ message: "<Name>" })`. */
export function reasonFromErrorName(name: string): Reason | null {
  for (const [code, v] of Object.entries(Errors)) {
    if (v.message === name) return reasonFromCode(Number(code));
  }
  return null;
}

/** A failed transaction's diagnostic events carry the contract's verdict as an
 *  `Error(Contract, #N)` topic. Codes are reported once each, in first-seen order. */
export function reasonsFromDiagnostics(events: readonly xdr.DiagnosticEvent[] | undefined): Reason[] {
  const codes: number[] = [];
  for (const ev of events ?? []) {
    let topics: xdr.ScVal[];
    try {
      topics = ev.event().body().v0().topics();
    } catch {
      continue;
    }
    for (const t of topics) {
      if (t.switch().name !== "scvError") continue;
      const err = t.error();
      if (err.switch().name !== "sceContract") continue;
      const code = err.contractCode();
      if (!codes.includes(code)) codes.push(code);
    }
  }
  return codes.map((c) => reasonFromCode(c));
}
