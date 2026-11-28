// These tests assert the English sentences; the app language otherwise follows the machine locale.
import { resetLangForTest } from "./i18n";
resetLangForTest("en");

import { describe, expect, it, vi } from "vitest";

vi.mock("./walletKit", () => ({ kit: { signTransaction: vi.fn() } }));

import { agentSpendingToFeed, fetchAgentSpending, spendingLabel, type PaymentRecord } from "./agentSpending";
import { CATALOG_PAYEES } from "./agentSetup";

const AGENT = "GC4PLHK23AGBTBDRO6JNEBERXLAG5MPFQFS6QARRY4KADS6PXCZO2BKU";
const TREASURY = "CBZHAQ2VFVIQR4ZY467ZK6KLEVVYX5ABGEUFEYXFOLG7NPIVIGXNYQWR";
const SERVICE = CATALOG_PAYEES[0].address;
const STRANGER = "GAKSMBN6TRMF4M4PL3FJSDMQRD6XBQCJFLECLYTNAXZYMRIWXT6ADYTC";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const opts = { agent: AGENT, treasuryId: TREASURY, token: "USDC" as const, usdcIssuer: ISSUER };

// The shape Horizon answers with for a token-contract transfer (read from mainnet 2026-11-28):
// the operation is a contract call, and the movement is in asset_balance_changes.
const transfer = (over: { id?: string; from?: string; to?: string; amount?: string; code?: string; issuer?: string; ok?: boolean } = {}): PaymentRecord => ({
  id: over.id ?? "282207801211342849",
  type: "invoke_host_function",
  transaction_successful: over.ok ?? true,
  created_at: "2026-11-27T22:39:58Z",
  transaction_hash: "0eaa80d4346c103c436dc4f4bb5e201cac034ca6891ddb043731d6af018cd918",
  asset_balance_changes: [
    {
      asset_type: "credit_alphanum4",
      asset_code: over.code ?? "USDC",
      asset_issuer: over.issuer ?? ISSUER,
      type: "transfer",
      from: over.from ?? AGENT,
      to: over.to ?? SERVICE,
      amount: over.amount ?? "0.0020000",
    },
  ],
});

describe("agentSpendingToFeed", () => {
  it("a payment from the agent's account to a service is a row with its proof", () => {
    const [row] = agentSpendingToFeed([transfer()], opts);
    expect(row.kind).toBe("spent");
    expect(row.payee).toBe(SERVICE);
    expect(row.amountXlm).toBe(0.002);
    expect(row.txHash).toBe("0eaa80d4346c103c436dc4f4bb5e201cac034ca6891ddb043731d6af018cd918");
    expect(row.at).toBe("2026-11-27T22:39:58Z");
    expect(row.treasuryId).toBe(TREASURY);
  });

  it("money the agent sends back to the treasury is a return, not a payment", () => {
    const [row] = agentSpendingToFeed([transfer({ to: TREASURY, amount: "0.0080000" })], opts);
    expect(row.kind).toBe("swept");
    expect(row.amountXlm).toBe(0.008);
  });

  it("leaves out what the agent received — the treasury's own event already tells that", () => {
    expect(agentSpendingToFeed([transfer({ from: TREASURY, to: AGENT })], opts)).toEqual([]);
  });

  it("leaves out other tokens and a look-alike USDC from another issuer", () => {
    expect(agentSpendingToFeed([transfer({ code: "AQUA" })], opts)).toEqual([]);
    expect(agentSpendingToFeed([transfer({ issuer: STRANGER })], opts)).toEqual([]);
  });

  it("leaves out a transaction that failed", () => {
    expect(agentSpendingToFeed([transfer({ ok: false })], opts)).toEqual([]);
  });

  it("reads a classic payment operation the same way", () => {
    const classic: PaymentRecord = {
      id: "1",
      type: "payment",
      transaction_successful: true,
      created_at: "2026-11-27T10:00:00Z",
      transaction_hash: "abc",
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: ISSUER,
      from: AGENT,
      to: STRANGER,
      amount: "1.5000000",
    };
    const [row] = agentSpendingToFeed([classic], opts);
    expect(row.kind).toBe("spent");
    expect(row.payee).toBe(STRANGER);
    expect(row.amountXlm).toBe(1.5);
  });

  it("on an XLM treasury only native payments count", () => {
    const native: PaymentRecord = { id: "2", type: "payment", transaction_successful: true, created_at: "2026-11-27T10:00:00Z", transaction_hash: "n", asset_type: "native", from: AGENT, to: STRANGER, amount: "2.0000000" };
    const xlm = { ...opts, token: "XLM" as const };
    expect(agentSpendingToFeed([native, transfer()], xlm).map((r) => r.amountXlm)).toEqual([2]);
    expect(agentSpendingToFeed([native], opts)).toEqual([]);
  });

  it("gives every row its own id, so two transfers in one transaction both survive", () => {
    const two = transfer();
    two.asset_balance_changes = [...(two.asset_balance_changes ?? []), { ...(two.asset_balance_changes ?? [])[0], to: STRANGER }];
    const rows = agentSpendingToFeed([two, transfer({ id: "9" })], opts);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });
});

describe("spendingLabel", () => {
  it("names a catalog address in words, and anything else by its short address", () => {
    const [known, unknown, back] = agentSpendingToFeed(
      [transfer(), transfer({ id: "2", to: STRANGER }), transfer({ id: "3", to: TREASURY })],
      opts,
    );
    expect(spendingLabel(known)).toBe("Agent paid Service catalog (ROZO MPP Router)");
    expect(spendingLabel(unknown)).toBe("Agent paid GAKS…DYTC");
    expect(spendingLabel(back)).toBe("Unspent task money returned to the treasury");
  });
});

describe("fetchAgentSpending", () => {
  const answer = (status: number, body: unknown = {}) =>
    (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;

  it("asks Horizon for the agent account's newest payments", async () => {
    let asked = "";
    const fetchFn = (async (url: string) => {
      asked = url;
      return { ok: true, status: 200, json: async () => ({ _embedded: { records: [transfer()] } }) };
    }) as unknown as typeof fetch;
    const records = await fetchAgentSpending(AGENT, fetchFn);
    expect(asked).toContain(`/accounts/${AGENT}/payments`);
    expect(asked).toContain("order=desc");
    expect(records).toHaveLength(1);
  });

  it("an account that does not exist yet has spent nothing", async () => {
    expect(await fetchAgentSpending(AGENT, answer(404))).toEqual([]);
  });

  it("Horizon being down is an error, not an empty history", async () => {
    await expect(fetchAgentSpending(AGENT, answer(503))).rejects.toThrow(/Horizon/);
  });
});
