// An agent asked for a task budget (eunomia-mcp `request_budget`) and the owner opened the
// link. Everything the signature will grant is on this card before the button: the amount,
// how long, which payees, what for — and whose key is asking. Approving signs exactly that
// as `set_task_budget`; nothing here is approved off-chain.
//
// The link's signature proves which key asked, and anyone can sign with a key of their own:
// a stranger can send the owner a perfectly valid link that makes the stranger's key the
// spender. So a key this treasury has not worked with is approved only after the owner pastes
// the key their own agent printed, payees are shown whole (four-and-four abbreviations are
// what address poisoning imitates), and this card approves no payees — that stays on the
// Payments page, as its own decision.
import { useEffect, useState } from "react";
import { EXPLORER, NETWORK_PASSPHRASE, RPC_URL, fmtXlm, shortAddr } from "../config";
import { decodeBudgetRequest, type BudgetRequest } from "../lib/budgetRequestCodec";
import { Client } from "../lib/treasuryClient";
import { useTreasury } from "../state/useTreasury";

/** The request carried in this page's URL, if any. */
function budgetRequestFromUrl(search = window.location.search): ReturnType<typeof decodeBudgetRequest> | null {
  const params = new URLSearchParams(search);
  return params.has("sig") ? decodeBudgetRequest(params, Math.floor(Date.now() / 1000)) : null;
}

/** Drop the request from the address bar, keeping the page the owner is on. */
function clearRequest() {
  window.history.replaceState(null, "", window.location.pathname + window.location.hash);
}

const fullAddr = { wordBreak: "break-all" as const, textAlign: "right" as const };

export default function BudgetRequestCard({ onDone }: { onDone: () => void }) {
  const t = useTreasury();
  const [parsed] = useState(() => budgetRequestFromUrl());
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [pastedKey, setPastedKey] = useState("");
  const [err, setErr] = useState("");

  const r: BudgetRequest | null = parsed?.request ?? null;
  // A verified link is a pubnet one: the codec refuses any other network.
  const usable = !!parsed?.verified && !!r && r.treasury === t.treasuryId;

  // Which of the named payees the treasury already pays — a budget does not approve them.
  useEffect(() => {
    if (!usable || !r) return;
    let cancelled = false;
    const client = new Client({ contractId: r.treasury, networkPassphrase: NETWORK_PASSPHRASE, rpcUrl: RPC_URL });
    void Promise.all(
      r.payees.map(async (p) => [p, await client.is_payee({ payee: p }).then((x) => x.result).catch(() => false)] as const),
    ).then((pairs) => {
      if (!cancelled) setApproved(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [usable, r, t.refreshKey]);

  if (!parsed) return null;
  const dismiss = () => {
    clearRequest();
    onDone();
  };

  const problem = !parsed.verified
    ? `This link does not verify: ${parsed.problems.join("; ")}.`
    : r && r.treasury !== t.treasuryId
        ? `This request is for treasury ${r.treasury}. Open that treasury from the switcher, then this card returns.`
        : "";

  const session = t.lifecycle?.session ?? null;
  const knownAgent = !!r && (session?.agent === r.agent || t.state?.agent === r.agent);
  const keyConfirmed = knownAgent || (!!r && pastedKey.trim() === r.agent);
  const running = t.sessionActive && !!session;

  const approve = async () => {
    if (!r || !keyConfirmed) return;
    setErr("");
    const res = await t.approveBudget(r);
    if (res.ok) dismiss();
    else if (res.validation) setErr(res.msg);
  };

  return (
    <section className="panel panel--pad" aria-label="Budget request from your agent">
      <div className="eyebrow">Budget request{r ? ` · ${shortAddr(r.agent)}` : ""}</div>
      {problem || !r ? (
        <>
          <div className="panel__note">{problem || "This link carries no readable request."}</div>
          <div>
            <button className="linkbtn" onClick={dismiss} type="button">dismiss</button>
          </div>
        </>
      ) : (
        <>
          <div className="panel__title">“{r.task}”</div>
          <div className="panel__kv"><span>Up to</span><span className="num">{fmtXlm(r.limit)} {t.tokenCode}</span></div>
          <div className="panel__kv"><span>For</span><span className="num">{r.hours} {r.hours === 1 ? "hour" : "hours"}</span></div>
          <div className="panel__kv">
            <span>Agent key</span>
            <a className="num" style={fullAddr} href={`${EXPLORER}/account/${r.agent}`} target="_blank" rel="noreferrer">
              {r.agent} ↗
            </a>
          </div>
          {knownAgent ? (
            <div className="panel__note">This is the agent already working for this treasury.</div>
          ) : (
            <label className="lab">
              <span className="eyebrow">A key this treasury has not worked with</span>
              <input
                className="field field--mono"
                aria-label="Your agent's public key"
                placeholder="Paste the key your agent printed (eunomia-mcp init)"
                spellCheck={false}
                value={pastedKey}
                onChange={(e) => setPastedKey(e.target.value)}
              />
              <span className="panel__note">
                Anyone can send a link like this one. Approve only when the key your own agent printed matches it
                {pastedKey.trim() && !keyConfirmed ? " — this one does not." : "."}
              </span>
            </label>
          )}
          <div className="eyebrow" style={{ marginTop: 6 }}>May pay only</div>
          {r.payees.map((p) => (
            <div className="panel__kv" key={p}>
              <span className="num" style={{ ...fullAddr, textAlign: "left" }}>{p}</span>
              <span>{approved[p] === undefined ? "checking…" : approved[p] ? "approved payee" : "not on your approved list"}</span>
            </div>
          ))}
          {r.payees.some((p) => approved[p] === false) && (
            <div className="panel__note">
              A budget does not approve payees. The agent cannot pay one that is not on your list — approve it on
              Payments if you mean to.
            </div>
          )}
          <div className="panel__note">
            Your daily, per-payment and monthly limits still apply inside this budget.
            {running ? " Approving replaces the Leash that is running now." : ""}
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button className="btn btn--lg" onClick={() => void approve()} disabled={!!t.busy || !keyConfirmed} type="button">
              {t.busy === "session" ? "Approving…" : "Approve budget"}
            </button>
            <button className="linkbtn" onClick={dismiss} type="button">not now</button>
          </div>
          {!keyConfirmed && (
            <div className="panel__note">Paste your agent's key in the box above to unlock Approve budget.</div>
          )}
          <div className="panel__note">Link valid until {new Date(r.expires * 1000).toLocaleString()}.</div>
          {err && <div className="err">{err}</div>}
        </>
      )}
    </section>
  );
}
