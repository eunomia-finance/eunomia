// The tools that let an agent buy real services: find one, fund a float from the treasury,
// pay for a call out of it, return what is left — and ask the owner for a task budget when
// the work needs one. Registered alongside the treasury tools in tools.ts.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeBudgetRequest, MAX_REQUEST_HOURS, MAX_REQUEST_PAYEES, REQUEST_TTL_SEC } from "./budgetRequestCodec.js";
import { callService } from "./call.js";
import { searchServices } from "./catalog.js";
import { isValidContractId } from "./credential.js";
import { errText } from "./errors.js";
import { fundFloat, sweepFloat, tokenBalance } from "./float.js";
import { fromStroops, toStroops, txUrl } from "./format.js";
import { TRUSTLINE_MISSING } from "./pay.js";
import type { ServerContext } from "./server.js";
import { agentKeypair } from "./signer.js";
import { makeClient, readTreasury } from "./treasury.js";
import { treasuryUnit } from "./unit.js";
import { serializeOutcome } from "./tools.js";

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

const NEEDS_SETUP =
  "Needs a treasury and an agent credential: set EUNOMIA_TREASURY and run `eunomia-mcp init --treasury <id>`.";

const ready = (ctx: ServerContext): string | null =>
  !ctx.treasuryId || !isValidContractId(ctx.treasuryId) || !ctx.credential ? NEEDS_SETUP : null;

export function registerSpendTools(server: McpServer, ctx: ServerContext): void {
  const now = ctx.now ?? (() => Math.floor(Date.now() / 1000));

  server.registerTool(
    "find_services",
    {
      title: "Find paid services",
      description:
        "Search paid APIs an agent can buy per call with Stellar USDC (the ROZO MPP Router catalog on mainnet: LLMs, web search, scraping, market data, maps…). Free to search. Each result has the `url` and `method` to pass to call_service, its price and `payTo` — the address the treasury must approve before the agent can pay it. Verified routes (ROZO paid through them itself) come first.",
      inputSchema: {
        query: z.string().optional().describe('What you need, e.g. "web search", "weather", "gpt"'),
        category: z.string().optional().describe("ai, data, web, search, compute, storage, social, blockchain"),
        verifiedOnly: z.boolean().optional().describe("Only routes ROZO has paid through end to end"),
        limit: z.number().int().min(1).max(25).optional(),
      },
    },
    async ({ query, category, verifiedOnly, limit }) => {
      try {
        const found = await searchServices({ query, category, verifiedOnly, limit });
        return ok({
          total: found.total,
          services: found.routes,
          note: "Pay with call_service (it funds nothing by itself — fund_float first). Every route above settles to its payTo; the owner approves that address once.",
        });
      } catch (e) {
        return fail(`find_services failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    "fund_float",
    {
      title: "Fund the task float",
      description:
        "Move an amount from the treasury to this agent's own account, so call_service can pay services that settle only from a regular account. It is an ordinary treasury payment to the agent's address: every on-chain limit applies, including the monthly cap the owner may set on that address. Fund what the task needs and sweep_float the rest back.",
      inputSchema: {
        amount: z.string().describe('Amount in the treasury\'s token, e.g. "0.5"'),
        taskId: z.number().int().nonnegative().optional(),
      },
    },
    async ({ amount, taskId }) => {
      const notReady = ready(ctx);
      if (notReady) return fail(notReady);
      try {
        const outcome = await fundFloat(ctx, toStroops(amount), BigInt(taskId ?? 0), { now });
        const unit = await treasuryUnit(ctx.net, ctx.treasuryId!);
        const out: Record<string, unknown> = serializeOutcome(outcome, ctx.net.name, unit);
        if (!outcome.paid && outcome.reasons.some((r) => r.code === TRUSTLINE_MISSING)) {
          out.nextStep = `The agent account cannot hold ${unit ?? "the treasury's token"} yet — run \`eunomia-mcp trustline\` once, then fund again.`;
        }
        return ok({ float: true, ...out });
      } catch (e) {
        return fail(`fund_float failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    "call_service",
    {
      title: "Call a paid service",
      description:
        "Make one HTTP request to a paid service (a `url` from find_services; other x402 hosts only when the operator has allowed them) and pay its 402 from the task float. Nothing is signed unless a Leash for this agent is running and the treasury is not paused, the price is within `maxPrice`, the operator's per-call ceiling, the treasury's per-payment cap and the float, the payee is one the treasury approves, and — under a task budget — one the budget names. Returns the service's answer and the payment's tx hash. Refusals list each payment option and why. If the result says paymentHandedOver, do not retry: the service may still collect that payment.",
      inputSchema: {
        url: z.string().url(),
        method: z.string().optional().describe("Use the method find_services gives; default POST"),
        body: z.unknown().optional().describe("JSON request body, as the service documents it"),
        maxPrice: z.string().describe('Most you will pay for this call, in the treasury\'s token, e.g. "0.02"'),
        service: z.string().optional().describe("The find_services id, recorded with the purchase"),
      },
    },
    async ({ url, method, body, maxPrice, service }) => {
      const notReady = ready(ctx);
      if (notReady) return fail(notReady);
      try {
        const out = await callService(ctx, { url, method, body, maxPrice: toStroops(maxPrice) }, { now });
        if ("refused" in out) return ok({ ...out, nextStep: out.nextStep ?? refusalNextStep(out.options) });
        if (out.amount !== undefined && out.payTo) {
          ctx.purchases?.append(ctx.treasuryId!, {
            at: now(),
            service: service ?? null,
            url,
            amount: out.amount.toString(),
            payTo: out.payTo,
            txHash: out.txHash ?? null,
            status: out.status,
          });
        }
        return ok({
          paid: out.paid,
          status: out.status,
          ...(out.amount !== undefined ? { price: fromStroops(out.amount), priceStroops: out.amount.toString(), payTo: out.payTo } : {}),
          ...(out.txHash ? { txHash: out.txHash, links: { tx: txUrl(ctx.net.name, out.txHash) } } : {}),
          ...(out.collectableUntil !== undefined
            ? {
                paymentHandedOver: true,
                collectableUntil: new Date(out.collectableUntil * 1000).toISOString(),
                note: "A signed payment was given to this service and it reported no settlement. It is not confirmed paid, and the service can still collect it until collectableUntil. Do not call this service again before then — call_service will refuse; check float_status to see whether the money left.",
              }
            : {}),
          body: out.body,
        });
      } catch (e) {
        return fail(`call_service failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    "sweep_float",
    {
      title: "Return the float",
      description:
        "Send what is left in this agent's account back to the treasury (all of it unless `amount` is given). Do this when a task is done, so money outside the treasury's protection is only ever what a task is about to spend.",
      inputSchema: { amount: z.string().optional().describe("Amount to return; default everything") },
    },
    async ({ amount }) => {
      const notReady = ready(ctx);
      if (notReady) return fail(notReady);
      try {
        const r = await sweepFloat(ctx, amount !== undefined ? toStroops(amount) : undefined);
        return ok({
          swept: fromStroops(r.swept),
          status: r.status,
          ...(r.txHash ? { txHash: r.txHash, links: { tx: txUrl(ctx.net.name, r.txHash) } } : {}),
          unit: await treasuryUnit(ctx.net, ctx.treasuryId!),
        });
      } catch (e) {
        return fail(`sweep_float failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    "float_status",
    {
      title: "Float and purchases",
      description:
        "How much of the treasury's token this agent holds right now (the float), and what call_service bought for this treasury — service, price, payee, tx hash.",
      inputSchema: { last: z.number().int().min(1).max(100).optional() },
    },
    async ({ last }) => {
      const notReady = ready(ctx);
      if (notReady) return fail(notReady);
      try {
        const snap = await readTreasury(makeClient(ctx.net, ctx.treasuryId!), ctx.treasuryId!);
        const held = await tokenBalance(ctx.net, snap.config.token, ctx.credential!.agentPublicKey);
        const purchases = (ctx.purchases?.load(ctx.treasuryId!) ?? []).slice(-(last ?? 20));
        return ok({
          agentPublicKey: ctx.credential!.agentPublicKey,
          float: fromStroops(held),
          floatStroops: held.toString(),
          unit: await treasuryUnit(ctx.net, ctx.treasuryId!, snap.config.token),
          purchases: purchases.map((p) => ({ ...p, price: fromStroops(BigInt(p.amount)), at: new Date(p.at * 1000).toISOString() })),
        });
      } catch (e) {
        return fail(`float_status failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    "request_budget",
    {
      title: "Ask the owner for a task budget",
      description:
        "Ask the treasury owner for a budget for one task: an amount, how long it lasts and which payees it may pay. Returns a link to give the owner; they approve it once with their passkey and this agent can then pay inside it with no further prompts. The request is signed with this agent's key, so an edited link will not verify. Poll check_budget — the budget is live when its session belongs to this agent and `taskPayees` lists the payees asked for.",
      inputSchema: {
        amount: z.string().describe('Total for the task, in the treasury\'s token, e.g. "5"'),
        hours: z.number().int().min(1).max(MAX_REQUEST_HOURS).describe("How long the budget lasts"),
        payees: z
          .array(z.string())
          .min(1)
          .max(MAX_REQUEST_PAYEES)
          .describe("Addresses the task will pay — e.g. a service's payTo from find_services, or this agent's own key for a float"),
        task: z.string().min(1).max(200).describe("What the budget is for, in a sentence the owner will read"),
      },
    },
    async ({ amount, hours, payees, task }) => {
      const notReady = ready(ctx);
      if (notReady) return fail(notReady);
      try {
        const request = {
          network: ctx.net.name,
          treasury: ctx.treasuryId!,
          agent: ctx.credential!.agentPublicKey,
          limit: toStroops(amount),
          hours,
          payees,
          task,
          expires: now() + REQUEST_TTL_SEC,
        };
        const params = encodeBudgetRequest(request, agentKeypair(ctx.credential!));
        // The app routes by hash; the request rides in the query and opens on the Agent page.
        const approvalUrl = `${(ctx.appUrl ?? "https://eunomia.finance").replace(/\/$/, "")}/?${params}#agent`;
        return ok({
          requested: true,
          approvalUrl,
          agentPublicKey: request.agent,
          request: { ...request, limit: amount, unit: await treasuryUnit(ctx.net, ctx.treasuryId!) },
          expiresAt: new Date(request.expires * 1000).toISOString(),
          howOwnerApproves:
            "Give the owner this link and this agent's public key (agentPublicKey). The app shows the amount, duration, payees and task; for a key it has not seen on this treasury it asks the owner to paste the key first. One signature starts the budget. The link expires in 24 hours.",
          checkWith: "check_budget",
        });
      } catch (e) {
        return fail(`request_budget failed: ${errText(e)}`);
      }
    },
  );
}

/** What to do about a refused 402, from the reasons each option failed. */
function refusalNextStep(options: Array<{ problems: string[] }>): string {
  const all = options.flatMap((o) => o.problems).join(" ");
  if (/fund_float/.test(all)) return "fund_float enough for this call, then call again";
  if (/not a payee the treasury approves|outside the task budget/.test(all)) {
    return "request_budget naming this payTo (or ask the owner to approve it)";
  }
  if (/can still be collected/.test(all)) return "wait until the earlier payment can no longer be collected, then call again; float_status shows whether it was taken";
  if (/per-call ceiling/.test(all)) return "this call costs more than the operator lets one call pay — only the operator can raise EUNOMIA_MAX_PRICE";
  if (/maxPrice/.test(all)) return "raise maxPrice if the price is acceptable";
  return "this service cannot be paid from this treasury";
}
