// Exception requests the Leash agent filed (eunomia-mcp `request_exception`), read straight
// from the agent account on Horizon. The owner resolves one with the same on-chain actions
// the rest of the dashboard already has; a request shows as allowed only once the chain
// would accept the payment. Nothing here is approved off-chain.
import { useEffect, useState } from "react";
import { EXPLORER, NETWORK_PASSPHRASE, RPC_URL, fmtXlm, shortAddr } from "../config";
import { exceptionStatus, fetchAgentExceptions, ownerActionFor, type ExceptionRequest } from "../lib/exceptions";
import { Client } from "../lib/treasuryClient";
import { useNow } from "../lib/useNow";
import { CONTRACT_ERRORS } from "../lib/wallet-errors";
import { useTreasury } from "../state/useTreasury";

interface Row extends ExceptionRequest {
  payeeAllowed: boolean;
}

export default function ExceptionRequests({ agent }: { agent: string }) {
  const t = useTreasury();
  const treasuryId = t.treasuryId;
  // Rows and errors are tagged with the agent + treasury they were read for, so a switch
  // never shows the previous treasury's requests (with live action buttons) against the new one.
  const key = `${agent}:${treasuryId ?? ""}`;
  const [loaded, setLoaded] = useState<{ key: string; rows: Row[]; err: string }>({ key: "", rows: [], err: "" });
  const rows = loaded.key === key ? loaded.rows : [];
  const err = loaded.key === key ? loaded.err : "";
  // A shared ticking clock (render-pure): the Leash cap stops binding the moment it expires.
  const nowSec = Math.floor(useNow(rows.length > 0) / 1000);

  useEffect(() => {
    if (!treasuryId) return;
    const readKey = `${agent}:${treasuryId}`;
    let cancelled = false;
    const client = new Client({ contractId: treasuryId, networkPassphrase: NETWORK_PASSPHRASE, rpcUrl: RPC_URL });
    (async () => {
      try {
        const reqs = await fetchAgentExceptions(agent, treasuryId);
        const withPayee = await Promise.all(
          reqs.map(async (r) => {
            let payeeAllowed = false;
            try {
              payeeAllowed = (await client.is_payee({ payee: r.payee })).result;
            } catch {
              /* unreadable → treated as not yet allowed */
            }
            return { ...r, payeeAllowed };
          }),
        );
        if (!cancelled) setLoaded({ key: readKey, rows: withPayee, err: "" });
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Could not read the agent's requests.";
          // A failed refresh keeps the rows already read for this same treasury.
          setLoaded((prev) => ({ key: readKey, rows: prev.key === readKey ? prev.rows : [], err: msg }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, treasuryId, t.refreshKey]);

  if (!treasuryId || !t.state || (rows.length === 0 && !err)) return null;

  const pending = rows.filter((r) => exceptionStatus(r, t.state!, t.lifecycle, r.payeeAllowed, nowSec) !== "resolved").length;

  return (
    <section className="panel panel--pad">
      <div className="panel__head">
        <div className="eyebrow">Waiting for you</div>
        {pending > 0 && <span className="pill pill--rule">{pending} pending</span>}
      </div>
      <div className="panel__note">
        Your agent asked to pay outside your rules. Each request sits on the agent's own Stellar account;
        resolving one is an on-chain change to your rules, and it counts as allowed only once Stellar would
        accept the payment.
      </div>
      {err && <div className="err">{err}</div>}
      {rows.map((r) => {
        const status = exceptionStatus(r, t.state!, t.lifecycle, r.payeeAllowed, nowSec);
        // The reason codes are what blocked the payment when it was filed. Offer only an action
        // that still applies: "Resume" calls togglePause, which would pause a treasury that has
        // since been resumed, and approving an already-approved payee is a wasted signature.
        const primary = r.reasonCodes
          .map(ownerActionFor)
          .find(
            (a) =>
              a.kind !== "none" &&
              !(a.kind === "pause" && !t.lifecycle?.paused) &&
              !(a.kind === "whitelist" && r.payeeAllowed),
          );
        return (
          <div key={r.id} style={{ paddingTop: 12, borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="rowline">
              <span className="num" style={{ fontSize: 14 }}>
                {fmtXlm(r.amount)} {t.tokenCode} <span style={{ color: "var(--ink-2)" }}>→</span> {shortAddr(r.payee)}
              </span>
              <span className={status === "resolved" ? "pill pill--ok" : "pill pill--rule"}>
                {status === "resolved" ? "allowed now" : "pending"}
              </span>
            </div>
            <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
              {r.reasonCodes.map((c) => (
                <li key={c}>{CONTRACT_ERRORS[c] ?? `Contract error #${c}`}</li>
              ))}
            </ul>
            <div className="ledger__when">
              {new Date(r.requestedAt * 1000).toLocaleString()} · task #{r.taskId.toString()} ·{" "}
              <a className="linkbtn" href={`${EXPLORER}/account/${agent}`} target="_blank" rel="noreferrer">agent account ↗</a>
            </div>
            {status === "resolved" ? (
              <div className="panel__note">The agent can pay this now; it clears the request when it does.</div>
            ) : primary?.kind === "whitelist" ? (
              <div>
                <button className="btn" onClick={() => void t.whitelist(r.payee)} disabled={!!t.busy} type="button">
                  {t.busy === "whitelist" ? "Approving…" : `Approve payee ${shortAddr(r.payee)}`}
                </button>
              </div>
            ) : primary?.kind === "pause" ? (
              <div>
                <button className="btn" onClick={() => void t.togglePause()} disabled={!!t.busy} type="button">
                  {t.busy === "pause" ? "Resuming…" : "Resume treasury"}
                </button>
              </div>
            ) : primary ? (
              <div className="panel__note">{primary.label}. Nothing else changes until you do.</div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
