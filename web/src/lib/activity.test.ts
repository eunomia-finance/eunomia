// These tests assert the English sentences; the app language otherwise follows the machine locale.
import { resetLangForTest } from "./i18n";
resetLangForTest("en");

import { describe, it, expect } from "vitest";
import { buildActivityRow } from "./activity";

describe("buildActivityRow", () => {
  it("maps a full input to the activity row shape", () => {
    expect(
      buildActivityRow({ walletAddress: "GABC", treasuryId: "CXYZ", action: "pay", txHash: "HASH", amountXlm: 5 }),
    ).toEqual({ wallet_address: "GABC", treasury_id: "CXYZ", action: "pay", tx_hash: "HASH", amount_xlm: 5 });
  });

  it("nulls optional fields when absent", () => {
    expect(buildActivityRow({ walletAddress: "GABC", action: "deploy" })).toEqual({
      wallet_address: "GABC",
      treasury_id: null,
      action: "deploy",
      tx_hash: null,
      amount_xlm: null,
    });
  });

  it("clamps overlong values to the column limits", () => {
    const row = buildActivityRow({
      walletAddress: "G".repeat(70),
      treasuryId: "C".repeat(70),
      action: "fund",
      txHash: "H".repeat(90),
    });
    expect(row.wallet_address.length).toBe(64);
    expect(row.treasury_id?.length).toBe(64);
    expect(row.tx_hash?.length).toBe(80);
  });
});

// ---- platform feed mapping + merge ----
import { activityToFeedEvent, mergeFeedEvents, type ActivityRow } from "./activity";
import type { FeedEvent } from "./events";

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 1,
  wallet_address: "GAJDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXNK46",
  treasury_id: "CTREASURY",
  action: "pay",
  tx_hash: "abc123",
  amount_xlm: 5,
  created_at: "2026-07-11T10:00:00Z",
  ...over,
});

const fe = (id: string, at: string, txHash = ""): FeedEvent => ({
  id, kind: "paid", label: id, txHash, at,
});

describe("activityToFeedEvent", () => {
  it("maps a pay row with a shortened address and amount", () => {
    const e = activityToFeedEvent(row());
    expect(e.id).toBe("sb-1");
    expect(e.kind).toBe("paid");
    expect(e.label).toContain("GAJD…NK46");
    expect(e.label).toContain("5 XLM");
    expect(e.txHash).toBe("abc123");
  });

  it("maps reject to a blocked item and survives a null tx hash", () => {
    const e = activityToFeedEvent(row({ action: "reject", tx_hash: null, amount_xlm: null }));
    expect(e.kind).toBe("blocked");
    expect(e.txHash).toBe("");
    expect(e.label).toContain("blocked");
  });

  it("parses numeric-as-string amounts (postgres numeric)", () => {
    const e = activityToFeedEvent(row({ amount_xlm: "7.5" }));
    expect(e.amountXlm).toBe(7.5);
  });

  it("carries the row's treasury_id so feeds can filter per treasury", () => {
    expect(activityToFeedEvent(row()).treasuryId).toBe("CTREASURY");
    expect(activityToFeedEvent(row({ treasury_id: null })).treasuryId).toBeUndefined();
  });

  it("falls back gracefully on unknown actions", () => {
    const e = activityToFeedEvent(row({ action: "mystery" }));
    expect(e.kind).toBe("mystery");
    expect(e.label).toContain("mystery");
  });
});

describe("mergeFeedEvents", () => {
  it("drops secondary items whose tx hash the primary already has", () => {
    const out = mergeFeedEvents([fe("chain", "2026-07-02T10:00:00Z", "tx1")], [fe("sb", "2026-07-02T10:00:01Z", "tx1")]);
    expect(out.map((e) => e.id)).toEqual(["chain"]);
  });

  it("keeps secondary items without a tx hash", () => {
    const out = mergeFeedEvents([fe("chain", "2026-07-02T10:00:00Z", "tx1")], [fe("sb", "2026-07-01T10:00:00Z")]);
    expect(out.map((e) => e.id)).toEqual(["chain", "sb"]);
  });

  it("sorts newest first and caps the list", () => {
    const out = mergeFeedEvents(
      [fe("a", "2026-07-01T10:00:00Z", "t1"), fe("b", "2026-07-03T10:00:00Z", "t2")],
      [fe("c", "2026-07-02T10:00:00Z", "t3")],
      2,
    );
    expect(out.map((e) => e.id)).toEqual(["b", "c"]);
  });
});
