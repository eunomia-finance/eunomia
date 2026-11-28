// Pure view-level filtering for the activity feed: chip groups collapse the mixed
// vocabulary of on-chain topic symbols and Supabase activity kinds into a handful of
// user-facing categories, and the treasury filter powers "my treasury only" views.
import type { FeedEvent } from "./events";

export type KindGroup =
  | "payments"
  | "blocked"
  | "fund"
  | "deploy"
  | "whitelist"
  | "leash"
  | "lifecycle"
  | "zk";

export const KIND_GROUPS: Record<KindGroup, readonly string[]> = {
  // `spent` and `swept` are the agent's own account at work (agentSpending.ts): what it paid a
  // service out of its task money, and what it sent back.
  payments: ["paid", "spent"],
  blocked: ["blocked"],
  fund: ["fund", "swept"],
  deploy: ["deploy"],
  whitelist: ["whitelist", "payee_add", "payee_rm"],
  leash: ["leash", "revoked"],
  lifecycle: ["lifecycle", "paused", "agent"],
  zk: ["attested", "escrowed", "released", "refunded"],
};

const GROUP_OF: ReadonlyMap<string, KindGroup> = new Map(
  (Object.entries(KIND_GROUPS) as [KindGroup, readonly string[]][]).flatMap(([g, kinds]) =>
    kinds.map((k) => [k, g] as const),
  ),
);

export function groupOfKind(kind: string): KindGroup | null {
  return GROUP_OF.get(kind) ?? null;
}

/** The dot beside a feed row. Returns tokens, not literals: the surface carries the palette
 *  and only two of these colours mean anything — a rejection is red, everything the rules
 *  let through is green, and the rest is neutral. */
export function kindColor(kind: string): string {
  if (kind === "blocked") return "var(--red)";
  if (kind === "fund" || kind === "deploy" || kind === "paid" || kind === "spent") return "var(--green)";
  return "var(--ink-2)";
}

export interface FeedFilter {
  groups: ReadonlySet<KindGroup> | null; // null = every kind
  treasuryId: string | null; // null = platform-wide
}

/** Events without a treasuryId are dropped when a treasury filter is active —
 *  platform-wide rows must not leak into a "my treasury" view. */
export function filterFeed(events: FeedEvent[], f: FeedFilter): FeedEvent[] {
  return events.filter((e) => {
    if (f.treasuryId && e.treasuryId !== f.treasuryId) return false;
    if (f.groups) {
      const g = groupOfKind(e.kind);
      if (!g || !f.groups.has(g)) return false;
    }
    return true;
  });
}
