// Best-effort telemetry: record each user's on-chain interaction (treasury deploy, fund,
// whitelist, pay, or a policy-rejected pay) so real usage is provable — this is the evidence
// backbone for Level 4's "10+ user wallet interactions". Logging never blocks the UX.
import { supabase, supabaseConfigured } from "./supabase";
import type { FeedEvent } from "./events";

/** Every verb the app can log. The database's CHECK allowlist
 *  (supabase/migrations/0005_activity_action_verbs.sql) must carry the same set —
 *  activity.migration.test.ts holds the two together. */
export const ACTIVITY_ACTIONS = [
  "deploy",
  "fund",
  "whitelist",
  "pay",
  "reject",
  "pause",
  "withdraw",
  "limits",
  "session_start",
  "session_revoke",
  "agent_pay",
  "register",
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface ActivityInput {
  walletAddress: string;
  treasuryId?: string;
  action: ActivityAction;
  txHash?: string;
  amountXlm?: number;
}

/** Shape + clamp an activity row to the table's column limits (pure, testable). */
export function buildActivityRow(input: ActivityInput) {
  return {
    wallet_address: input.walletAddress.slice(0, 64),
    treasury_id: input.treasuryId ? input.treasuryId.slice(0, 64) : null,
    action: input.action,
    tx_hash: input.txHash ? input.txHash.slice(0, 80) : null,
    amount_xlm: input.amountXlm ?? null,
  };
}

export async function logActivity(input: ActivityInput): Promise<void> {
  if (!supabaseConfigured || !supabase || !input.walletAddress) return;
  try {
    // supabase-js resolves with { error } rather than throwing, so a rejected row (a CHECK
    // constraint, a unique index) would otherwise pass the catch below without a trace.
    const { error } = await supabase.from("activity").insert(buildActivityRow(input));
    if (error) console.error("[eunomia] activity log failed:", error.message);
  } catch (e) {
    // best-effort — a logging failure must never break the user's action
    console.error("[eunomia] activity log failed:", e instanceof Error ? e.message : e);
  }
}

// ---- platform activity feed (full history + live) -------------------------------
// The RPC only retains a bounded event window, so the Activity view's full history
// comes from this table (every logged action, platform-wide) and the live layer from
// a Realtime INSERT subscription — the RPC poll stays for on-chain event detail.

export interface ActivityRow {
  id: number;
  wallet_address: string;
  treasury_id: string | null;
  action: string;
  tx_hash: string | null;
  amount_xlm: number | string | null;
  created_at: string;
}

const shortAddr = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

/** Map a platform activity row to a feed item (pure, testable). */
export function activityToFeedEvent(row: ActivityRow): FeedEvent {
  const who = shortAddr(row.wallet_address);
  const amt = row.amount_xlm == null ? null : Number(row.amount_xlm);
  const amtTxt = amt != null && !Number.isNaN(amt) ? ` · ${amt} XLM` : "";
  const map: Record<string, { kind: string; label: string }> = {
    deploy: { kind: "deploy", label: `${who} created a treasury` },
    fund: { kind: "fund", label: `${who} funded a treasury${amtTxt}` },
    whitelist: { kind: "whitelist", label: `${who} approved a payee` },
    pay: { kind: "paid", label: `Payment from ${who}'s treasury${amtTxt}` },
    agent_pay: { kind: "paid", label: `Leash-signed agent payment · ${who}${amtTxt}` },
    reject: { kind: "blocked", label: `Payment blocked by ${who}'s rules${amtTxt}` },
    session_start: { kind: "leash", label: `${who} started a Leash` },
    session_revoke: { kind: "leash", label: `${who} revoked a Leash` },
    pause: { kind: "lifecycle", label: `${who} paused their treasury` },
    withdraw: { kind: "lifecycle", label: `${who} withdrew from their treasury` },
    limits: { kind: "lifecycle", label: `${who} updated treasury limits` },
    register: { kind: "lifecycle", label: `${who} backed up their treasury` },
  };
  const m = map[row.action] ?? { kind: row.action, label: `${who} · ${row.action}` };
  return {
    id: `sb-${row.id}`,
    kind: m.kind,
    label: m.label,
    txHash: row.tx_hash ?? "",
    at: row.created_at,
    amountXlm: amt != null && !Number.isNaN(amt) ? amt : undefined,
    treasuryId: row.treasury_id ?? undefined,
  };
}

/** Merge on-chain events (primary — richer labels) with platform rows, newest first.
 *  Duplicates are dropped by tx hash; rows without a hash always survive. Pure. */
export function mergeFeedEvents(primary: FeedEvent[], secondary: FeedEvent[], cap = 120): FeedEvent[] {
  const seen = new Set(primary.map((e) => e.txHash).filter(Boolean));
  const merged = [...primary, ...secondary.filter((e) => !e.txHash || !seen.has(e.txHash))];
  return merged.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, cap);
}

/** Full platform history, newest first (empty when Supabase isn't configured). */
export async function fetchActivityHistory(limit = 120): Promise<FeedEvent[]> {
  if (!supabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from("activity")
      .select("id,wallet_address,treasury_id,action,tx_hash,amount_xlm,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as ActivityRow[]).map(activityToFeedEvent);
  } catch {
    return [];
  }
}

/** Live INSERT stream — returns an unsubscribe. No-op when Supabase isn't configured. */
export function subscribeActivity(onEvent: (e: FeedEvent) => void): () => void {
  if (!supabaseConfigured || !supabase) return () => {};
  const sb = supabase; // narrow once — the guard doesn't carry into the closure below
  const ch = sb
    .channel("activity-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity" }, (payload) => {
      try {
        onEvent(activityToFeedEvent(payload.new as ActivityRow));
      } catch {
        /* malformed row — skip */
      }
    })
    .subscribe();
  return () => {
    try {
      void sb.removeChannel(ch);
    } catch {
      /* already gone */
    }
  };
}
