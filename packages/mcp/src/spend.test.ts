import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { decodeBudgetRequest, encodeBudgetRequest, type BudgetRequest } from "./budgetRequestCodec.js";
import { callService } from "./call.js";
import { searchServices, tidy, toRoute } from "./catalog.js";
import { memoryCache } from "./cache.js";
import { NETWORKS } from "./network.js";
import type { ServerContext } from "./server.js";
import { memoryExceptionStore, memoryPurchaseLog } from "./store.js";

// ---- catalog ---------------------------------------------------------------------------

const ROZO_PAY_TO = "GDK3AVW3YE6UL3J4WLNKBMP65KSY32YPUKIOC6PXW65XJ3LEG3YIDXXB";
const raw = (over: Record<string, unknown> = {}) => ({
  id: "exa_search",
  name: "Exa â€“ search",
  description: "Neural web search",
  categories: ["search"],
  public_path: "/v1/services/exa/search",
  method: "post",
  price: "$0.010/request",
  status: "active",
  payment_enabled: true,
  charge_rozo_verified: true,
  methods: { stellar_x402: { pay_to: ROZO_PAY_TO, network: "stellar:pubnet" } },
  payment_hints: { amount_usdc: "0.0100000" },
  docs: { llms_txt: "https://exa.ai/llms.txt" },
  ...over,
});

test("a catalog route keeps what an agent needs to call and pay it", () => {
  const r = toRoute(raw());
  assert.equal(r.url, "https://apiserver.mpprouter.dev/v1/services/exa/search");
  assert.equal(r.method, "POST");
  assert.equal(r.payTo, ROZO_PAY_TO);
  assert.equal(r.network, "stellar:pubnet");
  assert.equal(r.priceUsdc, "0.0100000");
  assert.equal(r.verified, true);
  assert.equal(r.name, "Exa – search", "double-encoded dash repaired");
});

test("tidy leaves clean text alone", () => {
  assert.equal(tidy("Web search — fast"), "Web search — fast");
  assert.equal(tidy(undefined), "");
});

test("search drops unpayable routes, puts verified first and honours the limit", async () => {
  const services = [
    raw({ id: "a", charge_rozo_verified: null }),
    raw({ id: "b", payment_enabled: false }),
    raw({ id: "c" }),
    raw({ id: "d", methods: {}, payment_hints: {} }), // nowhere to pay
  ];
  let asked = "";
  const fetchImpl = (async (url: string) => {
    asked = url;
    return new Response(JSON.stringify({ total: 4, services }), { status: 200 });
  }) as typeof fetch;
  const out = await searchServices({ query: "search", limit: 5 }, fetchImpl);
  assert.match(asked, /\/v1\/services\/search\?q=search/);
  assert.deepEqual(out.routes.map((r) => r.id), ["c", "a"]);
  const verified = await searchServices({ verifiedOnly: true }, fetchImpl);
  assert.deepEqual(verified.routes.map((r) => r.id), ["c"]);
});

// ---- budget request link ---------------------------------------------------------------

const agent = Keypair.random();
const request = (over: Partial<BudgetRequest> = {}): BudgetRequest => ({
  network: "pubnet",
  treasury: "CAP7SNLZZT6VGC7ULSBTGPIGTC5EBAFSDMA37YFYTIROJUTIYXTMANFK",
  agent: agent.publicKey(),
  limit: 50_000_000n,
  hours: 24,
  payees: [ROZO_PAY_TO],
  task: "Research three suppliers and summarise prices",
  expires: 1_900_000_000,
  ...over,
});

test("a budget request round-trips and verifies", () => {
  const params = encodeBudgetRequest(request(), agent);
  const back = decodeBudgetRequest(new URLSearchParams(params.toString()));
  assert.equal(back.verified, true);
  assert.deepEqual(back.request, request());
});

test("an edited link no longer verifies", () => {
  const params = encodeBudgetRequest(request(), agent);
  params.set("l", "500000000");
  const back = decodeBudgetRequest(params);
  assert.equal(back.verified, false);
  assert.match(back.problems.join(), /signature/);
});

test("a request signed by another key is refused at encoding", () => {
  assert.throws(() => encodeBudgetRequest(request(), Keypair.random()), /not the agent's/);
});

test("malformed requests are named, not signed", () => {
  assert.throws(() => encodeBudgetRequest(request({ payees: [] }), agent), /payees/);
  assert.throws(() => encodeBudgetRequest(request({ hours: 0 }), agent), /hours/);
  assert.throws(() => encodeBudgetRequest(request({ payees: ["nope"] }), agent), /not a Stellar address/);
  const bad = decodeBudgetRequest(new URLSearchParams({ v: "9" }));
  assert.equal(bad.verified, false);
});

// ---- call_service ----------------------------------------------------------------------

const TOKEN = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const TREASURY = "CAP7SNLZZT6VGC7ULSBTGPIGTC5EBAFSDMA37YFYTIROJUTIYXTMANFK";
const NOW = 1_800_000_000;

function ctx(over: Partial<ServerContext> = {}): ServerContext {
  return {
    net: { ...NETWORKS.pubnet, rpcUrl: "https://rpc.invalid" },
    treasuryId: TREASURY,
    credential: {
      version: 1,
      network: "pubnet",
      treasuryId: TREASURY,
      agentPublicKey: agent.publicKey(),
      agentSecret: agent.secret(),
      createdAt: "x",
    },
    cache: memoryCache(),
    exceptions: memoryExceptionStore(),
    purchases: memoryPurchaseLog(),
    now: () => NOW,
    serviceHosts: ["seller.example", "free.example", "metadata.internal"],
    unsettled: new Map(),
    ...over,
  };
}

function readClient(over: Record<string, unknown> = {}) {
  const r = (v: unknown) => Promise.resolve({ result: v });
  return {
    get_config: () => r({ admin: "GADMIN", agent: "GROOT", token: TOKEN, daily_limit: 1_000_000_000n, per_task_limit: 100_000_000n }),
    balance: () => r(5_000_000_000n),
    day_spent: () => r(0n),
    locked: () => r(0n),
    get_reputation_policy: () => r(undefined),
    is_paused: () => r(false),
    get_session: () => r({ agent: agent.publicKey(), valid_until: BigInt(NOW + 3600), limit: 500_000_000n, spent: 0n }),
    is_payee: ({ payee }: { payee: string }) => r(payee === ROZO_PAY_TO),
    ...over,
  } as never;
}

const requirement = (over: Record<string, unknown> = {}) => ({
  scheme: "exact",
  network: "stellar:pubnet",
  asset: TOKEN,
  amount: "100000",
  payTo: ROZO_PAY_TO,
  maxTimeoutSeconds: 60,
  extra: {},
  ...over,
});

/** A seller: 402 with the given options until a payment header arrives, then 200. */
function seller(accepts: Array<Record<string, unknown>>) {
  const seen: Array<Record<string, string>> = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    seen.push(headers);
    if (!headers["payment-signature"]) {
      const required = encodePaymentRequiredHeader({
        x402Version: 2,
        resource: { url: "https://seller.example/api", description: "", mimeType: "application/json" },
        accepts,
      } as never);
      return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": required } });
    }
    const settled = encodePaymentResponseHeader({
      success: true,
      transaction: "abc123",
      network: "stellar:pubnet",
      payer: agent.publicKey(),
    } as never);
    return new Response(JSON.stringify({ answer: 42 }), {
      status: 200,
      headers: { "content-type": "application/json", "PAYMENT-RESPONSE": settled },
    });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

const deps = (fetchImpl: typeof fetch, over: Record<string, unknown> = {}) => ({
  fetchImpl,
  readClient: readClient(over),
  floatBalance: async () => 1_000_000n,
  sign: async () => ({ "PAYMENT-SIGNATURE": "signed" }),
  resolve: async () => ["93.184.216.34"], // a public address; no DNS in tests
});

test("call_service pays an approved payee within every bound and returns the answer", async () => {
  const s = seller([requirement()]);
  const out = await callService(ctx(), { url: "https://seller.example/api", maxPrice: 200_000n }, deps(s.fetchImpl));
  assert.ok(!("refused" in out));
  assert.equal(out.paid, true);
  assert.equal(out.txHash, "abc123");
  assert.equal(out.amount, 100_000n);
  assert.deepEqual(out.body, { answer: 42 });
  assert.equal(s.seen.length, 2);
});

test("a response without a 402 passes through unpaid", async () => {
  const fetchImpl = (async () => new Response("free", { status: 200 })) as unknown as typeof fetch;
  const out = await callService(ctx(), { url: "https://free.example", maxPrice: 1n }, deps(fetchImpl));
  assert.equal(out.paid, false);
  assert.equal(out.status, 200);
});

test("nothing is signed for a payee the treasury does not approve", async () => {
  const s = seller([requirement({ payTo: "GAKSMBN6TRMF4M4PL3FJSDMQRD6XBQCJFLECLYTNAXZYMRIWXT6ADYTC" })]);
  let signed = false;
  const out = await callService(ctx(), { url: "https://seller.example/api", maxPrice: 200_000n }, {
    ...deps(s.fetchImpl),
    sign: async () => {
      signed = true;
      return {};
    },
  });
  assert.equal(signed, false);
  assert.ok("refused" in out);
  assert.match(out.options[0].problems.join(), /not a payee the treasury approves/);
  assert.equal(s.seen.length, 1);
});

test("price above maxPrice, the per-payment cap or the float is refused", async () => {
  const s = seller([requirement({ amount: "300000" })]);
  const out = await callService(ctx(), { url: "https://seller.example/api", maxPrice: 200_000n }, {
    ...deps(s.fetchImpl),
    floatBalance: async () => 250_000n,
  });
  assert.ok("refused" in out);
  const problems = out.options[0].problems.join(" | ");
  assert.match(problems, /above maxPrice/);
  assert.match(problems, /more than the float holds/);
});

test("the wrong asset or network is refused", async () => {
  const s = seller([requirement({ asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", network: "stellar:testnet" })]);
  const out = await callService(ctx(), { url: "https://seller.example/api", maxPrice: 200_000n }, deps(s.fetchImpl));
  assert.ok("refused" in out);
  assert.match(out.options[0].problems.join(), /network/);
  assert.match(out.options[0].problems.join(), /asset/);
});

test("under a task budget, only the payees it names can be paid", async () => {
  const s = seller([requirement()]);
  const scoped = {
    this_month: () => Promise.resolve({ result: 24_321 }),
    monthly_limit: () => Promise.resolve({ result: 0n }),
    month_spent: () => Promise.resolve({ result: 0n }),
    deposit_cap: () => Promise.resolve({ result: 0n }),
    session_payees: () => Promise.resolve({ result: ["GCB32DDRIOE24JJ66IYB2V44UAYYPRA4UIPGQKM2OINHDK2NPW365XTA"] }),
  };
  const out = await callService(ctx(), { url: "https://seller.example/api", maxPrice: 200_000n }, deps(s.fetchImpl, scoped));
  assert.ok("refused" in out);
  assert.match(out.options[0].problems.join(), /outside the task budget/);
});

test("of several acceptable options the cheapest is the one signed", async () => {
  const s = seller([requirement({ amount: "150000" }), requirement({ amount: "90000" })]);
  let picked = "";
  const out = await callService(ctx(), { url: "https://seller.example/api", maxPrice: 200_000n }, {
    ...deps(s.fetchImpl),
    sign: async (_pr, chosen) => {
      picked = chosen.amount;
      return { "PAYMENT-SIGNATURE": "signed" };
    },
  });
  assert.equal(picked, "90000");
  assert.ok(!("refused" in out) && out.paid);
});

// ---- the float is spent only while the owner's permission stands (fifth review, F2) -------

/** Runs one call against a seller and reports whether anything was signed. */
async function attempt(over: Record<string, unknown>, context: ServerContext = ctx()) {
  const s = seller([requirement()]);
  let signed = false;
  const out = await callService(context, { url: "https://seller.example/api", maxPrice: 200_000n }, {
    ...deps(s.fetchImpl, over),
    sign: async () => {
      signed = true;
      return { "PAYMENT-SIGNATURE": "signed" };
    },
  });
  return { out, signed, requests: s.seen.length };
}

test("a paused treasury stops the float: nothing is signed", async () => {
  const { out, signed, requests } = await attempt({ is_paused: () => Promise.resolve({ result: true }) });
  assert.equal(signed, false);
  assert.equal(requests, 1);
  assert.ok("refused" in out);
  assert.match(out.message, /paused by its owner/);
  assert.match(out.nextStep ?? "", /sweep_float/);
});

test("a revoked Leash stops the float", async () => {
  const { out, signed } = await attempt({ get_session: () => Promise.resolve({ result: undefined }) });
  assert.equal(signed, false);
  assert.ok("refused" in out);
  assert.match(out.message, /ended, or the owner revoked it/);
});

test("a Leash past its deadline stops the float, and does not widen who may be paid", async () => {
  // The expired budget named another payee only. Before the fix an expired session read as
  // "no task budget", so the float could suddenly pay every approved payee.
  const { out, signed } = await attempt({
    get_session: () => Promise.resolve({ result: { agent: agent.publicKey(), valid_until: BigInt(NOW - 1), limit: 500_000_000n, spent: 0n } }),
    this_month: () => Promise.resolve({ result: 24_321 }),
    monthly_limit: () => Promise.resolve({ result: 0n }),
    month_spent: () => Promise.resolve({ result: 0n }),
    deposit_cap: () => Promise.resolve({ result: 0n }),
    session_payees: () => Promise.resolve({ result: ["GCB32DDRIOE24JJ66IYB2V44UAYYPRA4UIPGQKM2OINHDK2NPW365XTA"] }),
  });
  assert.equal(signed, false);
  assert.ok("refused" in out);
});

test("a Leash that belongs to another agent stops the float", async () => {
  const other = Keypair.random().publicKey();
  const { out, signed } = await attempt({
    get_session: () => Promise.resolve({ result: { agent: other, valid_until: BigInt(NOW + 3600), limit: 500_000_000n, spent: 0n } }),
  });
  assert.equal(signed, false);
  assert.ok("refused" in out);
  assert.match(out.message, /another agent/);
});

test("a pause state that could not be read is not taken for 'not paused'", async () => {
  const { out, signed } = await attempt({ is_paused: () => Promise.reject(new Error("rpc down")) });
  assert.equal(signed, false);
  assert.ok("refused" in out);
  assert.match(out.message, /could not be read/);
});

test("the treasury's own agent needs no Leash to spend its float", async () => {
  const { out, signed } = await attempt({
    get_config: () => Promise.resolve({ result: { admin: "GADMIN", agent: agent.publicKey(), token: TOKEN, daily_limit: 1_000_000_000n, per_task_limit: 100_000_000n } }),
    get_session: () => Promise.resolve({ result: undefined }),
  });
  assert.equal(signed, true);
  assert.ok(!("refused" in out) && out.paid);
});

// ---- bounds the model cannot move (fifth review, F4) -------------------------------------

test("a host the operator has not allowed is never called", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response("{}");
  }) as unknown as typeof fetch;
  await assert.rejects(
    callService(ctx(), { url: "https://attacker.example/api", maxPrice: 200_000n }, deps(fetchImpl)),
    /not a host this agent may call/,
  );
  assert.equal(called, false);
});

test("with no hosts named, only the service catalog's host is called", async () => {
  const s = seller([requirement()]);
  const bare = ctx({ serviceHosts: undefined });
  await assert.rejects(callService(bare, { url: "https://seller.example/api", maxPrice: 200_000n }, deps(s.fetchImpl)), /not a host/);
  const out = await callService(bare, { url: "https://apiserver.mpprouter.dev/v1/services/exa/search", maxPrice: 200_000n }, deps(s.fetchImpl));
  assert.ok(!("refused" in out) && out.paid);
});

test("an operator who opts out with * may call any host", async () => {
  const s = seller([requirement()]);
  const out = await callService(ctx({ serviceHosts: null }), { url: "https://anything.example/x", maxPrice: 200_000n }, deps(s.fetchImpl));
  assert.ok(!("refused" in out) && out.paid);
});

test("maxPrice from the model cannot lift a call above the operator's ceiling", async () => {
  // 2 units asked by the service, 5 offered by the model, 100 allowed per payment on chain
  // and 50 in the float: only the ceiling (1 unit by default) stands in the way.
  const s = seller([requirement({ amount: "20000000" })]);
  const big = { ...deps(s.fetchImpl), floatBalance: async () => 500_000_000n };
  const out = await callService(ctx(), { url: "https://seller.example/api", maxPrice: 50_000_000n }, big);
  assert.ok("refused" in out);
  assert.match(out.options[0].problems.join(), /per-call ceiling/);

  const raised = await callService(ctx({ maxCallPrice: 30_000_000n }), { url: "https://seller.example/api", maxPrice: 50_000_000n }, big);
  assert.ok(!("refused" in raised) && raised.paid);
});

test("the operator's bounds are read from the environment, and a typo stops the server", async () => {
  const { maxCallPriceFromEnv, serviceHostsFromEnv } = await import("./server.js");
  assert.equal(maxCallPriceFromEnv({}), undefined);
  assert.equal(maxCallPriceFromEnv({ EUNOMIA_MAX_PRICE: " 0.25 " }), 2_500_000n);
  assert.throws(() => maxCallPriceFromEnv({ EUNOMIA_MAX_PRICE: "25 cents" }), /not an amount/);
  assert.throws(() => maxCallPriceFromEnv({ EUNOMIA_MAX_PRICE: "0" }), /above zero/);
  assert.equal(serviceHostsFromEnv({}), undefined);
  assert.equal(serviceHostsFromEnv({ EUNOMIA_SERVICE_HOSTS: "*" }), null);
  assert.deepEqual(serviceHostsFromEnv({ EUNOMIA_SERVICE_HOSTS: "API.Example.com, apiserver.mpprouter.dev" }), ["api.example.com", "apiserver.mpprouter.dev"]);
  assert.throws(() => serviceHostsFromEnv({ EUNOMIA_SERVICE_HOSTS: "https://api.example.com/x" }), /not a host name/);
});

// ---- a signed payment does not outlive the call by much (fifth review, F5) ----------------

test("a service asking for a payment that stays collectable too long is refused", async () => {
  for (const window of [100_000, 301, 0, 12.5, undefined, "300"]) {
    const s = seller([requirement({ maxTimeoutSeconds: window })]);
    const out = await callService(ctx(), { url: "https://seller.example/api", maxPrice: 200_000n }, deps(s.fetchImpl));
    assert.ok("refused" in out, `window ${String(window)}`);
    assert.match(out.options[0].problems.join(), /stay collectable/);
  }
  const s = seller([requirement({ maxTimeoutSeconds: 300 })]);
  const ok = await callService(ctx(), { url: "https://seller.example/api", maxPrice: 200_000n }, deps(s.fetchImpl));
  assert.ok(!("refused" in ok) && ok.paid);
});

/** A seller that takes the payment header and answers without reporting a settlement. */
function silentSeller() {
  let signedRequests = 0;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    if (!headers["payment-signature"]) {
      const required = encodePaymentRequiredHeader({
        x402Version: 2,
        resource: { url: "https://seller.example/api", description: "", mimeType: "application/json" },
        accepts: [requirement()],
      } as never);
      return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": required } });
    }
    signedRequests++;
    return new Response(JSON.stringify({ error: "try again" }), { status: 500 });
  }) as typeof fetch;
  return { fetchImpl, signed: () => signedRequests };
}

test("a payment handed over without a settlement is not followed by another", async () => {
  const s = silentSeller();
  const context = ctx();
  const first = await callService(context, { url: "https://seller.example/api", maxPrice: 200_000n }, deps(s.fetchImpl));
  assert.ok(!("refused" in first));
  assert.equal(first.paid, false);
  // 60 s the service asked for, plus the slack for the ledger estimate
  assert.equal(first.collectableUntil, NOW + 60 + 60);

  // The model sees "not paid" and tries again: nothing more is signed.
  const again = await callService(context, { url: "https://seller.example/api", maxPrice: 200_000n }, deps(s.fetchImpl));
  assert.ok("refused" in again);
  assert.match(again.options[0].problems.join(), /can still be collected/);
  assert.equal(s.signed(), 1);

  // Once the first can no longer be collected, the service may be paid again.
  const later = { ...context, now: () => NOW + 121 };
  const third = await callService(later, { url: "https://seller.example/api", maxPrice: 200_000n }, deps(s.fetchImpl));
  assert.ok(!("refused" in third));
  assert.equal(s.signed(), 2);
});

test("a settled payment leaves nothing to wait for", async () => {
  const s = seller([requirement()]);
  const context = ctx();
  const first = await callService(context, { url: "https://seller.example/api", maxPrice: 200_000n }, deps(s.fetchImpl));
  assert.ok(!("refused" in first) && first.paid && first.collectableUntil === undefined);
  const second = await callService(context, { url: "https://seller.example/api", maxPrice: 200_000n }, deps(s.fetchImpl));
  assert.ok(!("refused" in second) && second.paid);
});

// ---- where call_service may go -------------------------------------------------------

test("only https to a public host is called", async () => {
  const { urlProblem, isPrivateAddress } = await import("./call.js");
  const publicHost = async () => ["104.18.1.1"];
  assert.equal(await urlProblem("https://apiserver.mpprouter.dev/v1/x", publicHost), null);
  assert.match((await urlProblem("http://apiserver.mpprouter.dev/v1/x", publicHost)) ?? "", /https only/);
  assert.match((await urlProblem("https://169.254.169.254/latest/meta-data", publicHost)) ?? "", /private/);
  assert.match((await urlProblem("https://localhost:8080/", publicHost)) ?? "", /local/);
  assert.match((await urlProblem("https://evil.example/", async () => ["10.0.0.5"])) ?? "", /private/);
  assert.match((await urlProblem("https://[::1]/", publicHost)) ?? "", /private/);
  assert.match((await urlProblem("file:///etc/passwd", publicHost)) ?? "", /not allowed/);
  assert.match((await urlProblem("http://127.0.0.1:4021/search", publicHost)) ?? "", /https only/);
  assert.ok(isPrivateAddress("192.168.1.10") && isPrivateAddress("100.64.0.1") && isPrivateAddress("::ffff:127.0.0.1"));
  assert.ok(!isPrivateAddress("8.8.8.8"));
});

test("an IPv4 address dressed as IPv6 is judged as the IPv4 address", async () => {
  const { urlProblem, isPrivateAddress } = await import("./call.js");
  const publicHost = async () => ["104.18.1.1"];
  // the URL parser rewrites [::ffff:127.0.0.1] to [::ffff:7f00:1]
  for (const url of [
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:7f00:1]/",
    "https://[::ffff:a9fe:a9fe]/latest/meta-data",
    "https://[::7f00:1]/",
    "https://[64:ff9b::7f00:1]/",
    "https://[2002:7f00:1::]/",
    "https://[::]/",
  ]) {
    assert.match((await urlProblem(url, publicHost)) ?? "", /private/, url);
  }
  for (const ip of ["::ffff:10.0.0.1", "0:0:0:0:0:ffff:c0a8:0101", "fe80::1", "fec0::1", "fd00::1", "ff02::1", "2001:0:4136:e378::1"]) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ["::ffff:8.8.8.8", "64:ff9b::808:808", "2606:4700::1111", "2001:4860:4860::8888"]) {
    assert.ok(!isPrivateAddress(ip), ip);
  }
  assert.match((await urlProblem("https://evil.example/", async () => ["::ffff:7f00:1"])) ?? "", /private/);
});

test("on mainnet the address is checked again when the connection is made (DNS rebinding)", async () => {
  const { pinnedFetch } = await import("./call.js");
  // urlProblem never sees this host here: the connection itself must refuse it
  await assert.rejects(pinnedFetch("https://localhost:9/"), /private/);
});

test("call_service refuses a private target before any request is made", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response("{}");
  }) as unknown as typeof fetch;
  await assert.rejects(
    callService(ctx(), { url: "https://metadata.internal/", maxPrice: 1n }, { ...deps(fetchImpl), resolve: async () => ["169.254.169.254"] }),
    /refusing to call/,
  );
  assert.equal(called, false);
});
