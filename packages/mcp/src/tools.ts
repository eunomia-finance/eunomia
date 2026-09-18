// The MCP tools. Reads (check_budget, list_allowed_payees, check_payee) hit the chain
// fresh on every call — an agent asking "may I spend?" must never be answered from a
// stale snapshot. Writes (pay, request_exception, check_exception) are signed by the
// agent's Leash key on this machine. Every tool returns the same JSON as text (for
// clients that only render text) and as structuredContent.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { computeBudget, type Budget } from "./budget.js";
import { errText, reasonFromCode } from "./errors.js";
import { closeException, readExceptionEntry, submitException } from "./exception.js";
import { EXCEPTION_PREFIX, exceptionIdOf } from "./exceptionCodec.js";
import { contractUrl, fromStroops, toStroops, txUrl, type NetworkName } from "./format.js";
import { payFromTreasury, preflightReasons, type PayOutcome } from "./pay.js";
import { listAllowedPayees } from "./payees.js";
import type { ServerContext } from "./server.js";
import { isPayee, makeClient, readTreasury } from "./treasury.js";
import { treasuryUnit } from "./unit.js";
import { checkRequirement, type PaymentRequirements } from "./x402.js";

const amt = (v: bigint) => fromStroops(v);

/** Budget → transport-safe JSON: every bigint becomes a decimal string in the token's
 *  units, with the raw stroops kept alongside where an agent would compute with them.
 *  `unit` names that token ("USDC", "XLM"); null when the chain could not be asked. */
export function serializeBudget(b: Budget, net: NetworkName, unit: string | null = null): Record<string, unknown> {
  return {
    treasury: b.contractId,
    token: b.token,
    unit,
    paused: b.paused,
    perPaymentCap: amt(b.perPaymentCap),
    perPaymentCapStroops: b.perPaymentCap.toString(),
    dailyLimit: amt(b.dailyLimit),
    daySpent: amt(b.daySpent),
    dailyRemaining: amt(b.dailyRemaining),
    freeBalance: amt(b.freeBalance),
    session: b.session && {
      agent: b.session.agent,
      isThisAgent: b.session.isThisAgent,
      active: b.session.active,
      validUntil: new Date(b.session.validUntil * 1000).toISOString(),
      expiresInSec: b.session.expiresInSec,
      cap: amt(b.session.cap),
      spent: amt(b.session.spent),
      remaining: amt(b.session.remaining),
    },
    canSpend: b.canSpend,
    spendableNow: amt(b.spendableNow),
    spendableNowStroops: b.spendableNow.toString(),
    blockers: b.blockers,
    reputationPolicy: b.reputationPolicy && {
      registry: b.reputationPolicy.registry,
      minReputation: b.reputationPolicy.minReputation.toString(),
    },
    decision: b.decision && {
      amount: amt(b.decision.amount),
      allowed: b.decision.allowed,
      reasons: b.decision.reasons,
    },
    links: { contract: contractUrl(net, b.contractId) },
    note: `Every amount here is a decimal string${unit ? ` in ${unit}` : " in the treasury's token"}. Numbers are pre-flight reads; the treasury contract enforces the same rules on-chain at payment time.`,
  };
}

/** What the owner can do about each contract error code, in dashboard terms. */
const OWNER_ACTION: Record<number, string> = {
  2: "Approve payee — Dashboard → Payments → approve this address (add_payee).",
  3: "Raise the per-payment limit — Dashboard → Settings → limits (set_limits).",
  4: "Raise the daily limit or wait for spend to roll off — Dashboard → Settings → limits.",
  5: "Approve the payee explicitly — the reputation gate did not admit it.",
  6: "Fund the treasury — Dashboard → Overview → fund.",
  9: "Resume the treasury — Dashboard → Settings → pause toggle.",
  10: "Start a bigger Leash — Dashboard → Agent → revoke, then authorise this key with a higher cap.",
};
export const ownerActionsFor = (codes: number[]): string[] =>
  codes.map((c) => OWNER_ACTION[c] ?? `Resolve contract error #${c}.`);

/** PayOutcome → transport-safe JSON with the explorer link and the agent's next step. */
export function serializeOutcome(o: PayOutcome, net: NetworkName, unit: string | null = null): Record<string, unknown> {
  const base = { paid: o.paid, to: o.to, amount: amt(o.amount), unit, amountStroops: o.amount.toString(), taskId: o.taskId.toString() };
  if (o.paid) return { ...base, txHash: o.txHash, ledger: o.ledger, links: { tx: txUrl(net, o.txHash) } };
  const policyRefusal = o.reasons.length > 0;
  return {
    ...base,
    stage: o.stage,
    reasons: o.reasons,
    blockers: o.blockers,
    message: o.message,
    ...(o.txHash ? { txHash: o.txHash, ledger: o.ledger, links: { tx: txUrl(net, o.txHash) } } : { links: {} }),
    nextStep: policyRefusal ? "request_exception" : o.blockers.length > 0 ? "wait for the owner (see blockers)" : "retry later",
    ...(policyRefusal && {
      note: "This refusal is the treasury's policy working — the same rule the contract enforces on-chain.",
    }),
  };
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const ok = (v: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(v, null, 2) }],
  structuredContent: v,
});
const fail = (msg: string): ToolResult => ({ isError: true, content: [{ type: "text", text: msg }] });

const NO_TREASURY =
  "No treasury configured. Set EUNOMIA_TREASURY to the treasury's contract id (C…) or run `eunomia-mcp init --treasury <id>`.";
const NO_CREDENTIAL = "No agent credential — run `eunomia-mcp init --treasury <id>` first.";

const x402Schema = z
  .object({
    scheme: z.string(),
    network: z.string(),
    amount: z.string(),
    asset: z.string(),
    payTo: z.string(),
    maxTimeoutSeconds: z.number().optional(),
    extra: z.record(z.unknown()).optional(),
  })
  .passthrough();

export function registerTools(server: McpServer, ctx: ServerContext): void {
  const now = ctx.now ?? (() => Math.floor(Date.now() / 1000));

  server.registerTool(
    "check_budget",
    {
      title: "Check budget",
      description:
        "What this agent may spend from its Eunomia treasury right now: per-payment cap, rolling 24h limit, Leash session cap and expiry, pause state, free balance — all in the treasury's token, named in `unit` (e.g. \"USDC\"). Pass `amount` (e.g. \"2.5\") to pre-flight a specific payment and get the contract's rejection reasons before paying.",
      inputSchema: {
        amount: z.string().optional().describe('Amount in the treasury\'s token (7 decimals), e.g. "2.5"'),
      },
    },
    async ({ amount }) => {
      if (!ctx.treasuryId) return fail(NO_TREASURY);
      try {
        const client = makeClient(ctx.net, ctx.treasuryId);
        const snap = await readTreasury(client, ctx.treasuryId);
        const budget = computeBudget(
          snap,
          ctx.credential?.agentPublicKey ?? null,
          now(),
          amount !== undefined ? toStroops(amount) : undefined,
        );
        const unit = await treasuryUnit(ctx.net, ctx.treasuryId, snap.config.token);
        return ok({ agentPublicKey: ctx.credential?.agentPublicKey ?? null, ...serializeBudget(budget, ctx.net.name, unit) });
      } catch (e) {
        return fail(`check_budget failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    "list_allowed_payees",
    {
      title: "List allowed payees",
      description:
        "Addresses this treasury will pay: the owner-approved whitelist (each address re-verified on-chain) plus the reputation gate if one is set. Anything not allowed is refused by the contract, not by this server.",
      inputSchema: {},
    },
    async () => {
      if (!ctx.treasuryId) return fail(NO_TREASURY);
      try {
        const client = makeClient(ctx.net, ctx.treasuryId);
        const snap = await readTreasury(client, ctx.treasuryId);
        const listing = await listAllowedPayees(ctx.net, client, ctx.treasuryId, ctx.cache, snap.reputationPolicy);
        return ok({
          treasury: ctx.treasuryId,
          payees: listing.payees,
          reputationPolicy: listing.reputationPolicy && {
            registry: listing.reputationPolicy.registry,
            minReputation: listing.reputationPolicy.minReputation.toString(),
          },
          coverage: listing.coverage,
          links: { contract: contractUrl(ctx.net.name, ctx.treasuryId) },
        });
      } catch (e) {
        return fail(`list_allowed_payees failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    "check_payee",
    {
      title: "Check a payee",
      description:
        'Exact on-chain answer to "will the treasury pay this address?" (is_payee). Use it before paying anyone not returned by list_allowed_payees.',
      inputSchema: { address: z.string().describe("Stellar G… or C… address") },
    },
    async ({ address }) => {
      if (!ctx.treasuryId) return fail(NO_TREASURY);
      try {
        const client = makeClient(ctx.net, ctx.treasuryId);
        const [allowed, snap] = await Promise.all([isPayee(client, address), readTreasury(client, ctx.treasuryId)]);
        return ok({
          treasury: ctx.treasuryId,
          address,
          allowed,
          via: allowed ? "whitelist" : "none",
          reputationPolicy: snap.reputationPolicy && {
            registry: snap.reputationPolicy.registry,
            minReputation: snap.reputationPolicy.minReputation.toString(),
          },
          note: allowed
            ? "The contract will accept payments to this address, subject to the limits in check_budget."
            : "Not whitelisted. If a reputation gate is set, the contract may still pay it when its score meets the threshold; otherwise a payment will be refused on-chain (PayeeNotWhitelisted).",
        });
      } catch (e) {
        return fail(`check_payee failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    "pay",
    {
      title: "Pay from the treasury",
      description:
        'Pay a payee from the Eunomia treasury with this agent\'s Leash key. Give `to` + `amount` (treasury token, e.g. "2.5"), or pass an x402 payment option (`x402` = one element of a 402 response\'s `accepts[]`: scheme "exact", this network, the treasury\'s asset) and it is settled through the treasury\'s on-chain pay(). Refusals come back with the contract\'s own error codes — they are policy, not failures; call request_exception to ask the owner.',
      inputSchema: {
        to: z.string().optional().describe("Payee address (G… or C…)"),
        amount: z.string().optional().describe('Amount in the treasury\'s token (the `unit` check_budget reports), e.g. "2.5"'),
        taskId: z.number().int().nonnegative().optional().describe("Attribution id recorded on-chain (task_spent); default 0"),
        x402: x402Schema
          .optional()
          .describe("An x402 v2 payment requirement (from PAYMENT-REQUIRED / accepts[]) to settle via the treasury"),
      },
    },
    async ({ to, amount, taskId, x402 }) => {
      if (!ctx.treasuryId) return fail(NO_TREASURY);
      try {
        let target: string;
        let stroops: bigint;
        if (x402) {
          const snap = await readTreasury(makeClient(ctx.net, ctx.treasuryId), ctx.treasuryId);
          const problems = checkRequirement(x402 as PaymentRequirements, ctx.net.name, snap.config.token);
          if (problems.length > 0) {
            return ok({
              paid: false,
              stage: "preflight",
              reasons: [],
              blockers: problems,
              message: "This x402 option cannot be settled by this treasury.",
              x402,
            });
          }
          target = x402.payTo;
          stroops = BigInt(x402.amount);
        } else {
          if (!to || amount === undefined) return fail("Give `to` and `amount`, or an `x402` payment requirement.");
          target = to;
          stroops = toStroops(amount);
        }
        const outcome = await payFromTreasury(ctx, { to: target, amount: stroops, taskId: BigInt(taskId ?? 0) }, { now });
        // A request the owner just honoured is done: clear it so the dashboard stays clean.
        const closed: Array<{ id: string; txHash: string }> = [];
        if (outcome.paid) {
          const keep = [];
          for (const r of ctx.exceptions.load(ctx.treasuryId)) {
            if (r.to !== target || r.amount !== stroops.toString()) {
              keep.push(r);
              continue;
            }
            try {
              closed.push({ id: r.id, txHash: (await closeException(ctx, EXCEPTION_PREFIX + r.id)).txHash });
            } catch {
              keep.push(r);
            }
          }
          if (closed.length > 0) ctx.exceptions.save(ctx.treasuryId, keep);
        }
        return ok({
          agentPublicKey: ctx.credential?.agentPublicKey ?? null,
          ...serializeOutcome(outcome, ctx.net.name, await treasuryUnit(ctx.net, ctx.treasuryId)),
          closedExceptions: closed,
        });
      } catch (e) {
        return fail(`pay failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    "request_exception",
    {
      title: "Request an exception",
      description:
        "Ask the treasury owner to allow a payment the policy refuses (unapproved payee, over a limit). The request is written to this agent's own Stellar account as a data entry the owner's dashboard shows; the owner resolves it with an on-chain action (approve payee, raise limits, new Leash). Poll check_exception, then pay.",
      inputSchema: {
        to: z.string().describe("Payee address (G… or C…)"),
        amount: z.string().describe('Amount in the treasury\'s token, e.g. "15"'),
        taskId: z.number().int().nonnegative().optional(),
      },
    },
    async ({ to, amount, taskId }) => {
      if (!ctx.treasuryId) return fail(NO_TREASURY);
      try {
        const stroops = toStroops(amount);
        const task = BigInt(taskId ?? 0);
        const pre = await preflightReasons(ctx, { to, amount: stroops, taskId: task }, { now });
        if (!ctx.credential || pre.blockers.length > 0) {
          return ok({ requested: false, allowed: false, blockers: pre.blockers, message: "Not filed: no usable Leash for this agent." });
        }
        if (pre.reasons.length === 0) {
          return ok({ requested: false, allowed: true, message: "This payment is inside the policy — call pay." });
        }
        const requestedAt = now();
        const codes = pre.reasons.map((r) => r.code);
        const filed = await submitException(ctx, { payee: to, amount: stroops, taskId: task, reasonCodes: codes, requestedAt });
        const records = ctx.exceptions.load(ctx.treasuryId);
        records.push({ id: filed.id, to, amount: stroops.toString(), taskId: task.toString(), reasonCodes: codes, requestedAt, txHash: filed.txHash });
        ctx.exceptions.save(ctx.treasuryId, records);
        return ok({
          requested: true,
          id: filed.id,
          txHash: filed.txHash,
          ledger: filed.ledger,
          to,
          amount: amt(stroops),
          unit: await treasuryUnit(ctx.net, ctx.treasuryId, pre.budget.token),
          amountStroops: stroops.toString(),
          taskId: task.toString(),
          reasons: pre.reasons,
          status: "pending",
          ownerActions: ownerActionsFor(codes),
          howOwnerSeesIt:
            "Eunomia dashboard → treasury → Agent → 'Exception requests' (read from this agent's account on-chain).",
          checkWith: "check_exception",
          links: { tx: txUrl(ctx.net.name, filed.txHash) },
        });
      } catch (e) {
        return fail(`request_exception failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    "check_exception",
    {
      title: "Check an exception request",
      description:
        "Status of a request filed with request_exception: `approved` when the treasury would now accept that payment (call pay), `pending` otherwise, `closed` when the entry is gone. `close: true` removes the entry (after paying, or to withdraw the request).",
      inputSchema: { id: z.string().describe("The id request_exception returned"), close: z.boolean().optional() },
    },
    async ({ id, close }) => {
      if (!ctx.treasuryId) return fail(NO_TREASURY);
      if (!ctx.credential) return fail(NO_CREDENTIAL);
      try {
        const name = id.startsWith(EXCEPTION_PREFIX) ? id : EXCEPTION_PREFIX + id;
        const shortId = exceptionIdOf(name);
        const entry = await readExceptionEntry(ctx.net, ctx.credential.agentPublicKey, name);
        if (!entry) return ok({ id: shortId, found: false, status: "closed", nextStep: "file a new request if still needed" });
        const pre = await preflightReasons(ctx, { to: entry.payee, amount: entry.amount, taskId: entry.taskId }, { now });
        const approved = pre.blockers.length === 0 && pre.reasons.length === 0;
        let closedTx: string | undefined;
        if (close) {
          closedTx = (await closeException(ctx, name)).txHash;
          ctx.exceptions.save(ctx.treasuryId, ctx.exceptions.load(ctx.treasuryId).filter((r) => r.id !== shortId));
        }
        return ok({
          id: shortId,
          found: true,
          status: close ? "closed" : approved ? "approved" : "pending",
          request: {
            to: entry.payee,
            amount: amt(entry.amount),
            unit: await treasuryUnit(ctx.net, ctx.treasuryId, pre.budget.token),
            amountStroops: entry.amount.toString(),
            taskId: entry.taskId.toString(),
            requestedAt: new Date(entry.requestedAt * 1000).toISOString(),
            reasonsAtRequest: entry.reasonCodes.map((c) => reasonFromCode(c)),
          },
          reasonsNow: pre.reasons,
          blockers: pre.blockers,
          nextStep: close ? "done" : approved ? "call pay with the same to/amount" : "wait — the owner has not resolved it yet",
          ...(closedTx ? { closedTx, links: { tx: txUrl(ctx.net.name, closedTx) } } : {}),
        });
      } catch (e) {
        return fail(`check_exception failed: ${errText(e)}`);
      }
    },
  );
}
