// Where the agent's key meets the chain. The Leash key is a plain Ed25519 account: it is
// the transaction source for autonomous payments (pays its own fee, satisfies
// `require_auth` as the invoker) and the owner of the account whose data entries carry
// exception requests. Nothing here holds the owner's key.
import { BASE_FEE, Keypair, TransactionBuilder, rpc, xdr } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Client } from "./bindings/treasury.js";
import type { Credential } from "./credential.js";
import type { NetworkConfig } from "./network.js";

export const agentKeypair = (cred: Credential): Keypair => Keypair.fromSecret(cred.agentSecret);

/** A treasury client whose transactions are sourced and signed by the agent key. */
export function makeSigningClient(net: NetworkConfig, contractId: string, cred: Credential): Client {
  const kp = agentKeypair(cred);
  const { signTransaction } = basicNodeSigner(kp, net.passphrase);
  return new Client({
    contractId,
    networkPassphrase: net.passphrase,
    rpcUrl: net.rpcUrl,
    publicKey: kp.publicKey(),
    signTransaction,
  });
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** getTransaction until the ledger has an answer. NOT_FOUND only means "not yet". */
export async function pollTransaction(
  server: rpc.Server,
  hash: string,
  opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<rpc.Api.GetTransactionResponse> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const sleep = opts.sleep ?? wait;
  const started = Date.now();
  for (;;) {
    const resp = await server.getTransaction(hash);
    if (resp.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) return resp;
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`transaction ${hash} not found after ${timeoutMs} ms — check it on the explorer`);
    }
    await sleep(intervalMs);
  }
}

/** Diagnostic events of a transaction response, whichever field the RPC version used
 *  (`diagnosticEventsXdr` top-level or under `events`), parsed if still base64. */
export function diagnosticsOf(resp: unknown): xdr.DiagnosticEvent[] {
  const r = resp as { diagnosticEventsXdr?: unknown[]; events?: { diagnosticEventsXdr?: unknown[] } };
  const list = r.diagnosticEventsXdr ?? r.events?.diagnosticEventsXdr ?? [];
  const out: xdr.DiagnosticEvent[] = [];
  for (const item of list) {
    try {
      out.push(typeof item === "string" ? xdr.DiagnosticEvent.fromXDR(item, "base64") : (item as xdr.DiagnosticEvent));
    } catch {
      /* an unparsable event cannot carry a verdict */
    }
  }
  return out;
}

export interface ClassicDeps {
  server?: rpc.Server;
  poll?: typeof pollTransaction;
}

/** Sign and submit classic operations from the agent account; resolve once the ledger
 *  answered. Used for the exception-request data entries. */
export async function submitClassic(
  net: NetworkConfig,
  kp: Keypair,
  ops: xdr.Operation[],
  deps: ClassicDeps = {},
): Promise<{ txHash: string; ledger: number; status: "SUCCESS" | "FAILED" }> {
  const server = deps.server ?? new rpc.Server(net.rpcUrl);
  const poll = deps.poll ?? pollTransaction;
  const account = await server.getAccount(kp.publicKey());
  const builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: net.passphrase });
  for (const op of ops) builder.addOperation(op);
  const tx = builder.setTimeout(60).build();
  tx.sign(kp);
  const sent = await server.sendTransaction(tx);
  if (sent.status !== "PENDING") {
    const detail = sent.errorResult ? sent.errorResult.result().switch().name : sent.status;
    throw new Error(`the network refused the transaction at submission: ${detail}`);
  }
  const final = await poll(server, sent.hash);
  return {
    txHash: sent.hash,
    ledger: (final as { ledger?: number }).ledger ?? 0,
    status: final.status === rpc.Api.GetTransactionStatus.SUCCESS ? "SUCCESS" : "FAILED",
  };
}
