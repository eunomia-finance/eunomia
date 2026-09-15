// The owner's side of request_exception. An agent on the Leash files a request as a data
// entry on ITS OWN account (see exceptionCodec.ts) — nothing to trust but the chain: only
// that key can write there, and the entry name is scoped to this treasury. "Resolved" is
// not a flag anyone sets; it is the chain now allowing the payment.
import { HORIZON_URL } from "../config";
import { decodeExceptionPayload, exceptionIdOf, isExceptionEntryFor } from "./exceptionCodec";
import type { EunomiaState, Lifecycle } from "./userTreasury";

export interface ExceptionRequest {
  id: string;
  name: string;
  payee: string;
  /** stroops */
  amount: bigint;
  taskId: bigint;
  reasonCodes: number[];
  /** unix seconds */
  requestedAt: number;
}

const fromBase64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Horizon's `data` map (name → base64 value) → this treasury's requests, newest first. */
export function parseAccountData(data: Record<string, string>, treasuryId: string): ExceptionRequest[] {
  const out: ExceptionRequest[] = [];
  for (const [name, value] of Object.entries(data)) {
    if (!isExceptionEntryFor(name, treasuryId)) continue;
    try {
      const p = decodeExceptionPayload(fromBase64(value));
      out.push({ id: exceptionIdOf(name), name, ...p });
    } catch {
      /* not ours, or a newer layout — skip */
    }
  }
  return out.sort((a, b) => b.requestedAt - a.requestedAt);
}

/** The agent account's requests for this treasury. A missing account has none. */
export async function fetchAgentExceptions(
  agent: string,
  treasuryId: string,
  fetchFn: typeof fetch = fetch,
): Promise<ExceptionRequest[]> {
  const res = await fetchFn(`${HORIZON_URL}/accounts/${agent}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Horizon error ${res.status} — could not read the agent's requests.`);
  const body = (await res.json()) as { data?: Record<string, string> };
  return parseAccountData(body.data ?? {}, treasuryId);
}

export type ExceptionStatus = "pending" | "resolved";

/** Would the contract accept this payment now? Mirrors pay()'s checks in the order the
 *  contract runs them; the Leash cap only binds while a session is active. */
export function exceptionStatus(
  req: ExceptionRequest,
  state: EunomiaState,
  lifecycle: Lifecycle | null,
  payeeAllowed: boolean,
  nowSec: number,
): ExceptionStatus {
  if (lifecycle?.paused) return "pending";
  if (!payeeAllowed) return "pending";
  if (req.amount > state.perTaskLimit) return "pending";
  const s = lifecycle?.session;
  if (s && nowSec < Number(s.valid_until) && s.spent + req.amount > s.limit) return "pending";
  if (state.daySpent + req.amount > state.dailyLimit) return "pending";
  if (req.amount > state.balance) return "pending";
  return "resolved";
}

export type OwnerAction = {
  kind: "whitelist" | "limits" | "leash" | "pause" | "fund" | "none";
  label: string;
};

/** What the dashboard can do about a contract error code. Codes 2/5 and 9 map to a
 *  one-click action here; the rest point at the page that holds the control. */
export function ownerActionFor(code: number): OwnerAction {
  switch (code) {
    case 2:
    case 5:
      return { kind: "whitelist", label: "Approve payee" };
    case 3:
    case 4:
      return { kind: "limits", label: "Raise limits in Settings" };
    case 10:
      return { kind: "leash", label: "Revoke, then start a bigger Leash" };
    case 9:
      return { kind: "pause", label: "Resume treasury" };
    case 6:
      return { kind: "fund", label: "Fund the treasury in Overview" };
    default:
      return { kind: "none", label: "No dashboard action" };
  }
}
