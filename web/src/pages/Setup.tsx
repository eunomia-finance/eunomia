// The pre-treasury experience: a connect gate for visitors, then one screen that creates
// the treasury with its rules and starting funds in a single signature (treasury factory).
// The two optional pieces — a first payee, an agent on a Leash — stay folded until asked
// for, so a first-time owner sees three numbers and one button; opening an existing
// treasury by id is a single quiet line under the form.
import { useEffect, useState } from "react";
import { useTreasury } from "../state/useTreasury";
import { needsFunding, MIN_XLM } from "../lib/funding";
import { passkeyCapability } from "../lib/passkeySupport";
import type { View } from "../lib/routes";
import type { TokenCode } from "../lib/token";
import { errText } from "../lib/wallet-errors";
import { connectPasskey } from "../lib/walletKit";
import { shortAddr } from "../config";

export default function Setup({ onGo }: { onGo: (v: View) => void }) {
  const t = useTreasury();
  const [daily, setDaily] = useState("50");
  const [perTask, setPerTask] = useState("10");
  const [payee, setPayee] = useState("");
  const [agentKey, setAgentKey] = useState("");
  const [cap, setCap] = useState("25");
  const [hours, setHours] = useState("24");
  const [fundXlm, setFundXlm] = useState("20");
  // What the treasury holds is fixed at creation. USDC first: it is the one funded with TRY,
  // and the one a passkey owner can fill without ever needing XLM.
  const [token, setToken] = useState<TokenCode>("USDC");
  const [existing, setExisting] = useState("");
  const [err, setErr] = useState("");
  const [openErr, setOpenErr] = useState("");
  // The optional parts are folded; opening one reveals its fields, closing one clears them
  // so nothing hidden is ever sent.
  const [withPayee, setWithPayee] = useState(false);
  const [withAgent, setWithAgent] = useState(false);
  const [openExisting, setOpenExisting] = useState(false);
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
    const res = await t.deploy(daily, perTask, { payee, agentKey, capXlm: cap, hours, fundXlm, token });
    if (!res.ok && res.validation) setErr(res.msg);
  };

  const doOpen = () => {
    setOpenErr("");
    const res = t.openExisting(existing);
    if (!res.ok) setOpenErr(res.msg);
  };

  const togglePayee = () => {
    if (withPayee) setPayee("");
    setWithPayee((v) => !v);
  };
  const toggleAgent = () => {
    if (withAgent) setAgentKey("");
    setWithAgent((v) => !v);
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
  const payeeOn = withPayee && payee.trim() !== "";
  const agentOn = withAgent && agentKey.trim() !== "";
  const fundOn = token === "XLM" && Number(fundXlm) > 0;
  // A smart wallet never pays a fee — the relay does — so with a USDC treasury it needs no
  // XLM at all. Everyone else needs some: for fees, and for the starting funds of an XLM one.
  const wantsXlm = token === "XLM" || !t.address.startsWith("C");

  return (
    <div className="page">
      <div className="page__main">
        {t.creatingNew && t.treasuryId && (
          <div>
            <button className="linkbtn" onClick={t.cancelNewTreasury} type="button">← Back to your current treasury</button>
          </div>
        )}

        {wantsXlm && t.walletXlm !== undefined && needsFunding(t.walletXlm) && (
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
            per-payment cap at once. Enforced on Stellar, not by promise.
          </div>

          <div className="lab" style={{ marginTop: 6 }}>
            <span className="eyebrow">The treasury holds</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="Treasury currency">
              <button className={`chip${token === "USDC" ? " is-on" : ""}`} onClick={() => setToken("USDC")} aria-pressed={token === "USDC"} type="button">
                USDC · funded with TRY
              </button>
              <button className={`chip${token === "XLM" ? " is-on" : ""}`} onClick={() => setToken("XLM")} aria-pressed={token === "XLM"} type="button">
                XLM · funded from your wallet
              </button>
            </div>
          </div>

          <div className="two">
            <label className="lab">
              <span className="eyebrow">Daily limit ({token})</span>
              <input className="field field--mono" inputMode="decimal" aria-label={`Daily limit in ${token}`} value={daily} onChange={(e) => setDaily(e.target.value)} />
            </label>
            <label className="lab">
              <span className="eyebrow">Per-payment limit ({token})</span>
              <input className="field field--mono" inputMode="decimal" aria-label={`Per-payment limit in ${token}`} value={perTask} onChange={(e) => setPerTask(e.target.value)} />
            </label>
          </div>

          {token === "XLM" ? (
            <label className="lab">
              <span className="eyebrow">Starting funds (XLM)</span>
              <input className="field field--mono" inputMode="decimal" aria-label="Starting funds in XLM" value={fundXlm} onChange={(e) => setFundXlm(e.target.value)} />
              <span className="panel__note">Moved from your wallet into the treasury in the same signature. 0 opens it empty; you can add funds any time.</span>
            </label>
          ) : (
            <div className="panel__note">
              It opens empty. Right after, you add funds with TRY: a bank transfer goes in, USDC comes out into the
              treasury — with no wallet prompt.
            </div>
          )}

          {/* the optional parts, folded */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <button className={`chip${withPayee ? " is-on" : ""}`} onClick={togglePayee} type="button" aria-expanded={withPayee}>
              {withPayee ? "− " : "+ "}Approve a payee now
            </button>
            <button className={`chip${withAgent ? " is-on" : ""}`} onClick={toggleAgent} type="button" aria-expanded={withAgent}>
              {withAgent ? "− " : "+ "}Connect an agent now
            </button>
          </div>
          {!withPayee && !withAgent && (
            <div className="panel__note">Both can wait: payees are approved on the Payments page, agents get their Leash on the Agent page.</div>
          )}

          {withPayee && (
            <label className="lab">
              <span className="eyebrow">First approved payee</span>
              <input
                className="field field--mono"
                aria-label="First approved payee address"
                placeholder="G… or C… — the treasury can pay this address; anyone else is refused"
                spellCheck={false}
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
              />
            </label>
          )}

          {withAgent && (
            <>
              <label className="lab">
                <span className="eyebrow">Agent public key</span>
                <input
                  className="field field--mono"
                  aria-label="Agent public key for the Leash"
                  placeholder="G… — printed by `eunomia-mcp init` on the agent's machine"
                  spellCheck={false}
                  value={agentKey}
                  onChange={(e) => setAgentKey(e.target.value)}
                />
                <span className="panel__note">The agent gets a Leash with this signature: it pays on its own, up to the cap, until the deadline. Revoke any time.</span>
              </label>
              <div className="two">
                <label className="lab">
                  <span className="eyebrow">Leash cap ({token})</span>
                  <input className="field field--mono" inputMode="decimal" aria-label={`Leash spending cap in ${token}`} value={cap} onChange={(e) => setCap(e.target.value)} />
                </label>
                <label className="lab">
                  <span className="eyebrow">Duration (hours)</span>
                  <input className="field field--mono" inputMode="decimal" aria-label="Leash duration in hours" value={hours} onChange={(e) => setHours(e.target.value)} />
                </label>
              </div>
            </>
          )}

          <div style={{ marginTop: 6 }}>
            <button className="btn btn--lg" onClick={() => void doDeploy()} disabled={!!t.busy} type="button">
              {t.busy === "deploy" ? "Creating…" : "Create treasury"}
            </button>
          </div>
          {err && <div className="err">{err}</div>}
        </section>

        {/* the quiet second path: a treasury this browser does not know about */}
        <div style={{ padding: "0 4px" }}>
          {!openExisting ? (
            <button className="linkbtn" onClick={() => setOpenExisting(true)} type="button">
              Have a treasury from another device or wallet? Open it by its id
            </button>
          ) : (
            <section className="panel panel--pad">
              <div className="eyebrow">Open an existing treasury</div>
              <div className="rowline">
                <input
                  className="field field--mono"
                  style={{ flex: 1 }}
                  placeholder="Treasury contract id (C…)"
                  aria-label="Existing treasury contract id"
                  spellCheck={false}
                  autoFocus
                  value={existing}
                  onChange={(e) => {
                    setExisting(e.target.value);
                    // Clear the previous complaint as soon as the field is touched; leaving it up
                    // makes the page look like it is rejecting what is currently typed.
                    if (openErr) setOpenErr("");
                  }}
                />
                <button className="btn btn--ghost" onClick={doOpen} type="button">Open</button>
              </div>
              {openErr && <div className="err">{openErr}</div>}
              <div className="panel__note">
                The id is on the Settings page of the device that created it. Treasuries backed up on Stellar open by
                themselves when you sign in with the same wallet or passkey.
              </div>
            </section>
          )}
        </div>
      </div>

      {/* The one dark panel on this page: what that single signature does. */}
      <div className="page__side">
        <section className="verdict" style={{ gridTemplateColumns: "minmax(0,1fr)", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="eyebrow">One signature</div>
            <div className="verdict__line"><span className="verdict__amount" style={{ fontSize: 34 }}>does all of this</span></div>
            <ol style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5, lineHeight: 1.5 }}>
              <li>Creates the treasury: at most <span className="num">{daily || "0"} {token}</span> a day, <span className="num">{perTask || "0"} {token}</span> per payment.</li>
              <li>{fundOn ? <>Moves <span className="num">{fundXlm} XLM</span> in from your wallet.</> : token === "USDC" ? "Opens it empty; you add funds with TRY next." : "Opens it empty; you add funds later."}</li>
              {payeeOn && <li>Approves <span className="num">{shortAddr(payee.trim())}</span> as a payee.</li>}
              {agentOn && <li>Puts agent <span className="num">{shortAddr(agentKey.trim())}</span> on a <span className="num">{cap || "0"} {token}</span> / <span className="num">{hours || "0"} h</span> Leash.</li>}
              <li>Backs the treasury up on Stellar, so you can open it from any device.</li>
            </ol>
            <div className="verdict__why">Nothing is created half-way: if any part is refused, nothing happens.</div>
          </div>
        </section>
      </div>
    </div>
  );
}
