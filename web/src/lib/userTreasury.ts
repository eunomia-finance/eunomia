// Per-user treasury operations: deploy a fresh treasury owned by the connected wallet,
// fund it, govern its policy, and spend from it — all signed by the user's wallet. This is
// the per-user analogue of eunomia.ts (which drives the single embedded-agent demo treasury).
import {
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { Client, type Session } from "./treasuryClient";
import { contractErr, errText } from "./wallet-errors";
import type { SubmittableTx, TxExecutor } from "./executor";
import { TREASURY_WASM_HASH } from "./treasuryWasm";
import { NETWORK_PASSPHRASE, RPC_URL } from "../config";

// Native XLM SAC on testnet — the token each user treasury holds and spends.
export const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
// Treasury WASM already installed on-chain — deploy just instantiates a new contract from it.
// Defined in its own module so the relay, which decides whether to sponsor the deploy, reads
// the very same value; see the drift note in relayGuard.allowedWasmHashes.
export { TREASURY_WASM_HASH };

const XLM_UNIT = 10_000_000;

/** Whether a pasted string is a well-formed contract id (C…, 56 chars, valid checksum). */
export function isValidContractId(id: string): boolean {
  return StrKey.isValidContract(id);
}

/** XLM (float) -> i128 stroops (7 decimals), rounded to avoid float drift. */
export function toStroops(xlm: number): bigint {
  if (!Number.isFinite(xlm) || xlm < 0) {
    throw new Error("Amount must be a non-negative number.");
  }
  return BigInt(Math.round(xlm * XLM_UNIT));
}

export interface EunomiaState {
  balance: bigint;
  daySpent: bigint;
  dailyLimit: bigint;
  perTaskLimit: bigint;
  admin: string;
  agent: string;
  token: string;
}

/** Whether the connected wallet actually administers this treasury.
 *
 *  TreasuryRegistry.register() stores an UNVERIFIED claim — it checks that the
 *  caller signed, never that the registered contract is a treasury they admin. The
 *  app then auto-adopts the newest registered entry on a fresh device. So one
 *  signature on a zero-value "back up your treasury" call is enough to point a
 *  victim at a treasury the attacker administers, and the victim funds it.
 *
 *  The chain already answers this: the treasury's own `admin` must be the wallet in
 *  hand. Fails closed — no state or no wallet means no. */
export function isOwnedBy(state: EunomiaState | null, wallet: string | null): boolean {
  return !!state && !!wallet && state.admin === wallet;
}

export interface PayResult {
  ok: boolean;
  hash?: string;
  errorCode?: number;
  errorMessage?: string;
  /** true = an infra/concurrency hiccup (stale sequence, RPC busy), NOT a contract
   *  guardrail rejection — safe to retry. Only the shared-agent demo path sets it. */
  transient?: boolean;
}

/** A treasury Client plus the executor that submits for it.
 *
 *  Building the transaction and submitting it are separate concerns now: a wallet session
 *  submits over the contract client's own RPC, a passkey session signs with the smart wallet
 *  and hands the result to the relay. Carrying the executor alongside the client keeps every
 *  operation below indifferent to which one is in play. */
export interface Treasury {
  client: Client;
  submit: (tx: SubmittableTx) => Promise<{ hash?: string }>;
}

/** A treasury bound to a runtime contract id + the session that owns it. */
export function makeTreasury(contractId: string, executor: TxExecutor): Treasury {
  return {
    client: new Client({
      contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      // A smart wallet is not a classic account. The contract client resolves `publicKey`
      // with getAccount(), which answers a C-address with "invalid version byte. expected
      // 48, got 16" — so passing one made every read and write on the treasury fail before
      // it reached the chain. Left unset, the SDK simulates against its null account, which
      // is all a simulation needs. Authorisation is unaffected: the treasury requires its
      // admin to sign, and the admin is the wallet, so the auth entry still binds to it.
      ...(executor.kind === "passkey" ? {} : { publicKey: executor.address }),
      signTransaction: executor.signer.signTransaction,
    }),
    submit: executor.submit,
  };
}

/** The `__constructor(admin, agent, token, daily_limit, per_task_limit)` arguments, in the
 *  order the contract declares them. Only the smart-wallet deploy path needs them positionally
 *  — the contract client builds them from its own spec. */
function constructorArgs(owner: string, dailyXlm: number, perTaskXlm: number): xdr.ScVal[] {
  return [
    new Address(owner).toScVal(),
    new Address(owner).toScVal(),
    new Address(XLM_SAC).toScVal(),
    nativeToScVal(toStroops(dailyXlm), { type: "i128" }),
    nativeToScVal(toStroops(perTaskXlm), { type: "i128" }),
  ];
}

/** Deploy a fresh treasury owned by `address` (admin = agent = the wallet). Returns its id. */
export async function deployTreasury(
  executor: TxExecutor,
  dailyXlm: number,
  perTaskXlm: number,
): Promise<string> {
  // A smart wallet has to deploy as itself: it holds no XLM to source a transaction from, and
  // the relayer that pays on its behalf only accepts authorisation bound to an address.
  if (executor.deployContract) {
    return executor.deployContract(
      TREASURY_WASM_HASH,
      constructorArgs(executor.address, dailyXlm, perTaskXlm),
    );
  }

  const tx = await Client.deploy(
    {
      admin: executor.address,
      agent: executor.address,
      token: XLM_SAC,
      daily_limit: toStroops(dailyXlm),
      per_task_limit: toStroops(perTaskXlm),
    },
    {
      wasmHash: TREASURY_WASM_HASH,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: executor.address,
      signTransaction: executor.signer.signTransaction,
    },
  );
  // The deployed id is known from the assembled transaction, so it survives either submit path.
  const contractId = tx.result.options.contractId;
  await executor.submit(tx);
  return contractId;
}

/** Fund a treasury by transferring native XLM from the session's address into the treasury
 *  contract — a SAC transfer either way, but authorised differently.
 *
 *  A wallet is the transaction source, so its own signature covers the `from` auth. A smart
 *  wallet cannot be a source at all: it signs the auth entry instead and the relay submits.
 *  Passing its C-address to `getAccount` below is what produced "invalid version byte". */
export async function fundTreasury(
  contractId: string,
  executor: TxExecutor,
  amountXlm: number,
): Promise<string | undefined> {
  if (executor.transferXlm) {
    await executor.transferXlm(contractId, toStroops(amountXlm));
    return undefined;
  }

  const address = executor.address;
  const signer = executor.signer;
  const server = new rpc.Server(RPC_URL);
  const account = await server.getAccount(address);
  const sac = new Contract(XLM_SAC);
  const op = sac.call(
    "transfer",
    new Address(address).toScVal(),
    new Address(contractId).toScVal(),
    nativeToScVal(toStroops(amountXlm), { type: "i128" }),
  );
  const built = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();
  const prepared = await server.prepareTransaction(built);
  const { signedTxXdr } = await signer.signTransaction(prepared.toXDR());
  const sent = await server.sendTransaction(
    TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE),
  );
  if (sent.status === "ERROR") {
    throw new Error("Stellar refused the transfer into the treasury before it reached a ledger.");
  }
  const done = await server.pollTransaction(sent.hash, { attempts: 40 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`The transfer into the treasury did not go through (${done.status}).`);
  }
  return sent.hash;
}

export async function readState(t: Treasury): Promise<EunomiaState> {
  const [bal, cfg, day] = await Promise.all([
    t.client.balance(),
    t.client.get_config(),
    t.client.day_spent(),
  ]);
  const c = cfg.result;
  return {
    balance: bal.result,
    daySpent: day.result,
    dailyLimit: c.daily_limit,
    perTaskLimit: c.per_task_limit,
    admin: c.admin,
    agent: c.agent,
    token: c.token,
  };
}

/** Read-only whitelist probe (simulation, no signature) — the chain-truth behind the
 *  "verified" badge on the derived payee list. */
export async function isPayee(t: Treasury, payee: string): Promise<boolean> {
  const tx = await t.client.is_payee({ payee });
  return tx.result;
}

export async function addPayee(t: Treasury, payee: string): Promise<void> {
  await t.submit(await t.client.add_payee({ payee }));
}

export async function removePayee(t: Treasury, payee: string): Promise<void> {
  await t.submit(await t.client.remove_payee({ payee }));
}

/** Build → sign → send a contract tx, mapping on-chain guardrail rejections
 *  to friendly messages. Shared by every state-changing treasury call. */
async function sendTx(
  build: () => Promise<SubmittableTx>,
  failMsg: string,
  submit: (tx: SubmittableTx) => Promise<{ hash?: string }>,
): Promise<PayResult> {
  try {
    const { hash } = await submit(await build());
    return { ok: true, hash };
  } catch (e) {
    const msg = errText(e);
    const ce = contractErr(msg);
    if (ce) return { ok: false, ...ce };
    return { ok: false, errorMessage: msg.slice(0, 160) || failMsg };
  }
}

/** Spend from the treasury. The contract enforces the policy and rejects violations
 *  on-chain — those rejections are the product working, surfaced as messages. */
export async function pay(
  t: Treasury,
  taskId: bigint,
  to: string,
  amountXlm: number,
): Promise<PayResult> {
  return sendTx(
    () => t.client.pay({ task_id: taskId, to, amount: toStroops(amountXlm) }),
    "Payment failed.",
    t.submit,
  );
}

// ---- M2 lifecycle ---------------------------------------------------------------

export interface Lifecycle {
  paused: boolean;
  session: Session | null;
}

/** The v3 lifecycle state (pause flag + agent session). Returns null on a pre-M2
 *  treasury — callers treat null as "legacy: hide the session/lifecycle sections". */
export async function readLifecycle(t: Treasury): Promise<Lifecycle | null> {
  try {
    const [paused, session] = await Promise.all([t.client.is_paused(), t.client.get_session()]);
    return { paused: paused.result, session: session.result ?? null };
  } catch {
    return null;
  }
}

/** Freeze/unfreeze spending (owner-signed). Exit paths keep working while paused. */
export async function setPaused(t: Treasury, paused: boolean): Promise<PayResult> {
  return sendTx(() => t.client.set_paused({ paused }), "Pause toggle failed.", t.submit);
}

/** Owner reclaims free (unlocked) funds — exempt from pause, limits, and the whitelist. */
export async function adminWithdraw(
  t: Treasury,
  to: string,
  amountXlm: number,
): Promise<PayResult> {
  return sendTx(
    () => t.client.admin_withdraw({ to, amount: toStroops(amountXlm) }),
    "Withdraw failed.",
    t.submit,
  );
}

/** Update the spending limits, effective immediately (owner-signed). */
export async function setLimits(
  t: Treasury,
  dailyXlm: number,
  perTaskXlm: number,
): Promise<PayResult> {
  return sendTx(
    () =>
      t.client.set_limits({
        daily_limit: toStroops(dailyXlm),
        per_task_limit: toStroops(perTaskXlm),
      }),
    "Limit update failed.",
    t.submit,
  );
}

/** Register a session agent (owner-signed). While active it is the treasury's
 *  ONLY spender — time-bound, spend-capped, instantly revocable. */
export async function setSession(
  t: Treasury,
  agent: string,
  validUntil: bigint,
  capXlm: number,
): Promise<PayResult> {
  return sendTx(
    () => t.client.set_session({ agent, valid_until: validUntil, limit: toStroops(capXlm) }),
    "Session start failed.",
    t.submit,
  );
}

/** Instantly revoke the session (owner-signed) — spending falls back to the wallet. */
export async function revokeSession(t: Treasury): Promise<PayResult> {
  return sendTx(() => t.client.revoke_session(), "Session revoke failed.", t.submit);
}
