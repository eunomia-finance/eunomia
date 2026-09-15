// One payment, three verdicts, one vocabulary. Pre-flight catches what a simulation would
// only report as an auth failure (no credential, wrong Leash); the simulation is the
// contract running the policy against live state; the ledger is the final word. Whatever
// refuses, the agent gets the contract's own error code.
import { rpc } from "@stellar/stellar-sdk";
import type { Client } from "./bindings/treasury.js";
import { computeBudget, type Budget, type Reason } from "./budget.js";
import { contractCodeFromMessage, errText, reasonFromCode, reasonFromErrorName, reasonsFromDiagnostics } from "./errors.js";
import type { ServerContext } from "./server.js";
import { diagnosticsOf, makeSigningClient } from "./signer.js";
import { isPayee, makeClient, readTreasury } from "./treasury.js";

export interface PayArgs {
  to: string;
  /** stroops */
  amount: bigint;
  /** attribution id the treasury records this spend against (task_spent) */
  taskId: bigint;
}

export type PayOutcome =
  | { paid: true; txHash: string; ledger: number; to: string; amount: bigint; taskId: bigint }
  | {
      paid: false;
      stage: "preflight" | "simulation" | "submit" | "onchain";
      reasons: Reason[];
      blockers: string[];
      message: string;
      txHash?: string;
      ledger?: number;
      to: string;
      amount: bigint;
      taskId: bigint;
    };

export interface PayDeps {
  readClient?: Client;
  signingClient?: Client;
  now?: () => number;
}

export function requireTreasury(ctx: ServerContext): string {
  if (!ctx.treasuryId) {
    throw new Error("No treasury configured — set EUNOMIA_TREASURY or run `eunomia-mcp init --treasury <id>`.");
  }
  return ctx.treasuryId;
}

/** What the contract would say, computed off-chain: limit reasons from the budget
 *  arithmetic plus the whitelist answer. Blockers are the things no code can express. */
export async function preflightReasons(
  ctx: ServerContext,
  args: PayArgs,
  deps: PayDeps = {},
): Promise<{ reasons: Reason[]; blockers: string[]; budget: Budget }> {
  const treasuryId = requireTreasury(ctx);
  const client = deps.readClient ?? makeClient(ctx.net, treasuryId);
  const now = deps.now ?? ctx.now ?? (() => Math.floor(Date.now() / 1000));
  const [snap, allowedPayee] = await Promise.all([readTreasury(client, treasuryId), isPayee(client, args.to)]);
  const budget = computeBudget(snap, ctx.credential?.agentPublicKey ?? null, now(), args.amount);
  const reasons = [...(budget.decision?.reasons ?? [])];
  // With a reputation gate the contract may still admit an unlisted payee; only the
  // whitelist-only case is a certain refusal.
  if (!allowedPayee && !snap.reputationPolicy) reasons.push(reasonFromCode(2));
  return { reasons, blockers: budget.blockers, budget };
}

type Verdict = { isErr(): boolean; unwrapErr(): { message: string } };

export async function payFromTreasury(ctx: ServerContext, args: PayArgs, deps: PayDeps = {}): Promise<PayOutcome> {
  const treasuryId = requireTreasury(ctx);
  const base = { to: args.to, amount: args.amount, taskId: args.taskId };
  const pre = await preflightReasons(ctx, args, deps);
  if (pre.blockers.length > 0 || !ctx.credential) {
    return {
      paid: false,
      stage: "preflight",
      reasons: pre.reasons,
      blockers: pre.blockers,
      message: `Not attempted: ${pre.blockers.join(" ")}`,
      ...base,
    };
  }

  const client = deps.signingClient ?? makeSigningClient(ctx.net, treasuryId, ctx.credential);
  const tx = await client.pay({ task_id: args.taskId, to: args.to, amount: args.amount });

  // The contract ran inside the RPC's host: its Result is the policy verdict.
  let verdict: Verdict;
  try {
    verdict = tx.result as unknown as Verdict;
  } catch (e) {
    const code = contractCodeFromMessage(errText(e));
    return {
      paid: false,
      stage: "simulation",
      reasons: code ? [reasonFromCode(code)] : [],
      blockers: [],
      message: code
        ? "Refused by the treasury contract (simulation)."
        : `Simulation failed: ${errText(e).slice(0, 300)}`,
      ...base,
    };
  }
  if (verdict.isErr()) {
    const r = reasonFromErrorName(verdict.unwrapErr().message);
    return {
      paid: false,
      stage: "simulation",
      reasons: r ? [r] : [],
      blockers: [],
      message: "Refused by the treasury contract (simulation).",
      ...base,
    };
  }

  let sent: Awaited<ReturnType<typeof tx.signAndSend>>;
  try {
    sent = await tx.signAndSend();
  } catch (e) {
    return {
      paid: false,
      stage: "submit",
      reasons: [],
      blockers: [],
      message: `Submission failed: ${errText(e).slice(0, 300)}`,
      ...base,
    };
  }
  const txHash = sent.sendTransactionResponse?.hash ?? "";
  const resp = sent.getTransactionResponse as { status: string; ledger?: number } | undefined;
  const ledger = resp?.ledger ?? 0;
  if (resp?.status === rpc.Api.GetTransactionStatus.SUCCESS) return { paid: true, txHash, ledger, ...base };

  // Included but failed: state moved between simulation and apply (another spender, a
  // revoke). The ledger recorded the refusal; read the code out of it.
  return {
    paid: false,
    stage: "onchain",
    reasons: reasonsFromDiagnostics(diagnosticsOf(resp)),
    blockers: [],
    message: "Refused by the treasury contract on-chain.",
    txHash,
    ledger,
    ...base,
  };
}
