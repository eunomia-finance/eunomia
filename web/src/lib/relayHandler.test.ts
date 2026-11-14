import { describe, expect, it, vi } from "vitest";
import { Account, Address, Contract, Keypair, Operation, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { clientKey, feeGate, handleRelay, Refused, relayNetwork, SAFETY_CALLS_PER_WALLET, xlmEnv, type RelayRpc } from "./relayHandler";
import { TREASURY_WASM_HASH } from "./treasuryWasm";

const MAINNET = "Public Global Stellar Network ; September 2015";
const MAINNET_NATIVE = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
const FACTORY = "CAP7SNLZZT6VGC7ULSBTGPIGTC5EBAFSDMA37YFYTIROJUTIYXTMANFK";
const WALLET = "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ";
const TREASURY = "CDVCLLGGMV6MJSJZYCPJI36BG6SGKSWVD44PORHVVFRBTSACEABBYNJ2";
const WALLET_WASM = "fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0";

/** A factory call signed by WALLET: admitted by address, no network needed to classify. */
const factoryCall = () =>
  new Contract(FACTORY)
    .call("create", new Address(WALLET).toScVal(), nativeToScVal(1n, { type: "i128" }))
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .toXDR("base64");

const walletEntry = () =>
  new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(WALLET).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 100,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: new Address(FACTORY).toScAddress(), functionName: "create", args: [] }),
      ),
      subInvocations: [],
    }),
  }).toXDR("base64");

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://eunomia.finance/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

/** A relay configured the way the deployment is, and the guards the worker binds. */
const ENV = {
  RELAY_RPC_URL: "https://rpc.example",
  RELAY_FACTORY_ID: FACTORY,
  RELAY_DAILY_BUDGET_XLM: "50",
};
const pass = () => ({ limit: vi.fn().mockResolvedValue({ success: true }) });
const openBudget = () => ({ reserve: vi.fn().mockResolvedValue(true), release: vi.fn().mockResolvedValue(undefined) });
const guards = () => ({ limiter: pass(), walletLimiter: pass(), budget: openBudget() });

/** An RPC that simulates and prices anything, and — unless told otherwise — refuses to take
 *  the transaction in, so a test ends at the send without waiting on a ledger. */
const rpcMock = (over: Record<string, unknown> = {}) =>
  ({
    getAccount: vi.fn().mockResolvedValue({ sequenceNumber: () => "42" }),
    getAccountEntry: vi.fn().mockResolvedValue({ balance: () => ({ toString: () => "250000000" }) }),
    // every contract asked about runs the treasury code
    getContractData: vi.fn().mockResolvedValue({
      val: {
        contractData: () => ({
          val: () => ({
            instance: () => ({
              executable: () => ({
                switch: () => ({ name: "contractExecutableWasm" }),
                wasmHash: () => Buffer.from(TREASURY_WASM_HASH, "hex"),
              }),
            }),
          }),
        }),
      },
    }),
    simulateTransaction: vi.fn().mockResolvedValue({
      transactionData: {
        build: () =>
          new xdr.SorobanTransactionData({
            ext: new xdr.SorobanTransactionDataExt(0),
            resources: new xdr.SorobanResources({
              footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
              instructions: 1000,
              diskReadBytes: 0,
              writeBytes: 0,
            }),
            resourceFee: xdr.Int64.fromString("25102"),
          }),
      },
    }),
    sendTransaction: vi.fn().mockResolvedValue({ hash: "HASH", status: "ERROR", errorResult: {} }),
    getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
    ...over,
  }) as unknown as RelayRpc;

/** A call on a treasury, signed by WALLET. */
const treasuryCall = (fn: string) =>
  new Contract(TREASURY).call(fn).body().invokeHostFunctionOp().hostFunction().toXDR("base64");

/** A transaction envelope the way passkey-kit hands one back: built on the deployer, one
 *  operation, signed by the deployer. */
function envelope(
  op: xdr.Operation,
  opts: { sign?: boolean; passphrase?: string; resourceFee?: string; extra?: xdr.Operation } = {},
): string {
  const deployer = Keypair.random();
  const builder = new TransactionBuilder(new Account(deployer.publicKey(), "7"), {
    fee: "100",
    networkPassphrase: opts.passphrase ?? MAINNET,
  }).addOperation(op);
  if (opts.extra) builder.addOperation(opts.extra);
  const tx = builder.setTimeout(60).build();
  if (opts.sign !== false) tx.sign(deployer);
  return tx.toXDR();
}

const walletDeploy = (wasm = WALLET_WASM) =>
  Operation.createCustomContract({
    address: new Address(WALLET),
    wasmHash: Buffer.from(wasm, "hex"),
    salt: Buffer.alloc(32, 3),
    constructorArgs: [],
  });

describe("relayNetwork", () => {
  it("is mainnet, and admits only the configured factory — never native XLM", () => {
    const n = relayNetwork(ENV);
    expect(n.name).toBe("pubnet");
    expect(n.passphrase).toMatch(/^Public Global/);
    expect(n.contracts).toEqual([FACTORY]);
    expect(n.contracts).not.toContain(MAINNET_NATIVE);
  });

  it("refuses a relay with no RPC, and any network but pubnet", () => {
    expect(() => relayNetwork({ RELAY_DAILY_BUDGET_XLM: "50" })).toThrow(/RELAY_RPC_URL/);
    expect(() => relayNetwork({ ...ENV, RELAY_NETWORK: "testnet" })).toThrow(/unknown/);
    expect(() => relayNetwork({ ...ENV, RELAY_NETWORK: "futurenet" })).toThrow(/unknown/);
  });

  it("refuses a relay with no daily budget, and keeps a floor under the fee account", () => {
    const base = { RELAY_RPC_URL: "https://rpc.example" };
    expect(() => relayNetwork(base)).toThrow(/RELAY_DAILY_BUDGET_XLM/);
    const n = relayNetwork({ ...base, RELAY_DAILY_BUDGET_XLM: "50" });
    expect(n.dailyBudget).toBe(500_000_000n);
    expect(n.minBalance).toBe(50_000_000n);
    expect(n.maxTxFee).toBe(10_000_000n);
  });
});

describe("xlmEnv", () => {
  it("reads XLM to the stroop and falls back only when unset", () => {
    expect(xlmEnv("X", "12.5", null)).toBe(125_000_000n);
    expect(xlmEnv("X", "0.0000001", null)).toBe(1n);
    expect(xlmEnv("X", undefined, 7n)).toBe(7n);
    expect(xlmEnv("X", " ​", 7n)).toBe(7n);
  });

  it("throws on a typo or zero rather than reading it as no limit", () => {
    expect(() => xlmEnv("X", "50 XLM", null)).toThrow(/not an XLM amount/);
    expect(() => xlmEnv("X", "-5", null)).toThrow(/not an XLM amount/);
    expect(() => xlmEnv("X", "1.12345678", null)).toThrow(/not an XLM amount/);
    expect(() => xlmEnv("X", "0", null)).toThrow(/above zero/);
  });
});

describe("feeGate", () => {
  const net = { maxTxFee: 10_000_000n, minBalance: 50_000_000n, dailyBudget: 500_000_000n };

  it("lets a priced transaction through, charges it to the day, and can give the charge back", async () => {
    const budget = openBudget();
    const release = await feeGate(net, budget, async () => 100_000_000n)(4_200_000n);
    expect(budget.reserve).toHaveBeenCalledWith(4_200_000n, 500_000_000n);
    expect(budget.release).not.toHaveBeenCalled();

    await release();
    expect(budget.release).toHaveBeenCalledWith(4_200_000n);
  });

  it("refuses a transaction dearer than one call should be, before touching anything", async () => {
    const budget = openBudget();
    const balance = vi.fn();
    await expect(feeGate(net, budget, balance)(10_000_001n)).rejects.toMatchObject({ status: 403 });
    expect(balance).not.toHaveBeenCalled();
    expect(budget.reserve).not.toHaveBeenCalled();
  });

  it("stops at the floor without spending budget", async () => {
    const budget = openBudget();
    await expect(feeGate(net, budget, async () => 52_000_000n)(4_200_000n)).rejects.toBeInstanceOf(Refused);
    expect(budget.reserve).not.toHaveBeenCalled();
  });

  it("stops when the day's budget is spent, or the counter cannot be reached", async () => {
    const spent = { reserve: vi.fn().mockResolvedValue(false), release: vi.fn() };
    await expect(feeGate(net, spent, async () => 100_000_000n)(1n)).rejects.toMatchObject({ status: 503 });
    await expect(feeGate(net, undefined, async () => 100_000_000n)(1n)).rejects.toMatchObject({ status: 503 });
  });

  describe("the reserve for exit calls (fifth review, F1)", () => {
    const withReserve = { ...net, safetyBudget: 50_000_000n };
    /** A budget whose day is spent: only lanes are still open. */
    const daySpent = (lanes: (lane: string) => boolean = () => true) => ({
      reserve: vi.fn(async (_s: bigint, _l: bigint, lane?: string) => (lane ? lanes(lane) : false)),
      release: vi.fn().mockResolvedValue(undefined),
    });

    it("pays for an exit call from the reserve once the day is spent", async () => {
      const budget = daySpent();
      const release = await feeGate(withReserve, budget, async () => 100_000_000n, { wallets: [WALLET] })(4_200_000n);

      expect(budget.reserve).toHaveBeenCalledWith(1n, SAFETY_CALLS_PER_WALLET, `safety:${WALLET}`);
      expect(budget.reserve).toHaveBeenCalledWith(4_200_000n, 50_000_000n, "safety");
      await release();
      expect(budget.release).toHaveBeenCalledWith(4_200_000n, "safety");
    });

    it("does not open the reserve to anything else", async () => {
      const budget = daySpent();
      await expect(feeGate(withReserve, budget, async () => 100_000_000n)(4_200_000n)).rejects.toMatchObject({ status: 503 });
      // An exit call nobody signed has no wallet to count against, so it gets nothing either.
      await expect(
        feeGate(withReserve, budget, async () => 100_000_000n, { wallets: [] })(4_200_000n),
      ).rejects.toMatchObject({ status: 503 });
      expect(budget.reserve.mock.calls.every(([, , lane]) => lane === undefined)).toBe(true);
    });

    it("stops a wallet that has drawn on the reserve too often, and stops when the reserve is spent", async () => {
      const greedy = daySpent((lane) => lane === "safety");
      await expect(
        feeGate(withReserve, greedy, async () => 100_000_000n, { wallets: [WALLET] })(1n),
      ).rejects.toMatchObject({ status: 503 });
      expect(greedy.reserve).not.toHaveBeenCalledWith(1n, 50_000_000n, "safety");

      const empty = daySpent((lane) => lane !== "safety");
      await expect(
        feeGate(withReserve, empty, async () => 100_000_000n, { wallets: [WALLET] })(1n),
      ).rejects.toMatchObject({ status: 503 });
    });

    it("reaches below the floor everything else stops at, but not to the bottom of the account", async () => {
      // A day's budget that was really spent leaves the account at its floor (5 XLM here).
      const atFloor = daySpent();
      await expect(
        feeGate(withReserve, atFloor, async () => 50_000_000n, { wallets: [WALLET] })(4_200_000n),
      ).resolves.toBeTypeOf("function");
      await expect(feeGate(withReserve, atFloor, async () => 50_000_000n)(4_200_000n)).rejects.toMatchObject({ status: 503 });

      const nearlyEmpty = daySpent();
      await expect(
        feeGate(withReserve, nearlyEmpty, async () => 24_000_000n, { wallets: [WALLET] })(4_200_000n),
      ).rejects.toMatchObject({ status: 503 });
      expect(nearlyEmpty.reserve).not.toHaveBeenCalled();
    });
  });
});

describe("handleRelay gates before it spends", () => {
  const secret = Keypair.random().secret();
  const env = { ...ENV, RELAY_SECRET: secret };

  it("answers only POST", async () => {
    const res = await handleRelay(new Request("https://x/api/relay"), env, guards());
    expect(res.status).toBe(405);
  });

  it("will not run without the rate limiters and the daily budget (M2)", async () => {
    const ok = pass();
    const budget = openBudget();
    expect((await handleRelay(post({ func: "x", auth: [] }), env)).status).toBe(503);
    expect((await handleRelay(post({ func: "x", auth: [] }), env, { limiter: ok, budget })).status).toBe(503);
    expect((await handleRelay(post({ func: "x", auth: [] }), env, { limiter: ok, walletLimiter: ok })).status).toBe(503);
    // With all three it gets as far as admission, which refuses this garbage host function.
    expect((await handleRelay(post({ func: "AAAA", auth: [] }), env, { limiter: ok, walletLimiter: ok, budget })).status).toBe(403);
  });

  it("turns a wallet away once its own limit is reached, whatever IP it asks from", async () => {
    const walletLimit = vi.fn().mockResolvedValue({ success: false });
    const g = { ...guards(), walletLimiter: { limit: walletLimit }, server: rpcMock() };
    const res = await handleRelay(post({ func: factoryCall(), auth: [walletEntry()] }), env, g);
    expect(res.status).toBe(429);
    expect(walletLimit).toHaveBeenCalledWith({ key: WALLET });
    expect(g.budget.reserve).not.toHaveBeenCalled();
  });

  it("does not count a call against a wallet until the chain has accepted its signature (F1)", async () => {
    // Anyone can name a wallet in an entry they did not sign. Simulation refuses it, and the
    // wallet's own allowance must be untouched.
    const walletLimit = vi.fn().mockResolvedValue({ success: true });
    const server = rpcMock({ simulateTransaction: vi.fn().mockResolvedValue({ error: "HostError: auth invalid" }) });
    const g = { ...guards(), walletLimiter: { limit: walletLimit }, server };
    const res = await handleRelay(post({ func: factoryCall(), auth: [walletEntry()] }), env, g);
    expect(res.status).toBe(502);
    expect(walletLimit).not.toHaveBeenCalled();
    expect(g.budget.reserve).not.toHaveBeenCalled();
  });

  it("does not pay for a call nobody had to sign (F1)", async () => {
    const g = { ...guards(), server: rpcMock() };
    const res = await handleRelay(post({ func: treasuryCall("get_config"), auth: [] }), env, g);
    expect(res.status).toBe(403);
    expect(g.budget.reserve).not.toHaveBeenCalled();
  });

  it("gives the charge back when the network refuses the transaction (F1)", async () => {
    const g = { ...guards(), server: rpcMock() };
    const res = await handleRelay(post({ func: factoryCall(), auth: [walletEntry()] }), env, g);
    expect(res.status).toBe(502);
    const [charged] = g.budget.reserve.mock.calls[0] as [bigint];
    expect(g.budget.release).toHaveBeenCalledWith(charged);
  });

  it("keeps the charge for a transaction the network took in", async () => {
    const server = rpcMock({
      sendTransaction: vi.fn().mockResolvedValue({ hash: "HASH", status: "PENDING" }),
      getTransaction: vi.fn().mockResolvedValue({ status: "FAILED" }),
    });
    const g = { ...guards(), server };
    const res = await handleRelay(post({ func: factoryCall(), auth: [walletEntry()] }), env, g);
    expect(res.status).toBe(502);
    expect(g.budget.reserve).toHaveBeenCalledTimes(1);
    expect(g.budget.release).not.toHaveBeenCalled();
  });

  describe("an owner's exit calls when the day's budget is gone (F1)", () => {
    /** The day is spent; the lanes are open. */
    const spentDay = () => ({
      reserve: vi.fn(async (_s: bigint, _l: bigint, lane?: string) => lane !== undefined),
      release: vi.fn().mockResolvedValue(undefined),
    });

    it("still relays revoke, pause and withdraw on a treasury", async () => {
      for (const fn of ["revoke_session", "set_paused", "admin_withdraw", "admin_cancel_escrow", "remove_payee"]) {
        const g = { ...guards(), budget: spentDay(), server: rpcMock() };
        await handleRelay(post({ func: treasuryCall(fn), auth: [walletEntry()] }), env, g);
        expect(g.budget.reserve, fn).toHaveBeenCalledWith(expect.any(BigInt), 50_000_000n, "safety");
        expect(g.server.sendTransaction, fn).toHaveBeenCalledTimes(1);
      }
    });

    it("refuses everything else until the day turns", async () => {
      for (const func of [treasuryCall("pay"), treasuryCall("set_session"), factoryCall()]) {
        const g = { ...guards(), budget: spentDay(), server: rpcMock() };
        const res = await handleRelay(post({ func, auth: [walletEntry()] }), env, g);
        expect(res.status).toBe(503);
        expect(g.server.sendTransaction).not.toHaveBeenCalled();
      }
    });
  });

  describe("a signed envelope is a wallet deployment or nothing (F1)", () => {
    const envWallet = { ...env, RELAY_ALLOWED_WASM: WALLET_WASM };
    const run = async (xdrEnvelope: string, e: typeof envWallet = envWallet) => {
      const g = { ...guards(), server: rpcMock() };
      const res = await handleRelay(post({ xdr: xdrEnvelope }), e, g);
      return { res, g };
    };

    it("wraps passkey-kit's signed wallet deployment and sends it", async () => {
      const { g } = await run(envelope(walletDeploy()));
      expect(g.budget.reserve).toHaveBeenCalledTimes(1);
      expect(g.server.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it("refuses a call to the factory dressed as an envelope — the attack that emptied the day", async () => {
      const call = new Contract(FACTORY).call("create", new Address(WALLET).toScVal());
      const { res, g } = await run(envelope(call));
      expect(res.status).toBe(403);
      expect(g.budget.reserve).not.toHaveBeenCalled();
      expect(g.server.sendTransaction).not.toHaveBeenCalled();
    });

    it("refuses a deployment nobody signed, or signed for another network", async () => {
      expect((await run(envelope(walletDeploy(), { sign: false }))).res.status).toBe(403);
      expect((await run(envelope(walletDeploy(), { passphrase: "Test SDF Network ; September 2015" }))).res.status).toBe(403);
    });

    it("refuses a deployment of anything but the wallet — a treasury goes through the factory", async () => {
      expect((await run(envelope(walletDeploy(TREASURY_WASM_HASH)))).res.status).toBe(403);
      expect((await run(envelope(walletDeploy("ab".repeat(32))))).res.status).toBe(403);
    });

    it("refuses an envelope when no wallet code is configured", async () => {
      expect((await run(envelope(walletDeploy()), env as typeof envWallet)).res.status).toBe(403);
    });

    it("refuses a second operation riding along", async () => {
      const { res, g } = await run(envelope(walletDeploy(), { extra: Operation.bumpSequence({ bumpTo: "9" }) }));
      expect(res.status).toBe(403);
      expect(g.budget.reserve).not.toHaveBeenCalled();
    });
  });

  it("turns a caller away once the limiter says so, keyed by their address", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const res = await handleRelay(post({ func: "x", auth: [] }, { "cf-connecting-ip": "203.0.113.7" }), env, { ...guards(), limiter: { limit } });
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
  });

  it("says it is unconfigured without a fee key, and rejects malformed bodies", async () => {
    expect((await handleRelay(post({ func: "x", auth: [] }), ENV, guards())).status).toBe(503);
    expect((await handleRelay(post({ nope: 1 }), env, guards())).status).toBe(400);
  });

  it("refuses a host function it cannot classify, without touching the network", async () => {
    const res = await handleRelay(post({ func: "AAAA", auth: [] }), env, guards());
    expect(res.status).toBe(403);
  });
});

describe("clientKey", () => {
  it("prefers the edge's own header over anything the client could forward", () => {
    const req = new Request("https://x", { headers: { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9, 8.8.8.8" } });
    expect(clientKey(req)).toBe("1.1.1.1");
    expect(clientKey(new Request("https://x", { headers: { "x-forwarded-for": "9.9.9.9, 8.8.8.8" } }))).toBe("9.9.9.9");
  });
});
