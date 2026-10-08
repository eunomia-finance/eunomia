// Approving a payee is the treasury's policy; whether that payee can hold the token is the
// token's. A classic G… account receives USDC only once it trusts the issuer — without the
// trustline the token contract refuses every payment to it (#13, TrustlineMissingError),
// however the owner set the rules. Testers hit this by approving their agent's own key,
// which `eunomia-mcp init` funds with XLM and nothing else. Asking before the approval turns
// a mystery code at payment time into one sentence at setup time.
import { Horizon, StrKey } from "@stellar/stellar-sdk";
import { HORIZON_URL } from "../config";
import { ANCHOR_USDC_ISSUER, type TokenCode } from "./token";

export interface HorizonBalanceLine {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

export const trustsUsdc = (balances: HorizonBalanceLine[]): boolean =>
  balances.some((b) => b.asset_code === "USDC" && b.asset_issuer === ANCHOR_USDC_ISSUER);

/** True only when Horizon says `payee` cannot hold the treasury's token. XLM needs no
 *  trustline and contracts (C…) hold any token; every other doubt answers false so a
 *  Horizon hiccup never blocks an approval. */
export async function payeeLacksTrustline(
  payee: string,
  token: TokenCode,
  load: (account: string) => Promise<{ balances: HorizonBalanceLine[] }> = (a) => new Horizon.Server(HORIZON_URL).loadAccount(a),
): Promise<boolean> {
  if (token !== "USDC" || !StrKey.isValidEd25519PublicKey(payee) || payee === ANCHOR_USDC_ISSUER) return false;
  try {
    return !trustsUsdc((await load(payee)).balances);
  } catch (e) {
    // An account that does not exist cannot hold anything either.
    return (e as { response?: { status?: number } })?.response?.status === 404;
  }
}
