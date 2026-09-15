// A refusal the simulation already delivered leaves no trace on the ledger. For evidence
// — "the contract, not the client, blocked it" — this submits the refused call anyway:
// a passing probe (same payee, 1 stroop) donates its footprint and resource fee, the
// refused arguments go in with the invoker auth entry the host expects, and the
// transaction lands as FAILED with the contract's error in its diagnostics. Costs the
// agent one fee. CLI-only (`pay --record-rejection`); never exposed as an MCP tool.
import { Address, BASE_FEE, Contract, Operation, TransactionBuilder, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import type { Client } from "./bindings/treasury.js";
import type { Reason } from "./budget.js";
import { reasonsFromDiagnostics } from "./errors.js";
import { requireTreasury, type PayArgs } from "./pay.js";
import type { ServerContext } from "./server.js";
import { agentKeypair, diagnosticsOf, makeSigningClient, pollTransaction } from "./signer.js";

export const payArgs = (a: PayArgs): xdr.ScVal[] => [
  nativeToScVal(a.taskId, { type: "u64" }),
  new Address(a.to).toScVal(),
  nativeToScVal(a.amount, { type: "i128" }),
];

/** The auth entry a transaction source account carries for its own `require_auth`. */
export function sourceAccountAuth(contractId: string, fn: string, args: xdr.ScVal[]): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: new Address(contractId).toScAddress(), functionName: fn, args }),
      ),
      subInvocations: [],
    }),
  });
}

export interface RecordedRejection {
  txHash: string;
  ledger: number;
  status: "SUCCESS" | "FAILED";
  reasons: Reason[];
}

export async function recordRejectionOnChain(
  ctx: ServerContext,
  args: PayArgs,
  deps: { server?: rpc.Server; signingClient?: Client; poll?: typeof pollTransaction } = {},
): Promise<RecordedRejection> {
  const treasuryId = requireTreasury(ctx);
  if (!ctx.credential) throw new Error("No agent credential — run `eunomia-mcp init` first.");
  const kp = agentKeypair(ctx.credential);
  const server = deps.server ?? new rpc.Server(ctx.net.rpcUrl);
  const client = deps.signingClient ?? makeSigningClient(ctx.net, treasuryId, ctx.credential);

  // 1. Probe: the smallest payment to the same payee. Its footprint covers everything the
  //    refused call reads before it bails, and its fee is an upper bound.
  const probe = await client.pay({ task_id: args.taskId, to: args.to, amount: 1n });
  const sim = probe.simulation;
  if (!sim || rpc.Api.isSimulationError(sim)) {
    const why = sim && "error" in sim ? sim.error : "no simulation";
    throw new Error(`probe simulation failed — the refusal cannot be recorded for this payee: ${why}`);
  }
  const txData = probe.simulationData.transactionData;
  const fee = (BigInt(sim.minResourceFee) + BigInt(BASE_FEE)).toString();

  // 2. The refused call, with the invoker auth entry bound to its real arguments.
  const fnArgs = payArgs(args);
  const hostFn = new Contract(treasuryId).call("pay", ...fnArgs).body().invokeHostFunctionOp().hostFunction();
  const op = Operation.invokeHostFunction({ func: hostFn, auth: [sourceAccountAuth(treasuryId, "pay", fnArgs)] });
  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee, networkPassphrase: ctx.net.passphrase })
    .addOperation(op)
    .setSorobanData(txData)
    .setTimeout(60)
    .build();
  tx.sign(kp);
  const sent = await server.sendTransaction(tx);
  if (sent.status !== "PENDING") {
    const detail = sent.errorResult ? sent.errorResult.result().switch().name : sent.status;
    throw new Error(`the network refused the transaction at submission: ${detail}`);
  }
  const final = await (deps.poll ?? pollTransaction)(server, sent.hash);
  const status = final.status === rpc.Api.GetTransactionStatus.SUCCESS ? "SUCCESS" : "FAILED";
  return {
    txHash: sent.hash,
    ledger: (final as { ledger?: number }).ledger ?? 0,
    status,
    reasons: reasonsFromDiagnostics(diagnosticsOf(final)),
  };
}
