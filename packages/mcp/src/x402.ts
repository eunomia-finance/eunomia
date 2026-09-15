// x402 v2 on Stellar defines one scheme, "exact" (coinbase/x402 specs/schemes/exact/
// scheme_exact_stellar.md). A 402 response lists `accepts[]`; the treasury can settle an
// option only if it is that scheme, this network and the treasury's own token. The
// facilitator handshake is out of scope for eunomia-mcp (SOW): settlement is the treasury's
// `pay()` to `payTo`, enforced on-chain — see packages/x402 for the funded-agent interop.
import type { NetworkName } from "./format.js";

export interface PaymentRequirements {
  scheme: string;
  /** CAIP-2, e.g. "stellar:testnet" */
  network: string;
  /** atomic units (7 decimals for every Stellar SAC), decimal string */
  amount: string;
  /** SEP-41 contract id of the asset */
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export const caip2 = (net: NetworkName): string => `stellar:${net}`;

/** The 402 payload: a JSON body, or the base64 `PAYMENT-REQUIRED` header (wire format v2). */
export function decodePaymentRequired(input: string): { x402Version?: number; accepts: PaymentRequirements[] } {
  const raw = input.trim();
  const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const parsed = JSON.parse(text) as { x402Version?: number; accepts?: unknown };
  if (!Array.isArray(parsed.accepts)) throw new Error("PAYMENT-REQUIRED payload has no `accepts` list");
  return { x402Version: parsed.x402Version, accepts: parsed.accepts as PaymentRequirements[] };
}

/** Every reason this treasury cannot settle `req`; empty means it can (limits are the
 *  contract's business and are checked at payment time, not here). */
export function checkRequirement(req: PaymentRequirements, net: NetworkName, token: string): string[] {
  const problems: string[] = [];
  if (req.scheme !== "exact") problems.push(`scheme "${req.scheme}" is not "exact" (the only Stellar x402 scheme)`);
  if (req.network !== caip2(net)) problems.push(`network "${req.network}" is not "${caip2(net)}"`);
  if (req.asset !== token) problems.push(`asset ${req.asset} is not the treasury's token ${token}`);
  if (!/^\d+$/.test(req.amount ?? "") || BigInt(req.amount || "0") <= 0n) {
    problems.push(`amount "${req.amount}" is not a positive atomic-unit integer`);
  }
  return problems;
}

export function selectRequirement(
  accepts: PaymentRequirements[],
  net: NetworkName,
  token: string,
): { req: PaymentRequirements | null; rejected: Array<{ req: PaymentRequirements; problems: string[] }> } {
  const rejected: Array<{ req: PaymentRequirements; problems: string[] }> = [];
  for (const req of accepts) {
    const problems = checkRequirement(req, net, token);
    if (problems.length === 0) return { req, rejected };
    rejected.push({ req, problems });
  }
  return { req: null, rejected };
}
