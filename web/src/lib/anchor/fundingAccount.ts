// The classic account that stands between the anchor and a treasury.
//
// A treasury is a contract and its owner may be a passkey smart wallet — both C-addresses.
// The anchor can sign in only G-accounts (its toml has no SEP-45 endpoint) and pays out only
// to G-accounts (it answers a C-address with "contract addresses are not supported"). So each
// treasury gets a funding account: a G-keypair made on this device that signs in to the
// anchor, receives the USDC, and forwards it into the treasury in the next transaction.
//
// ⚠️ Its SECRET lives in localStorage, like the agent session key (see session.ts), and for
// the same reason that is acceptable on TESTNET: it is a corridor, not a vault — it holds
// money only between the anchor's payment and the forward. Mainnet wants SEP-45 on the
// anchor's side (no corridor at all) or hardened key storage.
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { HORIZON_URL, RPC_URL } from "../../config";
import { fundWithFriendbot } from "../funding";
import { decimalToStroops } from "./amounts";
import type { Anchor } from "./discover";
import type { WithdrawInstructions } from "./transfers";

const PREFIX = "eunomia_funding:";

/** The funding keypair for a treasury, created on first use. */
export function fundingKey(treasuryId: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): Keypair {
  const saved = storage.getItem(PREFIX + treasuryId);
  if (saved) return Keypair.fromSecret(saved);
  const fresh = Keypair.random();
  storage.setItem(PREFIX + treasuryId, fresh.secret());
  return fresh;
}

export const anchorAsset = (anchor: Anchor): Asset => new Asset(anchor.assetCode, anchor.assetIssuer);

/** The Stellar Asset Contract of the anchor's asset — the token a treasury has to hold for
 *  anchored money to be spendable. Derived, not configured: it follows from the issuer. */
export const anchorTokenId = (anchor: Anchor): string => anchorAsset(anchor).contractId(anchor.networkPassphrase);

interface HorizonBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

export const hasTrustline = (balances: HorizonBalance[], anchor: Anchor): boolean =>
  balances.some((b) => b.asset_code === anchor.assetCode && b.asset_issuer === anchor.assetIssuer);

/** Make the funding account able to receive the anchor's asset: it exists, and it trusts the
 *  issuer. Without the trustline the anchor's payment has nowhere to land and the deposit
 *  parks in `pending_trust` — which reads, to a user, like our bug. */
export async function openFundingAccount(keypair: Keypair, anchor: Anchor): Promise<void> {
  const horizon = new Horizon.Server(HORIZON_URL);
  const account = keypair.publicKey();

  let loaded = await horizon.loadAccount(account).catch((e: { response?: { status?: number } }) => {
    if (e?.response?.status === 404) return null;
    throw e;
  });
  if (!loaded) {
    await fundWithFriendbot(account);
    loaded = await horizon.loadAccount(account);
  }
  if (hasTrustline(loaded.balances as HorizonBalance[], anchor)) return;

  const tx = new TransactionBuilder(loaded, { fee: BASE_FEE, networkPassphrase: anchor.networkPassphrase })
    .addOperation(Operation.changeTrust({ asset: anchorAsset(anchor) }))
    .setTimeout(60)
    .build();
  tx.sign(keypair);
  await horizon.submitTransaction(tx);
}

/** What the funding account holds right now, as the anchor's seven-place decimal. */
export async function fundingBalance(keypair: Keypair, anchor: Anchor): Promise<string> {
  const loaded = await new Horizon.Server(HORIZON_URL).loadAccount(keypair.publicKey());
  const line = (loaded.balances as HorizonBalance[]).find(
    (b) => b.asset_code === anchor.assetCode && b.asset_issuer === anchor.assetIssuer,
  );
  return line?.balance ?? "0.0000000";
}

/** Move `amount` of the anchor's asset from the funding account into the treasury and wait
 *  for the ledger to say so. Returns the transaction hash.
 *
 *  A token-contract transfer, not a classic payment: a payment operation cannot address a
 *  contract at all. */
export async function forwardToTreasury(
  keypair: Keypair,
  anchor: Anchor,
  treasuryId: string,
  amount: string,
): Promise<string> {
  const server = new rpc.Server(RPC_URL);
  const source = await server.getAccount(keypair.publicKey());
  const transfer = new Contract(anchorTokenId(anchor)).call(
    "transfer",
    new Address(keypair.publicKey()).toScVal(),
    new Address(treasuryId).toScVal(),
    nativeToScVal(decimalToStroops(amount), { type: "i128" }),
  );
  const built = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: anchor.networkPassphrase })
    .addOperation(transfer)
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(built);
  prepared.sign(keypair);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error("Stellar refused the transfer into the treasury before it reached a ledger.");
  }
  const done = await server.pollTransaction(sent.hash, { attempts: 40 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`The transfer into the treasury did not go through (${done.status}). Hash ${sent.hash}.`);
  }
  return sent.hash;
}

/** Send the USDC of a withdrawal to the anchor, with the memo that ties it to the request. */
export async function payAnchor(
  keypair: Keypair,
  anchor: Anchor,
  w: WithdrawInstructions,
  usdcAmount: string,
): Promise<string> {
  const horizon = new Horizon.Server(HORIZON_URL);
  const source = await horizon.loadAccount(keypair.publicKey());
  const memo =
    w.memoType === "id" ? Memo.id(w.memo) : w.memoType === "hash" ? Memo.hash(Buffer.from(w.memo, "base64")) : Memo.text(w.memo);
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: anchor.networkPassphrase })
    .addOperation(Operation.payment({ destination: w.account, asset: anchorAsset(anchor), amount: usdcAmount }))
    .addMemo(memo)
    .setTimeout(120)
    .build();
  tx.sign(keypair);
  return (await horizon.submitTransaction(tx)).hash;
}
