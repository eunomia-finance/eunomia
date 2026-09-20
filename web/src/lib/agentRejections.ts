// A refusal an external agent met is invisible to this dashboard by default, and the reason
// is structural: the contract reverts, so it emits no event, and the refused call never
// reaches a ledger at all (the RPC answers from simulation). The only durable record is the
// request the agent files about it — `request_exception` writes payee, amount, task and the
// contract's own error codes onto the agent's own Stellar account, with a transaction hash.
//
// So the ledger reads those. An agent running on someone else's machine through eunomia-mcp
// now shows up in the owner's ledger the same way the one on this device does.
import { useEffect, useState } from "react";
import type { FeedEvent } from "./events";
import { fetchAgentExceptions, type ExceptionRequest } from "./exceptions";
import { CONTRACT_ERRORS } from "./wallet-errors";

const short = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

const why = (codes: number[]): string => {
  const first = codes[0];
  if (first === undefined) return "Refused by your rules";
  const text = CONTRACT_ERRORS[first];
  if (!text) return `Refused — contract error #${first}`;
  // The table writes full sentences; a ledger row is not one.
  return text.replace(/\.$/, "");
};

/** The agent's filed refusals as ledger rows, newest first is the caller's business. */
export function rejectionsToFeed(reqs: ExceptionRequest[], treasuryId: string): FeedEvent[] {
  return reqs.map((r) => ({
    id: `x-${r.id}`,
    kind: "blocked",
    // Dot-separated, not dashed: the contract's own wording already carries an em dash.
    label: `Agent payment refused · ${why(r.reasonCodes)} · ${short(r.payee)}`,
    // The request's own transaction is the proof, but Horizon's account-data view doesn't
    // carry it; the entry is the evidence and the Agent page links the account.
    txHash: "",
    at: new Date(r.requestedAt * 1000).toISOString(),
    amountXlm: Number(r.amount) / 1e7,
    treasuryId,
  }));
}

/** The refusals the treasury's current agent has filed, as ledger rows. Empty while no agent
 *  is on a Leash — the entries live on the agent's account, so there is nowhere to read. */
const NONE: FeedEvent[] = [];

export function useAgentRejections(agent: string | null, treasuryId: string, refreshKey = 0): FeedEvent[] {
  // Keyed by the agent it was read for, so a revoked Leash can't leave the previous agent's
  // refusals on screen — and so nothing has to be cleared from inside the effect.
  const [read, setRead] = useState<{ agent: string; rows: FeedEvent[] }>({ agent: "", rows: NONE });
  useEffect(() => {
    if (!agent) return;
    let alive = true;
    void fetchAgentExceptions(agent, treasuryId)
      .then((reqs) => alive && setRead({ agent, rows: rejectionsToFeed(reqs, treasuryId) }))
      // Horizon down, or the agent account not created yet — the ledger simply has no
      // refusals to show, which is also what it showed before this existed.
      .catch(() => alive && setRead({ agent, rows: NONE }))
    return () => {
      alive = false;
    };
  }, [agent, treasuryId, refreshKey]);
  return agent && read.agent === agent ? read.rows : NONE;
}

/** One minute: the app logs its telemetry row the same second the contract answers, and the
 *  agent files its request right after. Wider than that and two genuine refusals of the same
 *  amount would collapse into one. */
const SAME_REFUSAL_MS = 60_000;

/** A refusal made from this device reaches the ledger twice — once as the app's own activity
 *  row, once as the request the agent filed about it. Same event: keep the filed one, which
 *  names the payee and the rule. Matched on amount and a one-minute window, because that is
 *  all the two records share. Pure. */
export function dedupeRefusals(rows: FeedEvent[]): FeedEvent[] {
  const filed = rows.filter((e) => e.kind === "blocked" && e.id.startsWith("x-"));
  if (filed.length === 0) return rows;
  return rows.filter((e) => {
    if (e.kind !== "blocked" || e.id.startsWith("x-")) return true;
    const at = Date.parse(e.at);
    return !filed.some(
      (f) =>
        (e.amountXlm === undefined || f.amountXlm === undefined || Math.abs(f.amountXlm - e.amountXlm) < 1e-7) &&
        Math.abs(Date.parse(f.at) - at) <= SAME_REFUSAL_MS,
    );
  });
}
