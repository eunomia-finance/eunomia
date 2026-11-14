// Submitting a passkey-signed host function on the user's behalf.
//
// This used to go to OpenZeppelin Channels. It cannot any more: passkey-kit signs with
// CAP-0071-02 address-bound credentials (`sorobanCredentialsAddressV2`, Protocol 27) and the
// Channels plugin runs @stellar/stellar-sdk 14.6.1, which rejects that credential type while
// parsing — "unknown SorobanCredentialsType member for value 2". Measured directly against
// both SDKs; the network itself is on Protocol 27, so the chain is not the laggard here. Until
// Channels catches up, every passkey-signed call has to be submitted by us.
//
// What this does NOT change: authorisation. The auth entries are signed by the user's passkey
// and bound to their smart wallet's address, so whoever sources the transaction has no say
// over what it may do. The fee account pays the fee and nothing else — no custody, and the
// admission gate in the caller still decides what is allowed through at all.
import {
  Account,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

/** The RPC surface this needs, narrowed so it unit-tests without a network. */
export interface SubmittingServer {
  getAccount(address: string): Promise<{ sequenceNumber(): string }>;
  simulateTransaction(tx: unknown): Promise<{
    error?: string;
    restorePreamble?: { transactionData?: unknown };
    transactionData?: { build(): xdr.SorobanTransactionData };
  }>;
  sendTransaction(tx: unknown): Promise<{ hash: string; status: string; errorResult?: unknown }>;
  getTransaction(hash: string): Promise<{ status: string }>;
}

export interface SubmitDeps {
  server: SubmittingServer;
  keypair: Keypair;
  networkPassphrase: string;
  /** How many times to ask whether the transaction made it into a ledger. */
  pollAttempts?: number;
  wait?: (ms: number) => Promise<void>;
  /** Called once with the most the transaction may cost, before anything is sent; throws to
   *  stop it. The caller's spending limits live here, so nothing is sent unpriced. It may
   *  hand back a way to undo the charge, called when the network refuses to take the
   *  transaction in: no fee is collected for one that never entered a ledger. */
  charge?: (stroops: bigint) => Promise<void | Release>;
}

/** Gives a charge back. */
export type Release = () => Promise<void>;

export class RelaySubmitError extends Error {}

/** Sends under the fee account's sequence before giving up on a race with another request. */
const SEQUENCE_ATTEMPTS = 3;

/** Whether a rejection is the fee account's sequence having moved under us: two requests
 *  read the same sequence and only the first to land can use it. Nothing ran and no fee was
 *  taken, so the transaction is rebuilt on the new sequence and sent again. */
function isBadSequence(errorResult: unknown): boolean {
  try {
    return (errorResult as xdr.TransactionResult).result().switch().name === "txBadSeq";
  } catch {
    return false;
  }
}

/** Inclusion fee in stroops (0.01 XLM). The network floor loses the moment there is a queue. */
const INCLUSION_FEE = "100000";

/** Simulation prices the resources against ledger state that has usually moved on by the time
 *  the transaction lands — a deploy came back `txInsufficientFee` on an estimate that was
 *  right when it was made. A margin costs a fraction of a cent and is refunded when unused:
 *  Soroban charges what the execution actually consumed, not what was offered. */
function padResourceFee(data: xdr.SorobanTransactionData): xdr.SorobanTransactionData {
  const quoted = BigInt(data.resourceFee().toString());
  data.resourceFee(xdr.Int64.fromString(((quoted * 130n) / 100n).toString()));
  return data;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Build, sign and submit `func` with the caller's already-signed `auth` entries.
 *
 *  The auth entries are passed through untouched. Simulation is only asked for the footprint
 *  and resource fee — its own auth output is discarded, because replacing signed entries with
 *  freshly recorded ones would throw the user's signature away. */
export async function submitHostFunction(
  deps: SubmitDeps,
  func: xdr.HostFunction,
  auth: xdr.SorobanAuthorizationEntry[],
): Promise<{ hash: string; status: string }> {
  const address = deps.keypair.publicKey();
  let sequence = (await deps.server.getAccount(address)).sequenceNumber();

  const build = (sorobanData?: xdr.SorobanTransactionData) =>
    new TransactionBuilder(new Account(address, sequence), {
      // Inclusion fee, on top of whatever the resources cost. BASE_FEE is the network floor
      // and gets outbid the moment the network has any queue at all — a deploy came back
      // txInsufficientFee against it. This is still a fraction of a cent.
      fee: INCLUSION_FEE,
      networkPassphrase: deps.networkPassphrase,
      ...(sorobanData ? { sorobanData } : {}),
    })
      .addOperation(Operation.invokeHostFunction({ func, auth }))
      .setTimeout(120)
      .build();

  // A fresh Account is built for each pass: TransactionBuilder.build() advances the sequence
  // it is handed, so reusing one would submit under a number the network has not reached.
  const sim = await deps.server.simulateTransaction(build());
  if (sim.error) throw new RelaySubmitError(`simulation failed: ${sim.error}`);
  if (sim.restorePreamble?.transactionData) {
    throw new RelaySubmitError("the contract's state is archived and needs restoring first");
  }
  if (!sim.transactionData) throw new RelaySubmitError("simulation returned no footprint");

  // Deliberately not rpc.assembleTransaction: it adds minResourceFee to the base fee, and
  // since stellar-base 14.1.0 build() adds the resource fee again — the fee comes out double.
  // Handing sorobanData to the builder counts it exactly once.
  const data = padResourceFee(sim.transactionData.build());
  let tx = build(data);
  const release = await deps.charge?.(BigInt(tx.fee));

  for (let attempt = 1; ; attempt++) {
    tx.sign(deps.keypair);
    const sent = await deps.server.sendTransaction(tx);
    if (sent.status === "ERROR" && isBadSequence(sent.errorResult) && attempt < SEQUENCE_ATTEMPTS) {
      sequence = (await deps.server.getAccount(address)).sequenceNumber();
      tx = build(data);
      continue;
    }
    await assertAccepted(sent, release);
    return { hash: sent.hash, status: await settle(deps, sent.hash, sent.status) };
  }
}

/** Submit an already-signed transaction envelope — passkey-kit's smart-wallet deployment,
 *  which arrives complete because the kit's own deployer signed it.
 *
 *  It arrives with the kit's own inclusion fee, which we cannot influence and which the
 *  network outbid: wallet creation came back `txInsufficientFee` while the treasury deploy
 *  beside it succeeded. Re-signing is not an option — that would break the kit's signature —
 *  so it goes out wrapped in a fee bump, which raises the fee from the outside and leaves the
 *  inner transaction byte-for-byte intact. */
export async function submitEnvelope(
  deps: SubmitDeps,
  envelopeXdr: string,
): Promise<{ hash: string; status: string }> {
  const inner = TransactionBuilder.fromXDR(envelopeXdr, deps.networkPassphrase);
  const tx = TransactionBuilder.buildFeeBumpTransaction(
    deps.keypair,
    INCLUSION_FEE,
    inner as Transaction,
    deps.networkPassphrase,
  );
  // A fee bump has no sequence of its own (it rides on the inner transaction's), so it cannot
  // race other requests; it is priced like everything else.
  const release = await deps.charge?.(BigInt(tx.fee));
  tx.sign(deps.keypair);

  const sent = await deps.server.sendTransaction(tx);
  await assertAccepted(sent, release);
  return { hash: sent.hash, status: await settle(deps, sent.hash, sent.status) };
}

/** A send the network did not take in. ERROR is a rejection; TRY_AGAIN_LATER means it was
 *  never queued, so polling its hash can only ever come back NOT_FOUND — which the caller
 *  would otherwise receive as a 200.
 *
 *  Either way the transaction never entered a ledger and no fee was collected, so its charge
 *  is given back. Nothing else is: once the network has taken a transaction in, it may cost
 *  its whole bid whether it succeeds or fails, and a send that threw leaves that unknown. */
async function assertAccepted(sent: { status: string; errorResult?: unknown }, release?: Release | void): Promise<void> {
  if (sent.status !== "ERROR" && sent.status !== "TRY_AGAIN_LATER") return;
  await release?.();
  if (sent.status === "ERROR") {
    throw new RelaySubmitError(
      `the network rejected the transaction: ${JSON.stringify(sent.errorResult ?? {})}`,
    );
  }
  throw new RelaySubmitError("the network is busy and did not accept the transaction");
}

/** Wait briefly for a verdict. A transaction that is still pending is reported as such rather
 *  than called a success — the caller shows the user a treasury either way, and claiming one
 *  exists before the ledger agrees is how a failed deploy looks like a working one. */
async function settle(deps: SubmitDeps, hash: string, status: string): Promise<string> {
  const attempts = deps.pollAttempts ?? 8;
  const wait = deps.wait ?? sleep;

  let seen = status;
  for (let i = 0; i < attempts; i++) {
    await wait(1000);
    const { status: current } = await deps.server.getTransaction(hash);
    seen = current;
    if (current !== "NOT_FOUND" && current !== "PENDING") break;
  }

  if (seen === "FAILED") throw new RelaySubmitError("the transaction failed on chain");
  return seen;
}
