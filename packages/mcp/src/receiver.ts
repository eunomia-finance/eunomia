// Can this address receive the treasury's token at all? The treasury's policy can approve a
// payee the token itself refuses: a classic G… account holds a non-native asset only once
// it trusts the issuer, and without that trustline the token contract stops the transfer
// inside pay() with its own error #13 (TrustlineMissingError). The first agent to hit it
// paid its own freshly made key — friendbot funds that with XLM and nothing else.
//
// Contracts (C…) hold any token without a trustline, the native asset needs none, and an
// issuer holds its own asset, so only a G… payee of an issued asset is checked.
import { Account, Asset, BASE_FEE, Contract, Keypair, StrKey, TransactionBuilder, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { NULL_ACCOUNT } from "@stellar/stellar-sdk/contract";
import type { NetworkConfig } from "./network.js";

/** A Stellar Asset Contract's `name()` is "native" or "CODE:ISSUER". */
export function assetFromSacName(name: unknown): Asset | null {
  if (name === "native") return Asset.native();
  if (typeof name !== "string") return null;
  const [code, issuer] = name.split(":");
  if (!code || !issuer || !StrKey.isValidEd25519PublicKey(issuer)) return null;
  return new Asset(code, issuer);
}

/** The classic asset behind a token contract, by simulation — no key, no fee. Null for a
 *  token that is not a Stellar Asset Contract (it has no trustlines to check). */
export async function readTokenAsset(net: NetworkConfig, tokenId: string, server = new rpc.Server(net.rpcUrl)): Promise<Asset | null> {
  const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), { fee: BASE_FEE, networkPassphrase: net.passphrase })
    .addOperation(new Contract(tokenId).call("name"))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) return null;
  return assetFromSacName(scValToNative(sim.result.retval));
}

// A token's asset never changes; failures are not remembered.
const assets = new Map<string, Asset | null>();

/** True only when the chain says `payee` has no trustline for the treasury's token. Every
 *  doubt answers false: this is advice before the contract's own verdict, and an RPC hiccup
 *  must not turn a payment that would go through into a refusal. */
export async function lacksTrustline(
  net: NetworkConfig,
  tokenId: string,
  payee: string,
  server = new rpc.Server(net.rpcUrl),
): Promise<boolean> {
  if (!StrKey.isValidEd25519PublicKey(payee)) return false;
  try {
    const key = `${net.name}:${tokenId}`;
    let asset = assets.get(key);
    if (asset === undefined) {
      asset = await readTokenAsset(net, tokenId, server);
      if (asset) assets.set(key, asset);
    }
    if (!asset || asset.isNative() || asset.getIssuer() === payee) return false;
    const ledgerKey = xdr.LedgerKey.trustline(
      new xdr.LedgerKeyTrustLine({
        accountId: Keypair.fromPublicKey(payee).xdrAccountId(),
        asset: asset.toTrustLineXDRObject(),
      }),
    );
    const res = await server.getLedgerEntries(ledgerKey);
    return res.entries.length === 0;
  } catch {
    return false;
  }
}
