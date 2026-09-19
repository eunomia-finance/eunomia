import { describe, expect, it } from "vitest";
import { MIN_DEMO, ONE_UNIT, demoAmount, initialLoop, unitsOf, withStep, type Room } from "./agentLoop";

const room = (over: Partial<Room> = {}): Room => ({
  perTaskLimit: 50n * ONE_UNIT,
  dailyLimit: 100n * ONE_UNIT,
  daySpent: 0n,
  balance: 100n * ONE_UNIT,
  sessionLeft: 25n * ONE_UNIT,
  ...over,
});

describe("demoAmount", () => {
  it("pays one whole unit when every rule leaves room", () => {
    const r = demoAmount(room());
    expect(r).toEqual({ ok: true, stroops: ONE_UNIT });
  });

  it("never asks for more than the contract would allow", () => {
    // Each rule in turn is the tightest one, and each has to bind.
    expect(demoAmount(room({ perTaskLimit: ONE_UNIT / 2n }))).toEqual({ ok: true, stroops: ONE_UNIT / 2n });
    expect(demoAmount(room({ balance: ONE_UNIT / 4n }))).toEqual({ ok: true, stroops: ONE_UNIT / 4n });
    expect(demoAmount(room({ sessionLeft: ONE_UNIT / 5n }))).toEqual({ ok: true, stroops: ONE_UNIT / 5n });
    expect(demoAmount(room({ dailyLimit: 10n * ONE_UNIT, daySpent: 10n * ONE_UNIT - ONE_UNIT / 8n }))).toEqual({
      ok: true,
      stroops: ONE_UNIT / 8n,
    });
  });

  it("treats a spent-out day as no room, not as a negative amount", () => {
    const r = demoAmount(room({ dailyLimit: 10n * ONE_UNIT, daySpent: 20n * ONE_UNIT }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toContain("today");
  });

  it("names the rule that left too little, so the owner knows what to change", () => {
    const empty = demoAmount(room({ balance: 0n }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.why).toContain("balance");

    const tightCap = demoAmount(room({ perTaskLimit: MIN_DEMO - 1n }));
    expect(tightCap.ok).toBe(false);
    if (!tightCap.ok) expect(tightCap.why).toContain("per-payment");

    const tightLeash = demoAmount(room({ sessionLeft: 0n }));
    expect(tightLeash.ok).toBe(false);
    if (!tightLeash.ok) expect(tightLeash.why).toContain("Leash");
  });

  it("ignores the Leash cap when no session binds the spend", () => {
    expect(demoAmount(room({ sessionLeft: null }))).toEqual({ ok: true, stroops: ONE_UNIT });
  });
});

describe("unitsOf", () => {
  it("renders the amounts the loop chooses as the decimal pay() takes", () => {
    expect(unitsOf(ONE_UNIT)).toBe(1);
    expect(unitsOf(ONE_UNIT / 2n)).toBe(0.5);
    expect(unitsOf(MIN_DEMO)).toBe(0.1);
  });
});

describe("withStep", () => {
  it("replaces one step and leaves the others alone", () => {
    const next = withStep(initialLoop(), "refused", { status: "refused", detail: "not on the list" });
    expect(next.map((s) => s.status)).toEqual(["pending", "refused", "pending"]);
    expect(next[1].detail).toBe("not on the list");
    expect(next[0]).toEqual(initialLoop()[0]);
  });

  it("starts with the three steps in the order they happen", () => {
    expect(initialLoop().map((s) => s.key)).toEqual(["pay", "refused", "request"]);
    expect(initialLoop().every((s) => s.status === "pending")).toBe(true);
  });
});
