// Fee sponsorship for passkey users, independent of where it is hosted. The Cloudflare worker
// (worker/index.ts) calls handleRelay with its env; nothing in here reads process.env or any
// platform global.
//
// A smart wallet holds no XLM, so somebody else has to source the transaction. This does
// that — and nothing more. Authorisation stays with the user: the auth entries are signed by
// their passkey and bound to their wallet's address, so the account paying the fee has no
// say over what the transaction may do. The URL is public, so every request is admitted only
// after the server decodes what the call actually is; a caller's claim is never trusted.
//
// What it pays for: the factory (named in configuration), the contracts the env lists, and
// treasuries and wallets running code we ship (admitted by wasm). Never a native-XLM transfer:
// a treasury is funded through its own `deposit`. The fee is real money, so the limiters and a
// daily fee budget are required, and every transaction is priced before it is sent and
// refused when it costs more than one call should, would take the day past its budget, or
// would leave the fee account below its floor.
//
// A passkey owner has no other way to pay a fee, so the relay is also their off switch: with
// the day's budget gone they could not revoke an agent, pause or withdraw. Those calls keep a
// reserve of their own (see EXIT_CALLS), and nothing is charged to the day for a transaction
// the network refused.
//
// Explicit .js extensions throughout: see the note in relayGuard.ts.
import { Address, Keypair, rpc, xdr } from "@stellar/stellar-sdk";
import { classifyHostFunction, walletDeployFromEnvelope, type HostCall } from "./hostFunction.js";
import { SAFETY_LANE, safetyCallsLane, type FeeBudget } from "./relayBudget.js";
import { allowedWasmHashes, authEntriesAreSafe, isRelayAllowed } from "./relayGuard.js";
import { submitEnvelope, submitHostFunction, type Release } from "./relaySubmit.js";

export interface RelayEnv {
  /** pubnet, the only network; anything else is refused rather than guessed at */
  RELAY_NETWORK?: string;
  /** the fee account */
  RELAY_SECRET?: string;
  RELAY_RPC_URL?: string;
  RELAY_ALLOWED_CONTRACTS?: string;
  RELAY_ALLOWED_WASM?: string;
  /** the treasury factory to admit */
  RELAY_FACTORY_ID?: string;
  /** the most the relay spends on fees in one UTC day, in XLM; required */
  RELAY_DAILY_BUDGET_XLM?: string;
  /** the most one transaction may cost, in XLM (default 1) */
  RELAY_MAX_FEE_XLM?: string;
  /** below this balance the fee account stops sponsoring, in XLM (default 5) */
  RELAY_MIN_BALANCE_XLM?: string;
  /** what an owner's exit calls may still spend in a UTC day once the daily budget is gone,
   *  in XLM (default 5) */
  RELAY_SAFETY_BUDGET_XLM?: string;
}

/** The RPC the relay talks to, narrowed to what it uses. */
export type RelayRpc = Pick<
  rpc.Server,
  "getAccount" | "getAccountEntry" | "getContractData" | "simulateTransaction" | "sendTransaction" | "getTransaction"
>;

/** Cloudflare's rate-limiting binding has this shape; anything with it will do. */
export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/** What the host wires in around the handler. All three are required. */
export interface RelayGuards {
  /** per client IP */
  limiter?: RateLimiter;
  /** per wallet: an IP is cheap to change, the wallet that signed is not hidden by it */
  walletLimiter?: RateLimiter;
  /** the day's total, shared by every instance */
  budget?: FeeBudget;
  /** the RPC to use instead of the configured one — how the handler is tested offline */
  server?: RelayRpc;
}

export interface RelayNetwork {
  name: "pubnet";
  passphrase: string;
  rpcUrl: string;
  /** contracts admitted by address */
  contracts: string[];
  /** stroops */
  dailyBudget: bigint;
  /** stroops */
  maxTxFee: bigint;
  /** stroops; 0 means no floor */
  minBalance: bigint;
  /** stroops; what exit calls may spend in a day after the daily budget is gone */
  safetyBudget: bigint;
}

/** The calls that stop an agent or take the owner's money out of a treasury. A passkey owner
 *  reaches the chain only through this relay, so these must not depend on the day's budget
 *  having room: an empty budget is exactly what someone who wants an owner unable to react
 *  would arrange. They draw on the day like any call, and on a reserve of their own once the
 *  day is spent. */
export const EXIT_CALLS: ReadonlySet<string> = new Set([
  "revoke_session",
  "set_paused",
  "admin_withdraw",
  "admin_cancel_escrow",
  "remove_payee",
]);

/** How often one wallet may draw on the reserve in a day. The reserve only admits calls a
 *  treasury's own admin signed, so emptying it takes real treasuries; this makes each of
 *  them worth a few calls and no more. */
export const SAFETY_CALLS_PER_WALLET = 10n;

/** The balance the fee account keeps even for exit calls: above what the account itself
 *  must hold to exist, below the floor everything else stops at. */
export const EXIT_FLOOR = 2n * 10_000_000n;

// Invisible characters smuggled into an env value have bitten this project twice (a BOM in
// the Supabase key, a BOM+CRLF in the WalletConnect id) — both times the symptom was a silent
// failure far from the cause. Strip anything non-printable before use; .trim() alone misses
// zero-width characters.
export const clean = (v: string | undefined): string => (v ?? "").replace(/[^\x20-\x7E]/g, "").trim();

const csv = (v: string | undefined): string[] =>
  clean(v).split(",").map((s) => s.trim()).filter(Boolean);

/** An XLM amount from env as stroops; `fallback` when unset. Throws on anything that is not
 *  a plain positive decimal — a typo in a spending limit must not read as "no limit". */
export function xlmEnv(name: string, v: string | undefined, fallback: bigint | null): bigint | null {
  const s = clean(v);
  if (!s) return fallback;
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(s);
  if (!m) throw new Error(`${name} is not an XLM amount: "${s}"`);
  const stroops = BigInt(m[1]) * 10_000_000n + BigInt((m[2] ?? "").padEnd(7, "0"));
  if (stroops <= 0n) throw new Error(`${name} must be above zero`);
  return stroops;
}

const XLM = 10_000_000n;

/** What this deployment sponsors, from its env. Throws on a configuration that cannot be safe. */
export function relayNetwork(env: RelayEnv): RelayNetwork {
  const name = clean(env.RELAY_NETWORK) || "pubnet";
  if (name !== "pubnet") throw new Error(`unknown RELAY_NETWORK "${name}" — the relay runs on pubnet only`);
  const rpcUrl = clean(env.RELAY_RPC_URL);
  if (!rpcUrl) throw new Error("RELAY_RPC_URL is required");
  const dailyBudget = xlmEnv("RELAY_DAILY_BUDGET_XLM", env.RELAY_DAILY_BUDGET_XLM, null);
  if (dailyBudget === null) throw new Error("RELAY_DAILY_BUDGET_XLM is required");
  const listed = csv(env.RELAY_ALLOWED_CONTRACTS);
  const factory = clean(env.RELAY_FACTORY_ID);
  return {
    name,
    passphrase: "Public Global Stellar Network ; September 2015",
    rpcUrl,
    contracts: factory ? [...listed, factory] : listed,
    dailyBudget,
    // A factory create measured about 0.32 XLM of resource fee (0.42 padded); 1 XLM leaves
    // room for that and refuses anything an order of magnitude dearer.
    maxTxFee: xlmEnv("RELAY_MAX_FEE_XLM", env.RELAY_MAX_FEE_XLM, XLM) as bigint,
    minBalance: xlmEnv("RELAY_MIN_BALANCE_XLM", env.RELAY_MIN_BALANCE_XLM, 5n * XLM) as bigint,
    safetyBudget: xlmEnv("RELAY_SAFETY_BUDGET_XLM", env.RELAY_SAFETY_BUDGET_XLM, 5n * XLM) as bigint,
  };
}

/** Why the relay will not pay for this one, as the caller should hear it. */
export class Refused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Every limit on money, checked against the priced transaction just before it is sent: the
 *  per-call cap first (free), then the fee account's floor, and the day's budget last, so a
 *  refusal on the way never spends budget. Resolves to the way to give the charge back, for
 *  a transaction the network then refuses to take in.
 *
 *  `exit` names the wallets behind an exit call (EXIT_CALLS): with the day's budget spent,
 *  such a call is charged to the reserve instead, each wallet a limited number of times. It
 *  also runs under a lower floor (EXIT_FLOOR): a day's budget that was really spent leaves
 *  the account at its floor, and a reserve nobody could reach there would be one in name. */
export function feeGate(
  net: Pick<RelayNetwork, "maxTxFee" | "minBalance" | "dailyBudget"> & { safetyBudget?: bigint },
  budget: FeeBudget | undefined,
  balance: () => Promise<bigint>,
  exit?: { wallets: string[] },
): (stroops: bigint) => Promise<Release> {
  const fromReserve = async (stroops: bigint): Promise<boolean> => {
    const reserve = net.safetyBudget ?? 0n;
    if (!budget || !exit || exit.wallets.length === 0 || reserve <= 0n) return false;
    for (const wallet of exit.wallets) {
      if (!(await budget.reserve(1n, SAFETY_CALLS_PER_WALLET, safetyCallsLane(wallet)))) return false;
    }
    return budget.reserve(stroops, reserve, SAFETY_LANE);
  };
  return async (stroops) => {
    if (stroops > net.maxTxFee) {
      console.error(`[relay] refused a ${stroops}-stroop transaction (cap ${net.maxTxFee})`);
      throw new Refused(403, "Not allowed.");
    }
    const floor = exit && net.minBalance > EXIT_FLOOR ? EXIT_FLOOR : net.minBalance;
    if (floor > 0n) {
      const held = await balance();
      if (held - stroops < floor) {
        // The line to alert on: sponsorship is off until the account is topped up.
        console.error(`[relay] fee account below floor: ${held} stroops (floor ${floor})`);
        throw new Refused(503, "The relay is paused. Try again later.");
      }
    }
    if (budget && (await budget.reserve(stroops, net.dailyBudget))) {
      return () => budget.release(stroops);
    }
    // The line to alert on: from here until midnight UTC only exit calls are sponsored.
    console.error(`[relay] daily budget reached (${net.dailyBudget} stroops)`);
    if (await fromReserve(stroops)) {
      console.error(`[relay] exit call charged to the reserve (${stroops} stroops)`);
      return () => budget!.release(stroops, SAFETY_LANE);
    }
    throw new Refused(503, "The relay has reached today's limit. Try again tomorrow.");
  };
}

/** The addresses a call's auth entries sign as — on the func path, the wallets asking. */
function signingAddresses(entries: xdr.SorobanAuthorizationEntry[]): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    const c = e.credentials();
    const a = c.switch().name === "sorobanCredentialsAddress" ? c.address() : c.addressV2();
    out.add(Address.fromScAddress(a.address()).toString());
  }
  return [...out];
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The caller, as far as the edge can tell — the key requests are rate-limited by. */
export function clientKey(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function handleRelay(req: Request, env: RelayEnv, guards: RelayGuards = {}): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const { limiter, walletLimiter, budget } = guards;

  let net: RelayNetwork;
  try {
    net = relayNetwork(env);
  } catch (e) {
    console.error("relay misconfigured:", e instanceof Error ? e.message : String(e));
    return json({ error: "Relay is not configured." }, 503);
  }
  // Fails closed: a relay without its limiters and its daily total would pay real fees for
  // anyone, as fast and as often as they can ask.
  if (!(limiter && walletLimiter && budget)) {
    return json({ error: "Relay is not configured." }, 503);
  }
  if (!(await limiter.limit({ key: clientKey(req) })).success) {
    return json({ error: "Too many requests — wait a minute and try again." }, 429);
  }

  const secret = clean(env.RELAY_SECRET);
  let keypair: Keypair | null = null;
  try {
    if (secret) keypair = Keypair.fromSecret(secret);
  } catch {
    keypair = null;
  }
  if (!keypair) return json({ error: "Relay is not configured." }, 503);

  let body: { func?: unknown; auth?: unknown; xdr?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Malformed request." }, 400);
  }
  const { func, auth, xdr: envelope } = body;

  // Two shapes reach the relay. Treasury calls arrive decoded (func + auth entries), while
  // passkey-kit's wallet deployment arrives as a fully signed envelope. Both go through the
  // same admission gate — the envelope's host function is read out of it first.
  const isFuncCall =
    typeof func === "string" && Array.isArray(auth) && auth.every((a) => typeof a === "string");
  const isEnvelope = typeof envelope === "string" && envelope.length > 0;
  if (!isFuncCall && !isEnvelope) return json({ error: "Malformed request." }, 400);

  const server: RelayRpc = guards.server ?? new rpc.Server(net.rpcUrl);
  // The wallet code this deployment sponsors, as the env names it. `wasmHashes` adds every
  // treasury version to it: contracts running either may be called, but only a wallet may be
  // deployed from a signed envelope.
  const walletWasm = csv(env.RELAY_ALLOWED_WASM);
  const wasmHashes = allowedWasmHashes(clean(env.RELAY_ALLOWED_WASM));
  const readWasmHash = async (contractId: string): Promise<string | null> => {
    const entry = await server.getContractData(
      contractId,
      xdr.ScVal.scvLedgerKeyContractInstance(),
      rpc.Durability.Persistent,
    );
    const executable = entry.val.contractData().val().instance().executable();
    if (executable.switch().name !== "contractExecutableWasm") return null;
    return executable.wasmHash().toString("hex");
  };
  const admit = async (call: HostCall): Promise<boolean> => {
    if (call.kind === "invoke") {
      return isRelayAllowed(call.contractId, { contracts: net.contracts, wasmHashes, readWasmHash });
    }
    if (call.kind === "deploy") {
      const seen = call.wasmHash.toLowerCase();
      return wasmHashes.some((h) => h.toLowerCase() === seen);
    }
    return false; // raw wasm uploads and anything unrecognised
  };

  // An envelope is admitted only as what passkey-kit sends: one signed wallet deployment.
  const gated = isFuncCall
    ? (func as string)
    : walletDeployFromEnvelope(envelope as string, net.passphrase, walletWasm);
  if (!gated) return json({ error: "Not allowed." }, 403);
  const call = classifyHostFunction(gated);
  if (!(await admit(call))) return json({ error: "Not allowed." }, 403);

  let entries: xdr.SorobanAuthorizationEntry[] = [];
  if (isFuncCall) {
    try {
      entries = (auth as string[]).map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64"));
    } catch {
      return json({ error: "Malformed request." }, 400);
    }
    if (!authEntriesAreSafe(entries, keypair.publicKey())) return json({ error: "Not allowed." }, 403);
    // Everything a passkey wallet sends carries the wallet's signed entry. A call that needs
    // nobody's authorisation is a read: free to simulate, and not something to pay a fee for.
    if (entries.length === 0) return json({ error: "Not allowed." }, 403);
  }

  // An exit call on a treasury (admitted by its code, not one of the fixed addresses) may
  // fall back on the reserve when the day's budget is gone.
  const wallets = signingAddresses(entries);
  const isExit = call.kind === "invoke" && EXIT_CALLS.has(call.fn) && !net.contracts.includes(call.contractId);
  const feeAccount = keypair.publicKey();
  const gate = feeGate(
    net,
    budget,
    async () => BigInt((await server.getAccountEntry(feeAccount)).balance().toString()),
    isExit ? { wallets } : undefined,
  );
  // Runs once the transaction has been simulated and priced, so the entries it counts are
  // ones the chain accepted as signed. Counting them as they arrive let anyone name a wallet
  // in an unsigned entry and use up that wallet's allowance for it (fifth review, F1). A
  // wallet asking from many addresses is still one wallet; the envelope path (creating a
  // wallet) has none yet to key on, and the IP limiter and the daily total cover it.
  const charge = async (stroops: bigint): Promise<Release> => {
    for (const wallet of wallets) {
      if (!(await walletLimiter.limit({ key: wallet })).success) {
        throw new Refused(429, "Too many requests — wait a minute and try again.");
      }
    }
    return gate(stroops);
  };
  const deps = { server, keypair, networkPassphrase: net.passphrase, charge };

  try {
    const result = isFuncCall
      ? await submitHostFunction(deps, xdr.HostFunction.fromXDR(func as string, "base64"), entries)
      : await submitEnvelope(deps, envelope as string);
    return json({ hash: result.hash, status: result.status }, 200);
  } catch (e) {
    if (e instanceof Refused) return json({ error: e.message }, e.status);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("relay failed:", msg);
    return json({ error: "Relay failed." }, 502);
  }
}
