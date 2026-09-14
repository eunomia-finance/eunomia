// The three Week-1 tools. Each one reads the chain fresh on every call — an agent asking
// "may I spend?" must never be answered from a stale snapshot — and each returns the
// same JSON as text (for clients that only render text) and as structuredContent.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { computeBudget, type Budget } from "./budget.js";
import { contractUrl, fromStroops, toStroops, type NetworkName } from "./format.js";
import { listAllowedPayees } from "./payees.js";
import type { ServerContext } from "./server.js";
import { isPayee, makeClient, readTreasury } from "./treasury.js";

const amt = (v: bigint) => fromStroops(v);

/** Budget → transport-safe JSON: every bigint becomes a decimal string in the token's
 *  units, with the raw stroops kept alongside where an agent would compute with them. */
export function serializeBudget(b: Budget, net: NetworkName): Record<string, unknown> {
  return {
    treasury: b.contractId,
    token: b.token,
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
    note: "Numbers are pre-flight reads; the treasury contract enforces the same rules on-chain at payment time.",
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
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const NO_TREASURY =
  "No treasury configured. Set EUNOMIA_TREASURY to the treasury's contract id (C…) or run `eunomia-mcp init --treasury <id>`.";

export function registerTools(server: McpServer, ctx: ServerContext): void {
  const now = ctx.now ?? (() => Math.floor(Date.now() / 1000));

  server.registerTool(
    "check_budget",
    {
      title: "Check budget",
      description:
        "What this agent may spend from its Eunomia treasury right now: per-payment cap, rolling 24h limit, Leash session cap and expiry, pause state, free balance. Pass `amount` (e.g. \"2.5\") to pre-flight a specific payment and get the contract's rejection reasons before paying.",
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
        return ok({ agentPublicKey: ctx.credential?.agentPublicKey ?? null, ...serializeBudget(budget, ctx.net.name) });
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
}
