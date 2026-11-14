// Buy one call to a paid HTTP service: request → 402 → checks → sign → retry → answer.
//
// The payment comes out of the agent's float (float.ts), signed by the agent's own key with
// the official x402 client. Before anything is signed, every option the 402 offers is held
// to the same rules the treasury would apply if it could pay directly, so the float cannot
// become the way around them:
//   - exact scheme, this network, the treasury's own token
//   - no more than the caller's `maxPrice`, the treasury's per-payment cap and the float
//   - paid to an address the treasury approves (is_payee), and inside the task budget's
//     payee list when the Leash has one
// An option that fails any of them is never offered to the signer.
//
// The float is plain money in the agent's account: the contract no longer stands between it
// and a payee. So the rest of what the owner decided is held here as well (fifth review):
//   - the float is spent only while the owner's permission stands — an active Leash for this
//     agent on a treasury that is not paused. Revoking, pausing or the deadline stop it (F2);
//   - the model chooses the URL and `maxPrice`, and what a service answers comes back to the
//     model, so neither is trusted to bound a call: the operator names the hosts and a price
//     ceiling in the server's environment, where the model cannot reach them (F4);
//   - a signed payment is good until the ledger its 402 asked for. A service is given a few
//     minutes, not months, and one that took a signature without reporting a settlement is
//     not handed another until the first has run out (F5).
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { computeBudget, type Budget, type TreasurySnapshot } from "./budget.js";
import { ROZO_BASE_URL } from "./catalog.js";
import { tokenBalance } from "./float.js";
import { requireTreasury } from "./pay.js";
import type { ServerContext } from "./server.js";
import { isPayee, makeClient, readTreasury } from "./treasury.js";
import { caip2, type PaymentRequirements } from "./x402.js";

/** The most one call may pay when the operator names no ceiling: one unit of the treasury's
 *  token. Catalog calls cost cents; this stops a single call from emptying a float. */
export const DEFAULT_MAX_CALL_PRICE = 10_000_000n;

/** Where call_service may go when the operator names no hosts: the service catalog. */
export const DEFAULT_SERVICE_HOSTS: readonly string[] = [new URL(ROZO_BASE_URL).hostname];

/** The longest a signed payment may stay collectable, in seconds. The catalog asks for 300. */
export const MAX_PAYMENT_WINDOW_SEC = 300;

/** Added to a payment's window before another may be signed for the same service: the
 *  window is turned into a ledger number by an estimate of how fast ledgers close. */
const WINDOW_SLACK_SEC = 60;

export interface CallArgs {
  url: string;
  method?: string;
  /** JSON body (sent as application/json) */
  body?: unknown;
  /** most the caller will pay for this one call, in stroops */
  maxPrice: bigint;
}

export interface OptionVerdict {
  payTo: string;
  amount: string;
  asset: string;
  network: string;
  problems: string[];
}

export type CallOutcome =
  | {
      paid: boolean;
      status: number;
      /** response body: parsed JSON when it is JSON, otherwise text (truncated) */
      body: unknown;
      amount?: bigint;
      payTo?: string;
      txHash?: string;
      options?: OptionVerdict[];
      /** set when a signed payment was handed over and no settlement came back: the service
       *  can still collect it until this time (unix seconds) */
      collectableUntil?: number;
    }
  | { paid: false; status: 402; refused: true; options: OptionVerdict[]; message: string; nextStep?: string };

export interface CallDeps {
  fetchImpl?: typeof fetch;
  /** the float's balance of the treasury token; injected for tests */
  floatBalance?: () => Promise<bigint>;
  /** resolves a host to its addresses; injected for tests */
  resolve?: (host: string) => Promise<string[]>;
  /** builds the payment header for the chosen option; injected for tests */
  sign?: (paymentRequired: unknown, chosen: PaymentRequirements) => Promise<Record<string, string>>;
  readClient?: ReturnType<typeof makeClient>;
  now?: () => number;
}

const MAX_BODY_CHARS = 20_000;

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  const clipped = text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}… [truncated]` : text;
  try {
    return JSON.parse(text);
  } catch {
    return clipped;
  }
}

/** Loopback, private, link-local (cloud metadata), CGNAT and unspecified ranges — what an
 *  agent talked into "calling a service" must never reach on the machine it runs on. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateV4(ip.split(".").map(Number));
  const b = ipv6Bytes(ip);
  if (!b) return true; // not an address we can read: refuse rather than guess
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  // An IPv6 address that carries an IPv4 one is judged by the IPv4 one: mapped (::ffff:a.b.c.d,
  // which the URL parser rewrites to ::ffff:7f00:1), compatible (::a.b.c.d, covering :: and
  // ::1), NAT64 (64:ff9b::/96) and 6to4 (2002::/16).
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return isPrivateV4(b.slice(12));
  if (zero(0, 12)) return isPrivateV4(b.slice(12));
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return zero(4, 12) ? isPrivateV4(b.slice(12)) : true;
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateV4(b.slice(2, 6));
  return (
    (b[0] & 0xfe) === 0xfc || // unique local fc00::/7
    (b[0] === 0xfe && (b[1] & 0x80) === 0x80) || // link-local fe80::/10 and site-local fec0::/10
    b[0] === 0xff || // multicast
    (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) // Teredo 2001::/32 tunnels to IPv4
  );
}

function isPrivateV4([a, b]: number[]): boolean {
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  );
}

/** The 16 bytes of an IPv6 address (any spelling, dotted tail included), or null. */
function ipv6Bytes(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;
  let s = ip.toLowerCase().split("%")[0];
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split(".").map(Number);
    s = s.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const groups = (part?: string) => (part ? part.split(":") : []);
  const h = groups(head);
  const t = tail === undefined ? [] : groups(tail);
  const words = [...h, ...Array(8 - h.length - t.length).fill("0"), ...t].map((g) => parseInt(g, 16));
  return words.flatMap((w) => [w >> 8, w & 0xff]);
}

/** fetch for mainnet: every connection is checked again at the moment it is made, on the
 *  addresses actually dialled — so a host that resolved to a public address for urlProblem
 *  cannot answer with a private one a moment later (DNS rebinding). Redirects are never
 *  followed: node:https does not follow them. */
export const pinnedFetch: typeof fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => (headers[k] = v));
  const checkedLookup = (host: string, opts: LookupOptions, cb: LookupCallback) => {
    lookup(host, { all: true, family: opts.family }).then((addrs) => {
      const bad = addrs.find((a) => isPrivateAddress(a.address));
      if (bad) return cb(new Error(`${host} resolves to a private address`), "", 0);
      if (addrs.length === 0) return cb(new Error(`${host} does not resolve`), "", 0);
      return opts.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family);
    }, (err) => cb(err, "", 0));
  };
  return new Promise<Response>((resolve, reject) => {
    const req = request(url, { method: init.method ?? "GET", headers, lookup: checkedLookup as never }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("error", reject);
      res.on("end", () => {
        const out = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) out.append(k, one);
        }
        const status = res.statusCode ?? 502;
        const body = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
        resolve(new Response(body, { status, statusText: res.statusMessage, headers: out }));
      });
    });
    req.on("error", reject);
    if (init.signal) init.signal.addEventListener("abort", () => req.destroy(new Error("aborted")));
    if (typeof init.body === "string") req.write(init.body);
    req.end();
  });
};

type LookupOptions = { family?: number; all?: boolean };
type LookupCallback = (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void;

/** Why the agent may not call this URL, or null. https only, to a public host. */
export async function urlProblem(
  raw: string,
  resolve: (host: string) => Promise<string[]>,
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "not a URL";
  }
  if (url.protocol !== "https:") return `${url.protocol} is not allowed — https only`;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return "local hosts are not allowed";
  const addrs = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (addrs.length === 0) return `${host} does not resolve`;
  if (addrs.some(isPrivateAddress)) return `${host} resolves to a private address`;
  return null;
}

const defaultResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

const keyOf = (r: PaymentRequirements) => `${r.network}|${r.asset}|${r.payTo}|${r.amount}`;

/** Whether `raw`'s host is one the operator lets call_service call. `hosts` null = any. */
export function hostAllowed(raw: string, hosts: readonly string[] | null): boolean {
  if (hosts === null) return true;
  const host = new URL(raw).hostname.toLowerCase();
  return hosts.some((h) => h.toLowerCase() === host);
}

/** Why this agent may not spend its float right now, or null.
 *
 *  The float was handed over under a Leash, and it is spent only while that permission
 *  stands: once the owner pauses the treasury or revokes the Leash, or its deadline passes,
 *  what is left is the owner's to get back (sweep_float), not the agent's to finish. The
 *  treasury's own agent with no Leash running spends under the treasury's limits and needs
 *  none. */
export function floatStop(snap: TreasurySnapshot, budget: Budget, agentPublicKey: string): string | null {
  // A read that failed must not pass for "not paused": readTreasury marks that as `legacy`
  // (no pause surface answered), and every treasury on mainnet has one.
  if (snap.legacy) return "whether the treasury is paused could not be read";
  if (snap.paused) return "the treasury is paused by its owner";
  const session = budget.session;
  if (agentPublicKey === snap.config.agent && !session?.active) return null;
  if (!session || !session.active) return "no Leash or task budget is running for this agent — it ended, or the owner revoked it";
  if (!session.isThisAgent) return "the Leash that is running belongs to another agent";
  return null;
}

/** The key a handed-over payment is remembered under. */
const unsettledKey = (url: string, payTo: string) => `${url}|${payTo}`;

export async function callService(ctx: ServerContext, args: CallArgs, deps: CallDeps = {}): Promise<CallOutcome> {
  const treasuryId = requireTreasury(ctx);
  if (!ctx.credential) throw new Error("No agent credential — run `eunomia-mcp init` first.");
  const fetchImpl = deps.fetchImpl ?? pinnedFetch;
  const method = (args.method ?? "POST").toUpperCase();
  const bad = await urlProblem(args.url, deps.resolve ?? defaultResolve);
  if (bad) throw new Error(`refusing to call ${args.url}: ${bad}`);
  const hosts = ctx.serviceHosts === undefined ? DEFAULT_SERVICE_HOSTS : ctx.serviceHosts;
  if (!hostAllowed(args.url, hosts)) {
    throw new Error(
      `refusing to call ${args.url}: ${new URL(args.url).hostname} is not a host this agent may call (${(hosts ?? []).join(", ")}) — the operator adds hosts in EUNOMIA_SERVICE_HOSTS`,
    );
  }
  const init: RequestInit = {
    method,
    // A redirect is never followed: it would take the request — and on the second leg the
    // payment header — to a host nobody checked.
    redirect: "manual",
    headers: { accept: "application/json", ...(args.body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(args.body !== undefined && method !== "GET" ? { body: JSON.stringify(args.body) } : {}),
  };

  const first = await fetchImpl(args.url, init);
  if (first.status !== 402) return { paid: false, status: first.status, body: await readBody(first) };

  const http = new x402HTTPClient(new x402Client());
  const firstBody = await readBody(first);
  const paymentRequired = http.getPaymentRequiredResponse((n) => first.headers.get(n), firstBody);

  // The rules, read from the chain once for this call.
  const client = deps.readClient ?? makeClient(ctx.net, treasuryId);
  const now = deps.now ?? ctx.now ?? (() => Math.floor(Date.now() / 1000));
  const snap = await readTreasury(client, treasuryId);
  const budget = computeBudget(snap, ctx.credential.agentPublicKey, now());
  const stopped = floatStop(snap, budget, ctx.credential.agentPublicKey);
  if (stopped) {
    return {
      paid: false,
      status: 402,
      refused: true,
      options: [],
      message: `The float can no longer be spent: ${stopped}. Nothing was signed.`,
      nextStep: "sweep_float to return what is left to the treasury; ask the owner for a new budget (request_budget) if the work is not done",
    };
  }
  const float = await (deps.floatBalance ?? (() => tokenBalance(ctx.net, snap.config.token, ctx.credential!.agentPublicKey)))();
  const approved = new Map<string, boolean>();
  for (const r of paymentRequired.accepts) {
    if (!approved.has(r.payTo)) approved.set(r.payTo, await isPayee(client, r.payTo).catch(() => false));
  }
  const ceiling = ctx.maxCallPrice ?? DEFAULT_MAX_CALL_PRICE;

  const options: OptionVerdict[] = paymentRequired.accepts.map((r) => {
    const problems: string[] = [];
    const amount = /^\d+$/.test(r.amount ?? "") ? BigInt(r.amount) : -1n;
    if (r.scheme !== "exact") problems.push(`scheme "${r.scheme}" is not "exact"`);
    if (r.network !== caip2(ctx.net.name)) problems.push(`network ${r.network} is not ${caip2(ctx.net.name)}`);
    if (r.asset !== snap.config.token) problems.push(`asset ${r.asset} is not the treasury's token`);
    if (amount <= 0n) problems.push(`amount "${r.amount}" is not a positive integer`);
    if (amount > args.maxPrice) problems.push(`price ${amount} is above maxPrice ${args.maxPrice}`);
    if (amount > ceiling) problems.push(`price ${amount} is above this agent's per-call ceiling ${ceiling} (EUNOMIA_MAX_PRICE, set by the operator)`);
    if (amount > snap.config.per_task_limit) problems.push(`price ${amount} is above the treasury's per-payment cap`);
    if (amount > float) problems.push(`price ${amount} is more than the float holds (${float}) — fund_float first`);
    if (!approved.get(r.payTo)) problems.push(`${r.payTo} is not a payee the treasury approves`);
    if (budget.taskPayees.length > 0 && !budget.taskPayees.includes(r.payTo)) {
      problems.push(`${r.payTo} is outside the task budget the owner approved`);
    }
    // The signature is valid until the ledger this many seconds away. Missing or not a
    // number, the client would sign with no usable deadline at all.
    const window = r.maxTimeoutSeconds;
    if (typeof window !== "number" || !Number.isInteger(window) || window <= 0 || window > MAX_PAYMENT_WINDOW_SEC) {
      problems.push(`the service wants the payment to stay collectable for ${String(window)} seconds — more than ${MAX_PAYMENT_WINDOW_SEC}, or not a whole number`);
    }
    const until = ctx.unsettled?.get(unsettledKey(args.url, r.payTo)) ?? 0;
    if (until > now()) {
      problems.push(
        `a payment already signed for this service was never reported settled and can still be collected until ${new Date(until * 1000).toISOString()} — not signing another before then`,
      );
    }
    return { payTo: r.payTo, amount: r.amount, asset: r.asset, network: r.network, problems };
  });

  const acceptable = paymentRequired.accepts.filter((_, i) => options[i].problems.length === 0);
  if (acceptable.length === 0) {
    return {
      paid: false,
      status: 402,
      refused: true,
      options,
      message: "No payment option this service offers is inside the treasury's rules — nothing was signed.",
    };
  }
  // The cheapest acceptable option, and only that one, is handed to the signer.
  const chosen = acceptable.reduce((a, b) => (BigInt(b.amount) < BigInt(a.amount) ? b : a));

  const sign =
    deps.sign ??
    (async (pr: unknown, pick: PaymentRequirements) => {
      const signer = createEd25519Signer(ctx.credential!.agentSecret, caip2(ctx.net.name) as `${string}:${string}`);
      const payer = x402Client.fromConfig({
        schemes: [{ network: caip2(ctx.net.name) as `${string}:${string}`, client: new ExactStellarScheme(signer, { url: ctx.net.rpcUrl }) }],
        policies: [(_v, reqs) => reqs.filter((r) => keyOf(r as PaymentRequirements) === keyOf(pick))],
        // Our own checks above are stricter than the client's default USD cap, and the
        // treasury's token may not be one the client recognises.
        spendControls: false,
      });
      const httpPayer = new x402HTTPClient(payer);
      return httpPayer.encodePaymentSignatureHeader(await payer.createPaymentPayload(pr as never));
    });

  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(await sign(paymentRequired, chosen as PaymentRequirements))) headers.set(k, v);
  const second = await fetchImpl(args.url, { ...init, headers });

  let txHash: string | undefined;
  try {
    const settled = http.getPaymentSettleResponse((n) => second.headers.get(n));
    txHash = settled.transaction || undefined;
  } catch {
    /* no PAYMENT-RESPONSE header: the service did not report a settlement */
  }
  // The service holds a signed payment and reported no settlement. It may still collect it
  // until the signature runs out, so it is remembered: reporting plain "not paid" invited a
  // retry, and every retry handed over another payment the service could collect later.
  let collectableUntil: number | undefined;
  if (txHash === undefined) {
    collectableUntil = now() + (chosen.maxTimeoutSeconds ?? MAX_PAYMENT_WINDOW_SEC) + WINDOW_SLACK_SEC;
    ctx.unsettled?.set(unsettledKey(args.url, chosen.payTo), collectableUntil);
  }
  return {
    paid: second.ok && txHash !== undefined,
    status: second.status,
    body: await readBody(second),
    amount: BigInt(chosen.amount),
    payTo: chosen.payTo,
    ...(txHash ? { txHash } : {}),
    ...(collectableUntil !== undefined ? { collectableUntil } : {}),
    options,
  };
}
