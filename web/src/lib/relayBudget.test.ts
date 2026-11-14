import { describe, expect, it } from "vitest";
import { budgetDay, budgetKey, isLane, releaseIn, reserveIn, SAFETY_LANE, safetyCallsLane, type BudgetStore } from "./relayBudget";
import { durableBudget, RelayBudget } from "../../worker/relayBudget";

const memory = (): BudgetStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k), put: async (k, v) => void data.set(k, v) };
};

describe("reserveIn", () => {
  it("adds charges up to the limit and refuses the one that would pass it", async () => {
    const store = memory();
    expect(await reserveIn(store, "2026-10-22", 60n, 100n)).toBe(true);
    expect(await reserveIn(store, "2026-10-22", 40n, 100n)).toBe(true);
    expect(await reserveIn(store, "2026-10-22", 1n, 100n)).toBe(false);
    // A refused charge is not recorded.
    expect(store.data.get("2026-10-22")).toBe("100");
  });

  it("starts each UTC day from zero", async () => {
    const store = memory();
    await reserveIn(store, "2026-10-22", 100n, 100n);
    expect(await reserveIn(store, "2026-10-23", 100n, 100n)).toBe(true);
  });
});

describe("releaseIn", () => {
  it("gives a charge back, so a refused transaction does not cost the day anything", async () => {
    const store = memory();
    await reserveIn(store, "2026-11-14", 99n, 100n);
    expect(await reserveIn(store, "2026-11-14", 99n, 100n)).toBe(false);
    await releaseIn(store, "2026-11-14", 99n);
    expect(await reserveIn(store, "2026-11-14", 99n, 100n)).toBe(true);
  });

  it("never goes below zero, and leaves a day with nothing booked alone", async () => {
    const store = memory();
    await reserveIn(store, "2026-11-14", 10n, 100n);
    await releaseIn(store, "2026-11-14", 25n);
    expect(store.data.get("2026-11-14")).toBe("0");
    // The day turned between the charge and its release: nothing to give back there.
    await releaseIn(store, "2026-11-15", 25n);
    expect(store.data.has("2026-11-15")).toBe(false);
  });
});

describe("lanes", () => {
  it("count apart from the day's total, under the same day", async () => {
    const store = memory();
    const day = "2026-11-14";
    await reserveIn(store, budgetKey(day), 100n, 100n);
    expect(await reserveIn(store, budgetKey(day, SAFETY_LANE), 30n, 50n)).toBe(true);
    expect(await reserveIn(store, budgetKey(day, SAFETY_LANE), 30n, 50n)).toBe(false);
    expect(budgetKey(day)).toBe(day);
    expect(budgetKey(day, SAFETY_LANE)).toBe("2026-11-14:safety");
  });

  it("are named by a wallet address without leaving the shape a key may have", () => {
    const wallet = "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ";
    expect(isLane(safetyCallsLane(wallet))).toBe(true);
    expect(isLane(SAFETY_LANE)).toBe(true);
    for (const bad of ["", "a b", "../x", "x".repeat(81), 7, undefined]) expect(isLane(bad)).toBe(false);
  });
});

describe("budgetDay", () => {
  it("is the UTC date, whatever the server's zone", () => {
    expect(budgetDay(Date.UTC(2026, 9, 22, 23, 59, 59))).toBe("2026-10-22");
    expect(budgetDay(Date.UTC(2026, 9, 23, 0, 0, 0))).toBe("2026-10-23");
  });
});

describe("the Durable Object and its client", () => {
  it("carry a charge across the wire and refuse past the limit", async () => {
    const data = new Map<string, unknown>();
    const object = new RelayBudget({
      storage: { get: async <T,>(k: string) => data.get(k) as T | undefined, put: async (k, v) => void data.set(k, v) },
    });
    const ns = {
      idFromName: (n: string) => n,
      get: () => ({ fetch: (url: string, init: RequestInit) => object.fetch(new Request(url, init)) }),
    };
    const budget = durableBudget(ns);
    expect(await budget.reserve(70n, 100n)).toBe(true);
    expect(await budget.reserve(31n, 100n)).toBe(false);
    expect(await budget.reserve(30n, 100n)).toBe(true);

    // A release makes room again; a lane is its own counter.
    await budget.release(30n);
    expect(await budget.reserve(30n, 100n)).toBe(true);
    expect(await budget.reserve(40n, 50n, SAFETY_LANE)).toBe(true);
    expect(await budget.reserve(40n, 50n, SAFETY_LANE)).toBe(false);
    await budget.release(40n, SAFETY_LANE);
    expect(await budget.reserve(40n, 50n, SAFETY_LANE)).toBe(true);
  });

  it("refuses a lane that is not shaped like one instead of writing it", async () => {
    const data = new Map<string, unknown>();
    const object = new RelayBudget({
      storage: { get: async <T,>(k: string) => data.get(k) as T | undefined, put: async (k, v) => void data.set(k, v) },
    });
    const res = await object.fetch(
      new Request("https://relay-budget/charge", { method: "POST", body: JSON.stringify({ stroops: "1", limit: "9", lane: "../x y" }) }),
    );
    expect(await res.json()).toEqual({ ok: false });
    expect(data.size).toBe(0);
  });

  it("does not fail the caller when a release cannot reach the object", async () => {
    const ns = { idFromName: (n: string) => n, get: () => ({ fetch: () => Promise.reject(new Error("down")) }) };
    await expect(durableBudget(ns).release(1n)).resolves.toBeUndefined();
  });

  it("refuses when the object cannot be reached", async () => {
    const ns = { idFromName: (n: string) => n, get: () => ({ fetch: () => Promise.reject(new Error("down")) }) };
    expect(await durableBudget(ns).reserve(1n, 100n)).toBe(false);
  });
});
