// Treasury settings: identity (full ID + registry status with catch-up registration), live
// limit updates, and the owner exits (pause / withdraw — the paths that keep working even
// while paused). The exits sit in a red-framed panel apart from day-to-day edits.
import { useState } from "react";
import { EXPLORER, fmtXlm, shortAddr } from "../config";
import WithdrawTry from "../components/WithdrawTry";
import { useTreasury } from "../state/useTreasury";

export default function Settings() {
  const t = useTreasury();
  const treasuryId = t.treasuryId as string;
  const registered = t.treasuries.find((x) => x.id === treasuryId)?.registered ?? false;

  const [copied, setCopied] = useState(false);
  const [newDaily, setNewDaily] = useState("");
  const [newPerTask, setNewPerTask] = useState("");
  const [limitsErr, setLimitsErr] = useState("");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [withdrawErr, setWithdrawErr] = useState("");

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(treasuryId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions) — the explorer link still exposes the full id.
    }
  };

  const doLimits = async () => {
    setLimitsErr("");
    const res = await t.updateLimits(newDaily, newPerTask);
    if (res.ok) {
      setNewDaily("");
      setNewPerTask("");
    } else if (res.validation) setLimitsErr(res.msg);
  };

  const doWithdraw = async () => {
    setWithdrawErr("");
    const res = await t.withdraw(withdrawTo, withdrawAmt);
    if (res.ok) setWithdrawAmt("");
    else if (res.validation) setWithdrawErr(res.msg);
  };

  return (
    <div className="page">
      <div className="page__main">
        {/* ---- treasury identity ---- */}
        <section className="panel panel--pad">
          <div className="panel__head">
            <div className="eyebrow">Treasury</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="chip" onClick={copyId} type="button">{copied ? "Copied ✓" : "Copy ID"}</button>
              <a className="chip" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }} href={`${EXPLORER}/contract/${treasuryId}`} target="_blank" rel="noreferrer">
                Explorer ↗
              </a>
            </div>
          </div>
          <span className="code">{treasuryId}</span>
          <div className="panel__kv"><span>Owner</span><span className="num">{t.address ? shortAddr(t.address) : "—"}</span></div>
          <div className="panel__kv">
            <span>Backed up on Stellar</span>
            {registered ? <span className="pill pill--ok">yes</span> : <span className="pill pill--no">no</span>}
          </div>
          {!registered && (
            <div className="rowline">
              <span className="err">This device's storage is the only key to this treasury. Save the ID, or back it up now.</span>
              <button className="btn" onClick={() => void t.registerActive()} disabled={!!t.busy} type="button">
                {t.busy === "register" ? "Backing up…" : "Back up on Stellar"}
              </button>
            </div>
          )}
          {registered && <div className="panel__note">Open it from any device by signing in with the same wallet or passkey.</div>}
        </section>

        {/* ---- limits ---- */}
        <section className="panel panel--pad">
          <div className="eyebrow">Limits</div>
          {t.state && (
            <>
              <div className="panel__kv"><span>Per day</span><span className="num">{fmtXlm(t.state.dailyLimit)} {t.tokenCode}</span></div>
              <div className="panel__kv"><span>Per payment</span><span className="num">{fmtXlm(t.state.perTaskLimit)} {t.tokenCode}</span></div>
            </>
          )}
          <div className="two" style={{ marginTop: 6 }}>
            <label className="lab">
              <span className="eyebrow">New daily limit ({t.tokenCode})</span>
              <input
                className="field field--mono"
                inputMode="decimal"
                aria-label={`New daily limit in ${t.tokenCode}`}
                placeholder={t.state ? fmtXlm(t.state.dailyLimit) : ""}
                value={newDaily}
                onChange={(e) => setNewDaily(e.target.value)}
              />
            </label>
            <label className="lab">
              <span className="eyebrow">New per-payment limit ({t.tokenCode})</span>
              <input
                className="field field--mono"
                inputMode="decimal"
                aria-label={`New per-payment limit in ${t.tokenCode}`}
                placeholder={t.state ? fmtXlm(t.state.perTaskLimit) : ""}
                value={newPerTask}
                onChange={(e) => setNewPerTask(e.target.value)}
              />
            </label>
          </div>
          <div className="rowline">
            <span className="panel__note">
              {t.legacy ? "This is an early treasury — limit updates need a fresh treasury." : "Effective immediately, enforced on Stellar."}
            </span>
            <button className="btn" onClick={() => void doLimits()} disabled={!!t.busy || t.legacy} type="button">
              {t.busy === "limits" ? "Updating…" : "Update limits"}
            </button>
          </div>
          {limitsErr && <div className="err">{limitsErr}</div>}
        </section>
      </div>

      {/* The exit paths sit apart from the settings you change day to day — pausing and
          withdrawing are not edits, they are ways out. */}
      <div className="page__side">
        <section className="panel panel--pad panel--exit">
          <div className="eyebrow" style={{ color: "var(--red)" }}>Owner exits</div>
          {t.legacy ? (
            <div className="panel__note">
              This early treasury has no withdraw of its own. To move funds out: approve your own wallet as a payee
              (Payments), then pay yourself within the limits
              {t.state ? ` (≤ ${fmtXlm(t.state.perTaskLimit)} ${t.tokenCode} per payment · ≤ ${fmtXlm(t.state.dailyLimit)} ${t.tokenCode} per day)` : ""}.
              Or create a fresh treasury from the switcher — pause, withdraw and the Leash all live there.
            </div>
          ) : (
            <>
              <div className="rowline">
                <span className="panel__note">
                  {t.lifecycle?.paused ? "Spending is frozen — every payment is refused. Withdraw still works." : "Freeze every payment at once. Withdraw keeps working."}
                </span>
                <button className="btn btn--danger" onClick={() => void t.togglePause()} disabled={!!t.busy} type="button">
                  {t.busy === "pause" ? "Working…" : t.lifecycle?.paused ? "Resume spending" : "Pause spending"}
                </button>
              </div>
              <div className="eyebrow" style={{ marginTop: 8 }}>Withdraw · works while paused</div>
              <input
                className="field field--mono"
                placeholder={`To (default: your wallet ${t.address ? shortAddr(t.address) : ""})`}
                aria-label="Withdraw destination address"
                spellCheck={false}
                value={withdrawTo}
                onChange={(e) => setWithdrawTo(e.target.value)}
              />
              <div className="rowline">
                <input
                  className="field field--mono"
                  style={{ flex: 1 }}
                  inputMode="decimal"
                  placeholder={`Amount (${t.tokenCode})`}
                  aria-label={`Withdraw amount in ${t.tokenCode}`}
                  value={withdrawAmt}
                  onChange={(e) => setWithdrawAmt(e.target.value)}
                />
                <button className="btn btn--danger" onClick={() => void doWithdraw()} disabled={!!t.busy} type="button">
                  {t.busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
                </button>
              </div>
              {t.tokenCode === "USDC" && (
                <div className="panel__note">
                  A G… account can receive USDC only after it trusts the issuer; without that trustline Stellar
                  refuses the withdrawal. A passkey wallet (C…) needs nothing.
                </div>
              )}
              {withdrawErr && <div className="err">{withdrawErr}</div>}
              {/* The anchor leg in reverse — only a USDC treasury holds what the anchor takes. */}
              {t.tokenCode === "USDC" && <WithdrawTry />}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
