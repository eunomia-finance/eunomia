import { describe, expect, it } from "vitest";
import type { FeedEvent } from "./events";
import { filterFeed, groupOfKind, type FeedFilter } from "./feedFilter";

const fe = (kind: string, treasuryId?: string): FeedEvent => ({
  id: `${kind}-${treasuryId ?? "x"}`,
  kind,
  label: kind,
  txHash: "",
  at: "2026-07-23T00:00:00Z",
  treasuryId,
});

const all: FeedFilter = { groups: null, treasuryId: null };

describe("groupOfKind", () => {
  it("maps chain and activity kinds into chip groups", () => {
    expect(groupOfKind("paid")).toBe("payments");
    expect(groupOfKind("spent")).toBe("payments");
    expect(groupOfKind("blocked")).toBe("blocked");
    expect(groupOfKind("fund")).toBe("fund");
    expect(groupOfKind("swept")).toBe("fund");
    expect(groupOfKind("deploy")).toBe("deploy");
    expect(groupOfKind("whitelist")).toBe("whitelist");
    expect(groupOfKind("payee_add")).toBe("whitelist");
    expect(groupOfKind("payee_rm")).toBe("whitelist");
    expect(groupOfKind("leash")).toBe("leash");
    expect(groupOfKind("revoked")).toBe("leash");
    expect(groupOfKind("lifecycle")).toBe("lifecycle");
    expect(groupOfKind("paused")).toBe("lifecycle");
    expect(groupOfKind("agent")).toBe("lifecycle");
    expect(groupOfKind("attested")).toBe("zk");
    expect(groupOfKind("escrowed")).toBe("zk");
  });
  it("returns null for unknown kinds", () => {
    expect(groupOfKind("mystery")).toBeNull();
  });
});

describe("filterFeed", () => {
  const events = [fe("paid", "C1"), fe("blocked", "C2"), fe("fund"), fe("mystery", "C1")];

  it("passes everything through with a null filter", () => {
    expect(filterFeed(events, all)).toHaveLength(4);
  });

  it("filters by kind group, keeping unknown kinds out of group views", () => {
    const out = filterFeed(events, { groups: new Set(["payments"]), treasuryId: null });
    expect(out.map((e) => e.kind)).toEqual(["paid"]);
  });

  it("filters by treasury and DROPS events without a treasuryId", () => {
    const out = filterFeed(events, { groups: null, treasuryId: "C1" });
    expect(out.map((e) => e.kind)).toEqual(["paid", "mystery"]);
  });

  it("combines group and treasury filters", () => {
    const out = filterFeed(events, { groups: new Set(["payments", "blocked"]), treasuryId: "C2" });
    expect(out.map((e) => e.kind)).toEqual(["blocked"]);
  });
});
