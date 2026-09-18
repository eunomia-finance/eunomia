// The ledger's vocabulary, shared by every page that lists decisions: which word and mark a
// kind gets, how the clock column reads, how an amount is written. Pure functions — kept
// out of the component files so fast refresh keeps working.
import type { FeedEvent } from "../../lib/events";

export function verdictOf(kind: string): { cls: string; text: string } {
  if (kind === "blocked") return { cls: "pill pill--no", text: "Blocked" };
  if (kind === "paid") return { cls: "pill pill--ok", text: "Allowed" };
  if (kind === "fund") return { cls: "pill pill--rule", text: "Funded" };
  if (kind === "deploy") return { cls: "pill pill--rule", text: "Created" };
  if (kind === "whitelist") return { cls: "pill pill--rule", text: "Payee" };
  if (kind === "leash" || kind === "revoked") return { cls: "pill pill--rule", text: "Leash" };
  return { cls: "pill pill--rule", text: "Rule" };
}

/** HH:MM for today, "Mon 16:51" for this week, the date beyond — the ledger's clock. */
export function whenOf(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return hm;
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${hm}`;
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

export function amountOf(e: FeedEvent): string {
  if (e.amountXlm == null || Number.isNaN(e.amountXlm)) return "";
  return e.amountXlm.toFixed(4);
}

/** A row's sentence, in the open treasury's token. The feed's writers (chain events, the
 *  activity log) predate the token choice and spell every amount "N XLM"; neither knows
 *  which token a treasury holds. The page does, so the unit is set where it is shown.
 *  The durable fix is a token column on the activity row — until then this keeps a USDC
 *  treasury's ledger from quoting its amounts in the wrong currency. */
export function inToken<T extends { label: string }>(e: T, code: "XLM" | "USDC"): T {
  if (code === "XLM") return e;
  return { ...e, label: e.label.replace(/(\d) XLM\b/g, `$1 ${code}`) };
}
