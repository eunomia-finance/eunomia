// SEP-10. The anchor knows a user by a Stellar key, not an API key: it hands out a challenge
// transaction, the key signs it, and the anchor answers with a JWT.
//
// The challenge is checked before it is signed. A signature over an arbitrary transaction is
// the one thing a hostile or compromised endpoint would want from this key, so the challenge
// has to be provably unsubmittable (sequence 0, manage-data only), addressed to this account,
// for this home domain, and signed by the key the anchor's own stellar.toml names.
import { WebAuth, type Keypair } from "@stellar/stellar-sdk";
import type { Anchor } from "./discover";
import { anchorJson } from "./http";

interface Challenge {
  transaction: string;
  network_passphrase?: string;
}

/** Sign in to the anchor with a classic account and return the JWT.
 *
 *  A G-account on purpose: the anchor's toml has no WEB_AUTH_FOR_CONTRACTS_ENDPOINT (SEP-45),
 *  so a passkey smart wallet — a C-address — cannot authenticate here at all. */
export async function signIn(
  anchor: Anchor,
  keypair: Keypair,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const account = keypair.publicKey();
  const challenge = await anchorJson<Challenge>(
    anchor.webAuth,
    { query: { account, home_domain: anchor.homeDomain } },
    fetchFn,
  );

  if (challenge.network_passphrase && challenge.network_passphrase !== anchor.networkPassphrase) {
    throw new Error("The anchor's sign-in challenge is for a different Stellar network.");
  }

  const { tx, clientAccountID } = WebAuth.readChallengeTx(
    challenge.transaction,
    anchor.signingKey,
    anchor.networkPassphrase,
    anchor.homeDomain,
    new URL(anchor.webAuth).host,
  );
  if (clientAccountID !== account) {
    throw new Error("The anchor's sign-in challenge is addressed to a different account.");
  }
  if (!WebAuth.verifyTxSignedBy(tx, anchor.signingKey)) {
    throw new Error("The anchor's sign-in challenge is not signed by its published key.");
  }

  tx.sign(keypair);
  const { token } = await anchorJson<{ token?: string }>(
    anchor.webAuth,
    { method: "POST", body: { transaction: tx.toXDR() } },
    fetchFn,
  );
  if (!token) throw new Error("The anchor accepted the sign-in but returned no token.");
  return token;
}
