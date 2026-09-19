// Agent session keys — a browser-local, time-bound, spend-capped credential the
// treasury recognises as its ONLY spender while active. This is what makes the
// per-user product's agent autonomous: after one wallet-signed set_session, the
// session keypair signs payments with no wallet popups (same pattern as the demo
// agent in eunomia.ts).
//
// ⚠️ The session SECRET lives in localStorage — acceptable on TESTNET precisely
// because the design's point is a bounded credential: cap + expiry + instant
// revoke make a leak survivable. Mainnet needs fee sponsorship + hardened key
// storage (roadmap M3); the demo key's non-testnet build guard applies there too.
import { BASE_FEE, Keypair, Operation, StrKey, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { NETWORK_PASSPHRASE, RPC_URL } from "../config";
import {
  encodeExceptionPayload,
  exceptionEntryName,
  exceptionIdOf,
  type ExceptionPayload,
} from "./exceptionCodec";
import { fundWithFriendbot } from "./funding";
import type { Session } from "./treasuryClient";
import type { Treasury } from "./userTreasury";
import { makeWalletExecutor } from "./executor";
import { makeTreasury, pay, setSession, type PayResult } from "./userTreasury";
import type { ContractSigner } from "./walletSigner";

const PREFIX = "prism_session:";

export function loadSessionSecret(treasuryId: string): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(PREFIX + treasuryId);
}

export function saveSessionSecret(treasuryId: string, secret: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PREFIX + treasuryId, secret);
}

export function clearSessionSecret(treasuryId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(PREFIX + treasuryId);
}

/** Whether a stored session is still active (the contract uses the same `<` rule). */
export function sessionIsActive(
  session: Pick<Session, "valid_until"> | null,
  nowMs: number = Date.now(),
): boolean {
  return session !== null && nowMs / 1000 < Number(session.valid_until);
}

/** The session keypair as a contract-client signer (no popups — it signs locally).
 *  Wrapped so the optional signerAddress from basicNodeSigner becomes concrete. */
export function sessionSigner(secret: string): { publicKey: string; signer: ContractSigner } {
  const kp = Keypair.fromSecret(secret);
  const s = basicNodeSigner(kp, NETWORK_PASSPHRASE);
  const publicKey = kp.publicKey();
  return {
    publicKey,
    signer: {
      signTransaction: async (xdr, opts) => {
        const res = await s.signTransaction(xdr, opts);
        return { signedTxXdr: res.signedTxXdr, signerAddress: res.signerAddress ?? publicKey };
      },
    },
  };
}

/** Start an agent session: register a fresh keypair with the wallet-signed
 *  `set_session`, THEN friendbot-fund it (it is the tx source for autonomous
 *  payments, so it must exist and pay its own fees). Wallet-signature first:
 *  declines are common and shouldn't burn rate-limited friendbot calls on
 *  accounts that will never be used. The secret is stored as soon as the
 *  on-chain registration succeeds — even if funding then fails, the session is
 *  live on-chain (single-spender), so the key must not be lost. */
export async function createSession(
  walletTreasury: Treasury,
  treasuryId: string,
  capXlm: number,
  durationHours: number,
  onPhase?: (phase: "registering" | "funding") => void,
): Promise<PayResult & { sessionPk?: string; registered?: boolean }> {
  const kp = Keypair.random();
  const validUntil = BigInt(Math.floor(Date.now() / 1000) + Math.round(durationHours * 3600));
  onPhase?.("registering");
  const res = await setSession(walletTreasury, kp.publicKey(), validUntil, capXlm);
  if (!res.ok) return res;
  saveSessionSecret(treasuryId, kp.secret());
  onPhase?.("funding");
  try {
    await fundWithFriendbot(kp.publicKey()); // fresh key → the account never pre-exists
  } catch (e) {
    // The session is ALREADY live on-chain (single-spender) and its secret is saved —
    // signal `registered` so the caller reflects that truth (show revoke) instead of
    // treating this as a plain failure that leaves the UI out of sync with the chain.
    return {
      ok: false,
      registered: true,
      sessionPk: kp.publicKey(),
      errorMessage: `Session registered, but funding its key failed (${
        e instanceof Error ? e.message : "friendbot error"
      }) — revoke the session below and start a new one.`,
    };
  }
  return { ...res, sessionPk: kp.publicKey(), registered: true };
}

/** A Stellar public key (G…) — what an external agent hands the owner. */
export function isValidAgentKey(pk: string): boolean {
  return StrKey.isValidEd25519PublicKey(pk.trim());
}

/** Put an EXTERNAL agent on the Leash: the agent (eunomia-mcp on the user's machine, or
 *  any process holding its own key) generated the key itself and only its public half
 *  arrives here. Nothing is generated, funded or stored on this device — the agent
 *  already holds and funds its key — and a stale local secret is cleared so the UI does
 *  not claim a key it no longer controls. */
export async function registerAgentKey(
  walletTreasury: Treasury,
  treasuryId: string,
  agentPublicKey: string,
  capXlm: number,
  durationHours: number,
): Promise<PayResult & { sessionPk?: string; registered?: boolean }> {
  const pk = agentPublicKey.trim();
  if (!isValidAgentKey(pk)) {
    return {
      ok: false,
      errorMessage: "That is not a Stellar public key (G…, 56 characters) — copy it from `eunomia-mcp init`.",
    };
  }
  const validUntil = BigInt(Math.floor(Date.now() / 1000) + Math.round(durationHours * 3600));
  const res = await setSession(walletTreasury, pk, validUntil, capXlm);
  if (!res.ok) return res;
  clearSessionSecret(treasuryId);
  return { ...res, sessionPk: pk, registered: true };
}

/** A zero-popup payment signed by the session key — the autonomous-agent path. */
export async function sessionPay(
  treasuryId: string,
  secret: string,
  taskId: bigint,
  to: string,
  amountXlm: number,
): Promise<PayResult> {
  let publicKey: string, signer: ReturnType<typeof sessionSigner>["signer"];
  try {
    ({ publicKey, signer } = sessionSigner(secret));
  } catch {
    // A corrupted localStorage secret would otherwise surface as a cryptic
    // "invalid secret key" — guide the user to the actual fix instead.
    return {
      ok: false,
      errorMessage: "This device's session key is invalid — revoke the session and start a new one.",
    };
  }
  // The session key signs and submits over RPC exactly like a wallet would — it is a plain
  // Ed25519 credential, not a smart wallet, so the relay is not involved here.
  const t = makeTreasury(treasuryId, makeWalletExecutor(publicKey, signer));
  return pay(t, taskId, to, amountXlm);
}

/** The agent's side of an exception request, signed by the Leash key in this browser.
 *  An external agent files these from eunomia-mcp (packages/mcp/src/exception.ts); the
 *  agent on this device needs the same entry on its own account, or the owner's "Waiting
 *  for you" panel has nothing to resolve. Same codec, same account, same 56-byte layout —
 *  the owner's dashboard cannot tell the two agents apart, which is the point. */
export async function sessionRequestException(
  treasuryId: string,
  secret: string,
  payload: ExceptionPayload,
  nowMs: number = Date.now(),
): Promise<{ ok: boolean; id?: string; hash?: string; errorMessage?: string }> {
  try {
    const kp = Keypair.fromSecret(secret);
    const server = new rpc.Server(RPC_URL);
    const source = await server.getAccount(kp.publicKey());
    const name = exceptionEntryName(treasuryId, nowMs);
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(Operation.manageData({ name, value: Buffer.from(encodeExceptionPayload(payload)) }))
      .setTimeout(120)
      .build();
    tx.sign(kp);
    const sent = await server.sendTransaction(tx);
    if (sent.status === "ERROR") {
      return { ok: false, errorMessage: "Stellar refused the request before it reached a ledger." };
    }
    const done = await server.pollTransaction(sent.hash, { attempts: 30 });
    if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      return { ok: false, errorMessage: `The request did not reach the ledger (${done.status}).` };
    }
    return { ok: true, id: exceptionIdOf(name), hash: sent.hash };
  } catch (e) {
    return { ok: false, errorMessage: e instanceof Error ? e.message : "Could not file the request." };
  }
}
