import { describe, it, expect, vi } from "vitest";
import type { Anchor } from "./discover";
import { AnchorError } from "./http";
import { firmQuote, indicativePrice } from "./quotes";
import {
  getTransfer,
  requestDeposit,
  requestWithdraw,
  setPayoutIban,
  simulateBankTransfer,
  waitForTransfer,
} from "./transfers";

const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const anchor: Anchor = {
  homeDomain: "tr-mock-anchor.fly.dev",
  networkPassphrase: "Test SDF Network ; September 2015",
  signingKey: "GDXYO6FJCNXZEWGXD54GT76FGFYLOLSOGSOJLNQ6WGHCGEQPO7NTE73M",
  webAuth: "https://tr-mock-anchor.fly.dev/auth",
  transfer: "https://tr-mock-anchor.fly.dev/sep6",
  kyc: "https://tr-mock-anchor.fly.dev/sep12",
  quote: "https://tr-mock-anchor.fly.dev/sep38",
  assetCode: "USDC",
  assetIssuer: ISSUER,
};

const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }) as Response;
const once = (status: number, body: unknown) => vi.fn().mockResolvedValue(res(status, body));
const asked = (f: ReturnType<typeof vi.fn>, call = 0) => ({
  url: new URL(f.mock.calls[call][0] as string),
  init: f.mock.calls[call][1] as RequestInit,
});

// Bodies below are the mock anchor's real answers, captured live on 2026-09-18.
const rawQuote = {
  id: "qt_7c333u1qiv9s6xk6wd2m",
  expires_at: "2026-09-18T16:31:48.097Z",
  total_price: "49.0290051",
  price: "48.785078",
  sell_amount: "100.00",
  buy_amount: "2.0396090",
  fee: { total: "0.50", asset: "iso4217:TRY" },
};

describe("quotes", () => {
  it("previews a deposit without signing in", async () => {
    const f = once(200, rawQuote);
    const p = await indicativePrice(anchor, "deposit", "100", f);
    expect(p).toMatchObject({ buyAmount: "2.0396090", feeTotal: "0.50", totalPrice: "49.0290051" });
    const { url, init } = asked(f);
    expect(url.pathname).toBe("/sep38/price");
    expect(url.searchParams.get("sell_asset")).toBe("iso4217:TRY");
    expect(url.searchParams.get("buy_asset")).toBe(`stellar:USDC:${ISSUER}`);
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("locks a withdrawal quote the other way round, with the token", async () => {
    const f = once(201, rawQuote);
    const q = await firmQuote(anchor, "jwt", "withdraw", "1.5", f);
    expect(q.id).toBe("qt_7c333u1qiv9s6xk6wd2m");
    expect(q.expiresAt).toBe("2026-09-18T16:31:48.097Z");
    const { init } = asked(f);
    expect(JSON.parse(init.body as string)).toMatchObject({
      sell_asset: `stellar:USDC:${ISSUER}`,
      buy_asset: "iso4217:TRY",
      sell_amount: "1.5",
    });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
  });
});

describe("requestDeposit", () => {
  const rawDeposit = {
    id: "sep_se0lkqg15lmor32bisks",
    instructions: {
      bank_name: { value: "TR Mock Bank A.Ş." },
      bank_account_number: { value: "TR050009900000000000000001" },
      external_transfer_memo: { value: "TRMA-47QC-ZX6M" },
    },
  };

  it("returns the bank instructions", async () => {
    const f = once(200, rawDeposit);
    const d = await requestDeposit(anchor, "jwt", { account: "GABC", tryAmount: "100", quoteId: "qt_1" }, f);
    expect(d).toEqual({
      id: "sep_se0lkqg15lmor32bisks",
      bankName: "TR Mock Bank A.Ş.",
      iban: "TR050009900000000000000001",
      reference: "TRMA-47QC-ZX6M",
    });
  });

  it("names the on-chain side by bare code and the fiat side by SEP-38 id", async () => {
    // The anchor answers 400 to destination_asset=stellar:USDC:G… — learned live.
    const f = once(200, rawDeposit);
    await requestDeposit(anchor, "jwt", { account: "GABC", tryAmount: "100", quoteId: "qt_1" }, f);
    const { url } = asked(f);
    expect(url.pathname).toBe("/sep6/deposit-exchange");
    expect(url.searchParams.get("destination_asset")).toBe("USDC");
    expect(url.searchParams.get("source_asset")).toBe("iso4217:TRY");
    expect(url.searchParams.get("quote_id")).toBe("qt_1");
    expect(url.searchParams.get("account")).toBe("GABC");
  });

  it("passes the anchor's own sentence through on a refusal", async () => {
    const said = "'account' must be a Stellar G... or M... address (contract addresses are not supported)";
    const f = once(400, { error: said });
    const p = requestDeposit(anchor, "jwt", { account: "CABC", tryAmount: "100", quoteId: "qt_1" }, f);
    await expect(p).rejects.toThrow(said);
    await expect(p).rejects.toBeInstanceOf(AnchorError);
  });

  it("refuses instructions with no reference — a transfer nobody can match", async () => {
    const f = once(200, { id: "sep_1", instructions: { bank_name: { value: "B" }, bank_account_number: { value: "TR1" } } });
    await expect(
      requestDeposit(anchor, "jwt", { account: "GABC", tryAmount: "100", quoteId: "qt_1" }, f),
    ).rejects.toThrow(/external_transfer_memo/);
  });
});

describe("requestWithdraw", () => {
  it("returns where to send the USDC and the memo that ties it to the withdrawal", async () => {
    const f = once(200, {
      id: "sep_0v7a9vitryks895gttnw",
      account_id: "GCLCZEQZ2THTEDAOFI66LACNPLY4OBKN7VKLEZFMBIHYKYQOW2W7T3Z6",
      memo: "409409699221",
      memo_type: "id",
    });
    const w = await requestWithdraw(anchor, "jwt", { usdcAmount: "1.5", quoteId: "qt_2" }, f);
    expect(w).toEqual({
      id: "sep_0v7a9vitryks895gttnw",
      account: "GCLCZEQZ2THTEDAOFI66LACNPLY4OBKN7VKLEZFMBIHYKYQOW2W7T3Z6",
      memo: "409409699221",
      memoType: "id",
    });
    const { url } = asked(f);
    expect(url.pathname).toBe("/sep6/withdraw-exchange");
    expect(url.searchParams.get("source_asset")).toBe("USDC");
    expect(url.searchParams.get("destination_asset")).toBe("iso4217:TRY");
  });

  it("refuses instructions without a memo", async () => {
    const f = once(200, { id: "sep_1", account_id: "GABC", memo_type: "id" });
    await expect(requestWithdraw(anchor, "jwt", { usdcAmount: "1.5", quoteId: "qt_2" }, f)).rejects.toThrow(/memo/);
  });
});

describe("setPayoutIban", () => {
  it("writes the IBAN to the SEP-12 customer record", async () => {
    const f = once(202, { id: "cus_1" });
    await setPayoutIban(anchor, "jwt", "GABC", "TR330006100519786457841326", f);
    const { url, init } = asked(f);
    expect(url.pathname).toBe("/sep12/customer");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ account: "GABC", bank_account_number: "TR330006100519786457841326" });
  });
});

describe("simulateBankTransfer", () => {
  it("posts the amount to the sandbox endpoint under the transfer server", async () => {
    const f = once(200, { ok: true });
    await simulateBankTransfer(anchor, "jwt", "sep_1", "100", f);
    const { url, init } = asked(f);
    expect(url.pathname).toBe("/sep6/tx/sep_1/simulate-bank-transfer");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ amount: "100" });
  });
});

describe("waitForTransfer", () => {
  const tx = (status: string, extra: Record<string, unknown> = {}) =>
    res(200, { transaction: { id: "sep_1", kind: "deposit", status, ...extra } });
  const noSleep = async () => {};

  it("polls until completed and reports each status once", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(tx("pending_anchor"))
      .mockResolvedValueOnce(tx("pending_anchor"))
      .mockResolvedValueOnce(tx("completed", { amount_out: "2.0396090", stellar_transaction_id: "8b3f" }));
    const seen: string[] = [];
    const t = await waitForTransfer(anchor, "jwt", "sep_1", { onStatus: (s) => seen.push(s.status), sleep: noSleep }, f);
    expect(t).toMatchObject({ status: "completed", amountOut: "2.0396090", stellarTxHash: "8b3f" });
    expect(seen).toEqual(["pending_anchor", "completed"]);
  });

  it("throws the anchor's message on error", async () => {
    const f = vi.fn().mockResolvedValue(tx("error", { message: "Treasury is out of USDC." }));
    await expect(waitForTransfer(anchor, "jwt", "sep_1", { sleep: noSleep }, f)).rejects.toThrow("Treasury is out of USDC.");
  });

  it("gives up after the timeout and says where it stopped", async () => {
    const f = vi.fn().mockResolvedValue(tx("pending_trust"));
    let clock = 0;
    const p = waitForTransfer(anchor, "jwt", "sep_1", { sleep: noSleep, now: () => (clock += 1_000), timeoutMs: 3_000 }, f);
    await expect(p).rejects.toThrow(/still pending_trust.*sep_1/);
  });
});

describe("getTransfer", () => {
  it("maps a withdrawal's bank payout id", async () => {
    const f = once(200, {
      transaction: {
        id: "sep_2", kind: "withdrawal", status: "completed", amount_in: "1.5000000", amount_out: "72.81",
        amount_fee: "0.36", stellar_transaction_id: "82d5", external_transaction_id: "FAST-0RHFF9RWFJ",
      },
    });
    expect(await getTransfer(anchor, "jwt", "sep_2", f)).toEqual({
      id: "sep_2", kind: "withdrawal", status: "completed", amountIn: "1.5000000", amountOut: "72.81",
      amountFee: "0.36", stellarTxHash: "82d5", bankRef: "FAST-0RHFF9RWFJ", message: null,
    });
  });
});
