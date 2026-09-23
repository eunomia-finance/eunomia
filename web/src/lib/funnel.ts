// Best-effort funnel telemetry: record the steps *before* an on-chain action — page view,
// wallet-connect click, and its result (success / error / dismissed) — so we can see where
// visitors drop off. `activity.ts` only captures deploy-and-after, which left the connect
// wall (the real blocker for Level 4's "10 user interactions") invisible. Logging never
// blocks the UX.
import { supabase, supabaseConfigured } from "./supabase";

export type FunnelEvent = "page_view" | "connect_click" | "connect_result";
export type Device = "mobile" | "desktop";
export type FunnelOutcome = "success" | "error" | "dismissed";

export interface FunnelInput {
  event: FunnelEvent;
  device?: Device;
  walletId?: string;
  outcome?: FunnelOutcome;
  detail?: string;
  sessionId?: string;
}

/** Extension wallets don't work in mobile browsers, so mobile vs desktop is the key split. */
export function detectDevice(width: number): Device {
  return width < 768 ? "mobile" : "desktop";
}

/** Shape + clamp a funnel row to the table's column limits (pure, testable). */
export function buildFunnelRow(input: FunnelInput) {
  return {
    event: input.event,
    device: input.device ?? null,
    wallet_id: input.walletId ? input.walletId.slice(0, 40) : null,
    outcome: input.outcome ?? null,
    detail: input.detail ? input.detail.slice(0, 200) : null,
    session_id: input.sessionId ? input.sessionId.slice(0, 64) : null,
  };
}

/** A stable per-tab id so one visitor's steps can be chained. Empty outside the browser. */
export function sessionId(): string {
  if (typeof sessionStorage === "undefined") return "";
  let id = sessionStorage.getItem("prism_session");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("prism_session", id);
  }
  return id;
}

/** The current viewport's device class. Defaults to desktop outside the browser. */
export function currentDevice(): Device {
  return typeof window === "undefined" ? "desktop" : detectDevice(window.innerWidth);
}

export async function logFunnel(input: FunnelInput): Promise<void> {
  if (!supabaseConfigured || !supabase) return;
  try {
    const row = buildFunnelRow({
      ...input,
      device: input.device ?? currentDevice(),
      sessionId: input.sessionId ?? sessionId(),
    });
    // supabase-js resolves with { error } rather than throwing, so a rejected row (a CHECK
    // constraint, a unique index) would otherwise pass the catch below without a trace.
    const { error } = await supabase.from("funnel_events").insert(row);
    if (error) console.error("[eunomia] funnel log failed:", error.message);
  } catch (e) {
    // best-effort — a logging failure must never break the user's action
    console.error("[eunomia] funnel log failed:", e instanceof Error ? e.message : e);
  }
}
