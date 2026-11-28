// The Leash — a time-bound, spend-capped key the treasury recognises as its ONLY spender
// while active. This is what makes the agent autonomous: after one owner-signed set_session,
// the agent's key signs payments with no wallet popups.
//
// The agent always brings its own key (eunomia-mcp on its own machine) and only the public
// half arrives here. Nothing is generated, funded or stored in this browser: a key kept in
// localStorage would be holding real money.
import { StrKey } from "@stellar/stellar-sdk";
import type { Session } from "./treasuryClient";
import type { Treasury } from "./userTreasury";
import { tx } from "./i18n";
import { setSession,type PayResult } from "./userTreasury";

/** Whether a stored session is still active (the contract uses the same `<` rule). */
export function sessionIsActive(
  session: Pick<Session, "valid_until"> | null,
  nowMs: number = Date.now(),
): boolean {
  return session !== null && nowMs / 1000 < Number(session.valid_until);
}

/** A Stellar public key (G…) — what an external agent hands the owner. */
export function isValidAgentKey(pk: string): boolean {
  return StrKey.isValidEd25519PublicKey(pk.trim());
}

/** Put an agent on the Leash: the agent generated the key itself and holds and funds it;
 *  the owner signs the cap and the deadline. */
export async function registerAgentKey(
  walletTreasury: Treasury,
  agentPublicKey: string,
  capXlm: number,
  durationHours: number,
): Promise<PayResult & { sessionPk?: string; registered?: boolean }> {
  const pk = agentPublicKey.trim();
  if (!isValidAgentKey(pk)) {
    return {
      ok: false,
      errorMessage: tx(
        "That is not a Stellar public key (G…, 56 characters) — copy it from `eunomia-mcp init`.",
        "Bu bir Stellar adresi değil (G…, 56 karakter) — `eunomia-mcp init` komutunun yazdığı adresi kopyala.",
      ),
    };
  }
  const validUntil = BigInt(Math.floor(Date.now() / 1000) + Math.round(durationHours * 3600));
  const res = await setSession(walletTreasury, pk, validUntil, capXlm);
  if (!res.ok) return res;
  return { ...res, sessionPk: pk, registered: true };
}
