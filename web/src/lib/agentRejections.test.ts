import { describe, expect, it } from "vitest";
import { dedupeRefusals, rejectionsToFeed } from "./agentRejections";
import type { FeedEvent } from "./events";
import type { ExceptionRequest } from "./exceptions";

const req = (over: Partial<ExceptionRequest> = {}): ExceptionRequest => ({
  id: "CDVCLLGG.abc",
  name: "eunomia.x.CDVCLLGG.abc",
  payee: "GAKSMBN6TRMF4M4PL3FJSDMQRD6XBQCJFLECLYTNAXZYMRIWXT6ADYTC",
  amount: 10_000_000n,
  taskId: 7n,
  reasonCodes: [2],
  requestedAt: 1_758_000_000,
  ...over,
});

describe("rejectionsToFeed", () => {
  it("reads as a blocked decision, with the rule and the payee", () => {
    const [row] = rejectionsToFeed([req()], "CTREASURY");
    expect(row.kind).toBe("blocked");
    expect(row.label).toContain("Agent payment refused");
    expect(row.label).toContain("not on the whitelist");
    expect(row.label).toContain("GAKS…DYTC");
    expect(row.amountXlm).toBe(1);
    expect(row.treasuryId).toBe("CTREASURY");
    expect(row.at).toBe(new Date(1_758_000_000 * 1000).toISOString());
  });

  it("carries the contract's own wording, without its full stop", () => {
    const [row] = rejectionsToFeed([req({ reasonCodes: [3] })], "C");
    expect(row.label).toContain("Over the per-task limit");
    expect(row.label.endsWith(".")).toBe(false);
  });

  it("names the first rule when the contract raised several", () => {
    const [row] = rejectionsToFeed([req({ reasonCodes: [2, 4] })], "C");
    expect(row.label).toContain("Payee isn't approved");
  });

  it("survives a code the table doesn't know, and one with no codes at all", () => {
    expect(rejectionsToFeed([req({ reasonCodes: [99] })], "C")[0].label).toContain("#99");
    expect(rejectionsToFeed([req({ reasonCodes: [] })], "C")[0].label).toContain("Refused by your rules");
  });

  it("gives every row a distinct id derived from the on-chain entry", () => {
    const rows = rejectionsToFeed([req({ id: "A" }), req({ id: "B" })], "C");
    expect(rows.map((r) => r.id)).toEqual(["x-A", "x-B"]);
  });
});

const ev = (over: Partial<FeedEvent> = {}): FeedEvent => ({
  id: "sb-1",
  kind: "blocked",
  label: "Payment blocked by GCXU…4PED's rules · 1 XLM",
  txHash: "",
  at: "2026-09-20T06:35:04.000Z",
  amountXlm: 1,
  ...over,
});

describe("dedupeRefusals", () => {
  const filed = rejectionsToFeed([req({ requestedAt: Math.floor(Date.parse("2026-09-20T06:35:12Z") / 1000) })], "C");

  it("drops the app's own row when the agent filed the same refusal", () => {
    const out = dedupeRefusals([ev(), ...filed]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(filed[0].id);
  });

  it("keeps a refusal the agent never filed", () => {
    const out = dedupeRefusals([ev({ at: "2026-09-20T04:00:00.000Z" }), ...filed]);
    expect(out).toHaveLength(2);
  });

  it("keeps a refusal of a different amount at the same moment", () => {
    const out = dedupeRefusals([ev({ amountXlm: 5 }), ...filed]);
    expect(out).toHaveLength(2);
  });

  it("leaves payments and everything else alone", () => {
    const paid = ev({ id: "sb-9", kind: "paid", txHash: "abc" });
    expect(dedupeRefusals([paid, ...filed]).map((e) => e.id)).toEqual(["sb-9", filed[0].id]);
  });

  it("is a no-op when the agent has filed nothing", () => {
    const rows = [ev(), ev({ id: "sb-2" })];
    expect(dedupeRefusals(rows)).toEqual(rows);
  });
});
