// The pre-treasury experience: a connect gate for visitors, then one screen that creates
// the treasury with its rules, first payee, agent Leash and starting funds in a single
// signature (treasury factory). "Open an existing treasury" stays as the quiet second path.
import { useEffect, useState } from "react";
import { useTreasury } from "../state/useTreasury";
import { needsFunding, MIN_XLM } from "../lib/funding";
import { passkeyCapability } from "../lib/passkeySupport";
import type { View } from "../lib/routes";
import { errText } from "../lib/wallet-errors";
import { connectPasskey } from "../lib/walletKit";

export default function Setup({ onGo }: { onGo: (v: View) => void }) {
  const t = useTreasury();
  const [daily, setDaily] = useState("50");
  const [perTask, setPerTask] = useState("10");
  const [payee, setPayee] = useState("");
  const [agentKey, setAgentKey] = useState("");
  const [cap, setCap] = useState("25");
  const [hours, setHours] = useState("24");
  const [fundXlm, setFundXlm] = useState("20");
  const [existing, setExisting] = useState("");
  const [err, setErr] = useState("");
  const [openErr, setOpenErr] = useState("");
  // The gate also has to let a passkey user back in: someone who lands on #overview with
  // no session (new browser, cleared storage) must not be funnelled into a wallet modal.
  const [passkeys, setPasskeys] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signInErr, setSignInErr] = useState("");
  useEffect(() => {
    void passkeyCapability(window).then((c) => setPasskeys(c !== "none"));
  }, []);

  const signInPasskey = async () => {
    setSignInErr("");
    setSigningIn(true);
    try {
      // The provider follows the shared address store, so the treasury opens by itself.
      await connectPasskey("connect");
    } catch (e) {
      setSignInErr(errText(e) || "Couldn't open your wallet with that passkey.");
    } finally {
      setSigningIn(false);
    }
  };

  const doDeploy = async () => {
    setErr("");
    const res = await t.deploy(daily, perTask, { payee, agentKey, capXlm: cap, hours, fundXlm });
    if (!res.ok && res.validation) setErr(res.msg);
  };

  const doOpen = () => {
    setOpenErr("");
    const res = t.openExisting(existing);
    if (!res.ok) setOpenErr(res.msg);
  };

  // ---- connect gate -------------------------------------------------------------
  if (!t.address) {
    return (
      <div style={{ minHeight: "70vh", display: "grid", placeItems: "center" }}>
        <div style={{ maxWidth: 440, textAlign: "center", padding: "24px 16px", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 40, color: "var(--ink)" }}>◭</div>
          <h1 className="panel__title" style={{ margin: 0, fontSize: 30, fontWeight: 500 }}>Give your agent a budget — not your wallet.</h1>
          <p className="panel__note" style={{ margin: 0, fontSize: 14.5 }}>
            Set the rules once. Every payment is checked and enforced on Stellar — anything outside the rules is
            blocked, automatically.
          </p>
          {passkeys && (
            <button className="btn btn--lg" onClick={() => void signInPasskey()} disabled={signingIn || t.busy === "connect"} type="button">
              {signingIn ? "Opening…" : "Sign in with your passkey"}
            </button>
          )}
          <button
            className={passkeys ? "btn btn--ghost" : "btn btn--lg"}
            onClick={() => void t.connect()}
            disabled={t.busy === "connect" || signingIn}
            type="button"
          >
            {t.busy === "connect" ? "Connecting…" : "Connect wallet"}
          </button>
          {signInErr && <div className="err">{signInErr}</div>}
          <button className="linkbtn" onClick={() => onGo("dashboard")} type="button">watch the demo →</button>
        </div>
      </div>
    );
  }

  // ---- one-screen creation --------------------------------------------------------
  const leashOn = agentKey.trim() !== "";
  const fundOn = Number(fundXlm) > 0;

  return (
    <div className="page">
      <div className="page__main">
        {t.creatingNew && t.treasuryId && (
          <div>
            <button className="linkbtn" onClick={t.cancelNewTreasury} type="button">← Back to your current treasury</button>
          </div>
        )}

        {t.walletXlm !== undefined && needsFunding(t.walletXlm) && (
          <div className="notice">
            <span>
              {t.walletXlm === null ? "Your wallet doesn't exist on testnet yet (0 XLM). " : `Your wallet holds ${t.walletXlm.toFixed(2)} XLM on testnet. `}
              You need ~{MIN_XLM} XLM to create and fund a treasury — it's free.
            </span>
            <button className="btn btn--ghost" onClick={() => void t.friendbot()} disabled={!!t.busy} type="button">
              {t.busy === "friendbot" ? "Funding…" : "Get free testnet XLM"}
            </button>
          </div>
        )}

        <section className="panel panel--pad">
          <div className="eyebrow">New treasury</div>
          <div className="panel__title">Set the rules once.</div>
          <div className="panel__note">
            Your agent can never spend past the daily cap in any rolling 24 hours, and never more than the
            per-payment cap at once — enforced on Stellar, not by promise.
          </div>

          <div className="two" style={{ marginTop: 6 }}>
            <label className="lab">
              <span className="eyebrow">Daily limit (XLM)</span>
              <input className="field field--mono" inputMode="decimal" aria-label="Daily limit in XLM" value={daily} onChange={(e) => setDaily(e.target.value)} />
            </label>
            <label className="lab">
              <span className="eyebrow">Per-payment limit (XLM)</span>
              <input className="field field--mono" inputMode="decimal" aria-label="Per-payment limit in XLM" value={perTask} onChange={(e) => setPerTask(e.target.value)} />
            </label>
          </div>

          <label className="lab">
            <span className="eyebrow">First approved payee (optional)</span>
            <input
              className="field field--mono"
              aria-label="First approved payee address"
              placeholder="G… or C… — anyone else is refused"
              spellCheck={false}
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
            />
          </label>

          <label className="lab">
            <span className="eyebrow">Agent public key (optional)</span>
            <input
              className="field field--mono"
              aria-label="Agent public key for the Leash"
              placeholder="G… — printed by `eunomia-mcp init`"
              spellCheck={false}
              value={agentKey}
              onChange={(e) => setAgentKey(e.target.value)}
            />
          </label>
          {leashOn && (
            <div className="two">
              <label className="lab">
                <span className="eyebrow">Leash cap (XLM)</span>
                <input className="field field--mono" inputMode="decimal" aria-label="Leash spending cap in XLM" value={cap} onChange={(e) => setCap(e.target.value)} />
              </label>
              <label className="lab">
                <span className="eyebrow">Duration (hours)</span>
                <input className="field field--mono" inputMode="decimal" aria-label="Leash duration in hours" value={hours} onChange={(e) => setHours(e.target.value)} />
              </label>
            </div>
          )}

          <label className="lab">
            <span className="eyebrow">Starting funds (XLM)</span>
            <input className="field field--mono" inputMode="decimal" aria-label="Starting funds in XLM" value={fundXlm} onChange={(e) => setFundXlm(e.target.value)} />
            <span className="panel__note">Moved from your wallet into the treasury in the same transaction. Leave 0 to fund later.</span>
          </label>

          <div style={{ marginTop: 6 }}>
            <button className="btn btn--lg" onClick={() => void doDeploy()} disabled={!!t.busy} type="button">
              {t.busy === "deploy" ? "Creating…" : "Create treasury — one signature"}
            </button>
          </div>
          {err && <div className="err">{err}</div>}
        </section>

        <section className="panel panel--pad">
          <div className="eyebrow">Already have a treasury?</div>
          <div className="rowline">
            <input
              className="field field--mono"
              style={{ flex: 1 }}
              placeholder="Treasury contract id (C…)"
              aria-label="Existing treasury contract id"
              spellCheck={false}
              value={existing}
              onChange={(e) => {
                setExisting(e.target.value);
                // Clear the previous complaint as soon as the field is touched; leaving it up
                // makes the page look like it is rejecting what is currently typed.
                if (openErr) setOpenErr("");
              }}
            />
            <button className="btn btn--ghost" onClick={doOpen} type="button">Open it</button>
          </div>
          {openErr && <div className="err">{openErr}</div>}
        </section>
      </div>

      {/* The one dark panel on this page: what that single signature does. */}
      <div className="page__side">
        <section className="verdict" style={{ gridTemplateColumns: "minmax(0,1fr)", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="eyebrow">That one signature</div>
            <div className="verdict__line"><span className="verdict__amount" style={{ fontSize: 34 }}>does all of this</span></div>
            <ol style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5, lineHeight: 1.5 }}>
              <li>Creates the treasury with <span className="num">{daily || "0"} XLM</span> a day, <span className="num">{perTask || "0"} XLM</span> a payment.</li>
              <li style={{ opacity: payee.trim() ? 1 : 0.55 }}>{payee.trim() ? "Approves your first payee." : "First payee — none yet (approve later)."}</li>
              <li style={{ opacity: leashOn ? 1 : 0.55 }}>{leashOn ? `Puts the agent on a ${cap || "0"} XLM / ${hours || "0"} h Leash.` : "Leash — none yet (start one later)."}</li>
              <li style={{ opacity: fundOn ? 1 : 0.55 }}>{fundOn ? `Moves ${fundXlm} XLM in from your wallet.` : "Starting funds — none (fund later)."}</li>
              <li>Backs the treasury up on Stellar, so you can open it from any device.</li>
            </ol>
            <div className="verdict__why">Nothing is created half-way: if any part is refused, nothing happens.</div>
          </div>
        </section>
      </div>
    </div>
  );
}
