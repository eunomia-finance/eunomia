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
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState("");
  // A shared ticking clock (render-pure): the Leash cap stops binding the moment it expires.
  const nowSec = Math.floor(useNow(rows.length > 0) / 1000);

  useEffect(() => {
    if (!treasuryId) return;
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
        if (!cancelled) {
          setRows(withPayee);
          setErr("");
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not read the agent's requests.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, treasuryId, t.refreshKey]);

  if (!treasuryId || !t.state || (rows.length === 0 && !err)) return null;

  return (
    <div style={card}>
      <div style={label}>Exception requests</div>
      <div style={body}>
        Your agent asked to pay outside your rules. Each request sits on the agent's own Stellar
        account; resolving one is an on-chain change to your rules, and it counts as allowed only
        once Stellar would accept the payment.
      </div>
      {err && <div style={hint}>{err}</div>}
      {rows.map((r) => {
        const status = exceptionStatus(r, t.state!, t.lifecycle, r.payeeAllowed, nowSec);
        const primary = r.reasonCodes.map(ownerActionFor).find((a) => a.kind !== "none");
        return (
          <div key={r.id} style={row}>
            <div style={rowHead}>
              <span style={mono}>
                {fmtXlm(r.amount)} XLM → {shortAddr(r.payee)}
              </span>
              <span style={status === "resolved" ? badgeOk : badge}>
                {status === "resolved" ? "allowed now" : "pending"}
              </span>
            </div>
            <ul style={reasonList}>
              {r.reasonCodes.map((c) => (
                <li key={c}>{CONTRACT_ERRORS[c] ?? `Contract error #${c}`}</li>
              ))}
            </ul>
            <div style={meta}>
              requested {new Date(r.requestedAt * 1000).toLocaleString()} · task #{r.taskId.toString()} ·{" "}
              <a style={link} href={`${EXPLORER}/account/${agent}`} target="_blank" rel="noreferrer">
                agent account ↗
              </a>
            </div>
            {status === "resolved" ? (
              <div style={hint}>The agent can pay this now; it clears the request when it does.</div>
            ) : primary?.kind === "whitelist" ? (
              <button
                style={{ ...actionBtn, opacity: t.busy ? 0.6 : 1 }}
                onClick={() => void t.whitelist(r.payee)}
                disabled={!!t.busy}
                type="button"
              >
                {t.busy === "whitelist" ? "Approving…" : `Approve payee ${shortAddr(r.payee)}`}
              </button>
            ) : primary?.kind === "pause" ? (
              <button
                style={{ ...actionBtn, opacity: t.busy ? 0.6 : 1 }}
                onClick={() => void t.togglePause()}
                disabled={!!t.busy}
                type="button"
              >
                {t.busy === "pause" ? "Resuming…" : "Resume treasury"}
              </button>
            ) : primary ? (
              <div style={hint}>{primary.label}. Nothing else changes until you do.</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const card: React.CSSProperties = {
  marginTop: 14,
  padding: 20,
  borderRadius: 14,
  background: "var(--surface)",
  border: "1px solid var(--line)",
};
const label: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--ink-2)",
};
const body: React.CSSProperties = { fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, marginTop: 8 };
const hint: React.CSSProperties = { marginTop: 10, fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 };
const row: React.CSSProperties = { marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" };
const rowHead: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 13.5, color: "var(--ink)" };
const badge: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--ink-2)",
  border: "1px solid var(--line)",
  borderRadius: 100,
  padding: "3px 9px",
  whiteSpace: "nowrap",
};
const badgeOk: React.CSSProperties = { ...badge, color: "var(--ink)", borderColor: "var(--green)" };
const reasonList: React.CSSProperties = {
  margin: "8px 0 0",
  padding: "0 0 0 18px",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--ink-2)",
};
const meta: React.CSSProperties = { marginTop: 6, fontSize: 12, color: "var(--ink-2)" };
const link: React.CSSProperties = { color: "var(--ink-2)", textDecoration: "underline" };
const actionBtn: React.CSSProperties = {
  width: "100%",
  marginTop: 10,
  padding: "11px 14px",
  borderRadius: 10,
  cursor: "pointer",
  fontSize: 14,
  fontFamily: "inherit",
  fontWeight: 600,
  background: "var(--ink)",
  border: "none",
  color: "var(--bg)",
};
