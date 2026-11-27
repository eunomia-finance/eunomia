// The task float: money the treasury hands the agent's own account so it can pay where the
// treasury itself cannot be the payer. Stellar's x402 and MPP facilitators settle from a
// G… account only today (stellar/stellar-mpp-sdk#90, x402-foundation/x402#3158) — a contract
// treasury is refused before its policy is ever consulted.
//
// A float leaves the contract's protection the moment it moves, so it is bounded three ways:
// the top-up is an ordinary treasury pay() (every on-chain limit applies), the owner can put
// a monthly payee cap on the agent's own address, and sweep_float returns what a task did
// not spend. call.ts adds the per-call checks before anything is signed.
import { Account, Address, BASE_FEE, Contract, Operation, TransactionBuilder, nativeToScVal, rpc, scValToNative } from "@stellar/stellar-sdk";
import { NULL_ACCOUNT } from "@stellar/stellar-sdk/contract";
import type { NetworkConfig } from "./network.js";
import { payFromTreasury, requireTreasury, type PayDeps, type PayOutcome } from "./pay.js";
import type { ServerContext } from "./server.js";
import { lacksTrustline, readTokenAsset } from "./receiver.js";
import { agentKeypair, INCLUSION_FEE, pollTransaction, submitClassic } from "./signer.js";
import { makeClient } from "./treasury.js";

/** A holder's balance of a token contract (SEP-41 `balance`), by simulation — no key, no fee. */
export async function tokenBalance(
  net: NetworkConfig,
  tokenId: string,
  holder: string,
  server = new rpc.Server(net.rpcUrl),
): Promise<bigint> {
  const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), { fee: BASE_FEE, networkPassphrase: net.passphrase })
    .addOperation(new Contract(tokenId).call("balance", new Address(holder).toScVal()))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  // A G… account with no trustline answers with an error rather than 0: it holds none.
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) return 0n;
  return BigInt(scValToNative(sim.result.retval) as bigint);
}

export async function treasuryToken(ctx: ServerContext): Promise<string> {
  const id = requireTreasury(ctx);
  return (await makeClient(ctx.net, id).get_config()).result.token;
}

/** Top the float up from the treasury: an ordinary pay() to the agent's own address, so the
 *  treasury's limits, the agent's payee cap and the task budget all apply on-chain. */
export async function fundFloat(
  ctx: ServerContext,
  amount: bigint,
  taskId: bigint,
  deps: PayDeps = {},
): Promise<PayOutcome> {
  if (!ctx.credential) throw new Error("No agent credential — run `eunomia-mcp init` first.");
  return payFromTreasury(ctx, { to: ctx.credential.agentPublicKey, amount, taskId }, deps);
}

export interface SweepResult {
  swept: bigint;
  txHash: string | null;
  ledger: number;
  status: "SUCCESS" | "FAILED" | "NOTHING";
}

/** Return float to the treasury: a token transfer from the agent's account, signed by the
 *  agent. `amount` defaults to everything the account holds of the treasury's token. */
export async function sweepFloat(
  ctx: ServerContext,
  amount?: bigint,
  deps: { server?: rpc.Server; poll?: typeof pollTransaction } = {},
): Promise<SweepResult> {
  const treasury = requireTreasury(ctx);
  if (!ctx.credential) throw new Error("No agent credential — run `eunomia-mcp init` first.");
  const server = deps.server ?? new rpc.Server(ctx.net.rpcUrl);
  const kp = agentKeypair(ctx.credential);
  const token = await treasuryToken(ctx);
  const held = await tokenBalance(ctx.net, token, kp.publicKey(), server);
  // On an XLM treasury the float sits in the same balance as the account's own XLM (its
  // reserve and fee money), so "everything" would empty the account. Name the amount there.
  if (amount === undefined && (await readTokenAsset(ctx.net, token, server))?.isNative()) {
    throw new Error("this treasury holds XLM, which the agent's account also lives on — give the amount to return");
  }
  const swept = amount ?? held;
  if (swept <= 0n) return { swept: 0n, txHash: null, ledger: 0, status: "NOTHING" };
  if (swept > held) throw new Error(`the float holds ${held} stroops, less than the ${swept} asked to sweep`);

  const account = await server.getAccount(kp.publicKey());
  const built = new TransactionBuilder(account, { fee: INCLUSION_FEE, networkPassphrase: ctx.net.passphrase })
    .addOperation(
      new Contract(token).call(
        "transfer",
        new Address(kp.publicKey()).toScVal(),
        new Address(treasury).toScVal(),
        nativeToScVal(swept, { type: "i128" }),
      ),
    )
    .setTimeout(60)
    .build();
  // The agent is both source and `from`: source-account auth covers the transfer.
  const tx = await server.prepareTransaction(built);
  tx.sign(kp);
  const sent = await server.sendTransaction(tx);
  if (sent.status !== "PENDING") {
    const detail = sent.errorResult ? sent.errorResult.result().switch().name : sent.status;
    throw new Error(`the network refused the sweep at submission: ${detail}`);
  }
  const final = await (deps.poll ?? pollTransaction)(server, sent.hash);
  return {
    swept,
    txHash: sent.hash,
    ledger: (final as { ledger?: number }).ledger ?? 0,
    status: final.status === rpc.Api.GetTransactionStatus.SUCCESS ? "SUCCESS" : "FAILED",
  };
}

/** What a missing agent account looks like to the RPC, whichever way it words it. */
export const isMissingAccount = (e: unknown): boolean => {
  const o = e as { code?: number; message?: string; response?: { status?: number } };
  return o?.code === 404 || o?.response?.status === 404 || /not found/i.test(o?.message ?? "");
};

/** Make sure the agent's account can hold the treasury's token before a float is funded, so
 *  the owner never has to run a second command for it. The trustline is the agent's own to
 *  add: it costs the account 0.5 XLM of reserve and trusts only the treasury token's issuer.
 *  An account that does not exist yet cannot add one — that is said in the owner's terms. */
export async function ensureFloatTrustline(
  ctx: ServerContext,
  add: typeof addTrustline = addTrustline,
): Promise<{ added: boolean; txHash: string | null }> {
  if (!ctx.credential) throw new Error("No agent credential — run `eunomia-mcp init` first.");
  let r: Awaited<ReturnType<typeof addTrustline>>;
  try {
    r = await add(ctx);
  } catch (e) {
    if (isMissingAccount(e)) {
      throw new Error(
        `the agent's account ${ctx.credential.agentPublicKey} does not exist on Stellar yet — it needs about 3 XLM. The owner sends it from the Agent page (Connect agent) or from any wallet; nothing else is needed after that`,
      );
    }
    throw e;
  }
  if (r.status === "FAILED") {
    throw new Error(
      `the agent's account could not add the ${r.asset} trustline — it needs about 1 XLM more than it holds (0.5 XLM of reserve plus fees)`,
    );
  }
  return { added: r.status === "SUCCESS", txHash: r.txHash };
}

/** Let the agent's account hold the treasury's token: a classic trustline, needed once on
 *  mainnet before a USDC float can be funded (a G… account holds an issued asset only once
 *  it trusts the issuer). Signed by the agent; the account must already hold XLM for the
 *  reserve. Nothing to do for the native asset. */
export async function addTrustline(
  ctx: ServerContext,
  deps: { server?: rpc.Server } = {},
): Promise<{ asset: string; txHash: string | null; status: "SUCCESS" | "FAILED" | "NOT_NEEDED" }> {
  if (!ctx.credential) throw new Error("No agent credential — run `eunomia-mcp init` first.");
  const server = deps.server ?? new rpc.Server(ctx.net.rpcUrl);
  const token = await treasuryToken(ctx);
  const asset = await readTokenAsset(ctx.net, token, server);
  if (!asset || asset.isNative()) return { asset: asset ? "XLM" : token, txHash: null, status: "NOT_NEEDED" };
  const kp = agentKeypair(ctx.credential);
  if (!(await lacksTrustline(ctx.net, token, kp.publicKey(), server))) {
    return { asset: `${asset.getCode()}:${asset.getIssuer()}`, txHash: null, status: "NOT_NEEDED" };
  }
  const r = await submitClassic(ctx.net, kp, [Operation.changeTrust({ asset })], { server });
  return { asset: `${asset.getCode()}:${asset.getIssuer()}`, txHash: r.txHash, status: r.status };
}
