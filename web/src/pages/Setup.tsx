// The pre-treasury experience: a connect gate for visitors, then a two-step creation
// wizard (limits → deploy) in human language — no bare form dump. "Open an existing
// treasury" stays as the quiet secondary path.
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
    const res = await t.deploy(daily, perTask);
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
      <div style={gateWrap}>
        <div style={gateCard}>
          <div style={gateGlyph}>◭</div>
          <h1 style={gateTitle}>Give your agent a budget — not your wallet.</h1>
          <p style={gateSub}>
            Set the rules once. Every payment is checked and enforced on Stellar —
            anything outside the rules is blocked, automatically.
          </p>
          {passkeys && (
            <button
              style={{ ...primaryBtn, opacity: signingIn ? 0.6 : 1 }}
              onClick={() => void signInPasskey()}
              disabled={signingIn || t.busy === "connect"}
              type="button"
            >
              {signingIn ? "Opening…" : "Sign in with your passkey"}
            </button>
          )}
          <button
            style={{ ...(passkeys ? ghostBtn : primaryBtn), opacity: t.busy === "connect" ? 0.6 : 1 }}
            onClick={() => void t.connect()}
            disabled={t.busy === "connect" || signingIn}
            type="button"
          >
            {t.busy === "connect" ? "Connecting…" : "Connect wallet"}
          </button>
          {signInErr && <div style={inlineErr}>{signInErr}</div>}
          <button style={demoLink} onClick={() => onGo("dashboard")} type="button">
            watch the demo →
          </button>
        </div>
      </div>
    );
  }

  // ---- creation wizard ----------------------------------------------------------
  return (
    <div style={wizWrap}>
      {t.creatingNew && t.treasuryId && (
        <button style={backLink} onClick={t.cancelNewTreasury} type="button">
          ← Back to your current treasury
        </button>
      )}
      <h1 style={wizTitle}>Set up your treasury</h1>
      <p style={wizSub}>Two steps: set your rules, then create it. Enforcement is automatic.</p>

      {t.walletXlm !== undefined && needsFunding(t.walletXlm) && (
        <div style={stepCard}>
          <div style={stepTag}>Step 0 — testnet XLM</div>
          <div style={stepBody}>
            {t.walletXlm === null
              ? "Your wallet doesn't exist on testnet yet (0 XLM). "
              : `Your wallet holds ${t.walletXlm.toFixed(2)} XLM on testnet. `}
            You need ~{MIN_XLM} XLM to deploy and fund a treasury — it's free.
          </div>
          <button
            style={{ ...primaryBtn, opacity: t.busy ? 0.6 : 1 }}
            onClick={() => void t.friendbot()}
            disabled={!!t.busy}
            type="button"
          >
            {t.busy === "friendbot" ? "Funding…" : "Get free testnet XLM"}
          </button>
        </div>
      )}

      <div style={stepCard}>
        <div style={stepTag}>Step 1 — set your rules</div>
        <div style={fieldLabel}>Daily limit (XLM)</div>
        <input
          style={input}
          inputMode="decimal"
          aria-label="Daily limit in XLM"
          value={daily}
          onChange={(e) => setDaily(e.target.value)}
        />
        <div style={fieldLabel}>Per-payment limit (XLM)</div>
        <input
          style={input}
          inputMode="decimal"
          aria-label="Per-payment limit in XLM"
          value={perTask}
          onChange={(e) => setPerTask(e.target.value)}
        />
        <div style={stepBody}>
          Your agent can never spend past the daily cap in any rolling 24 hours, and never
          more than the per-payment cap at once — enforced on Stellar, not by promise.
        </div>
      </div>

      <div style={stepCard}>
        <div style={stepTag}>Step 2 — create</div>
        <button
          style={{ ...primaryBtn, opacity: t.busy ? 0.6 : 1 }}
          onClick={() => void doDeploy()}
          disabled={!!t.busy}
          type="button"
        >
          {t.busy === "deploy" ? "Creating…" : "Create treasury"}
        </button>
        {err && <div style={inlineErr}>{err}</div>}
        <div style={hint}>
          Creating asks for <strong>two</strong> wallet approvals: ① create your treasury,
          ② back it up on Stellar so you can open it from any device — ② is optional;
          skip it and your treasury ID is the only key: save it.
        </div>
      </div>

      <div style={divider} />
      <div style={secondary}>
        <div style={fieldLabel}>Already have a treasury?</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            style={{ ...input, flex: 1, minWidth: 220, marginTop: 0 }}
            placeholder="Treasury contract id (C…)"
            aria-label="Existing treasury contract id"
            value={existing}
            onChange={(e) => {
              setExisting(e.target.value);
              // Clear the previous complaint as soon as the field is touched; leaving it up
              // makes the page look like it is rejecting what is currently typed.
              if (openErr) setOpenErr("");
            }}
          />
          <button style={ghostBtn} onClick={doOpen} type="button">
            Open it
          </button>
        </div>
        {openErr && <div style={inlineErr}>{openErr}</div>}
      </div>
    </div>
  );
}

const backLink: React.CSSProperties = {
  background: "none", border: "none", padding: 0, marginBottom: 14, cursor: "pointer",
  color: "var(--ink-2)", fontSize: 13, fontFamily: "inherit",
};
const gateWrap: React.CSSProperties = { minHeight: "70vh", display: "grid", placeItems: "center" };
const gateCard: React.CSSProperties = { maxWidth: 440, textAlign: "center", padding: "24px 16px" };
const gateGlyph: React.CSSProperties = { fontSize: 40, color: "var(--ink)", marginBottom: 14 };
const gateTitle: React.CSSProperties = {
  margin: 0, fontSize: 30, letterSpacing: "-0.02em",
  fontFamily: "'Questrial', system-ui, sans-serif", fontWeight: 500, color: "var(--ink)", lineHeight: 1.2,
};
const gateSub: React.CSSProperties = { color: "var(--ink-2)", fontSize: 14.5, lineHeight: 1.6, marginTop: 12 };
const demoLink: React.CSSProperties = {
  display: "block", margin: "14px auto 0", background: "none", border: "none", cursor: "pointer",
  color: "var(--ink-2)", fontSize: 13, fontFamily: "inherit",
};
const wizWrap: React.CSSProperties = { maxWidth: 560, margin: "0 auto" };
const wizTitle: React.CSSProperties = {
  margin: 0, fontSize: 27, letterSpacing: "-0.02em",
  fontFamily: "'Questrial', system-ui, sans-serif", fontWeight: 500, color: "var(--ink)",
};
const wizSub: React.CSSProperties = { color: "var(--ink-2)", fontSize: 14, marginTop: 6, marginBottom: 18 };
const stepCard: React.CSSProperties = {
  padding: 18, borderRadius: 14, marginBottom: 14,
  background: "var(--surface)", border: "1px solid var(--line)",
};
const stepTag: React.CSSProperties = {
  fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink)", marginBottom: 8,
};
const stepBody: React.CSSProperties = { fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, marginTop: 10 };
const fieldLabel: React.CSSProperties = {
  fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-2)", marginTop: 10,
};
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", marginTop: 8, padding: "11px 13px", borderRadius: 10,
  background: "var(--bg)", border: "1px solid var(--line)", color: "var(--ink)",
};
const primaryBtn: React.CSSProperties = {
  marginTop: 12, padding: "12px 18px", borderRadius: 11, border: "none", cursor: "pointer",
  background: "var(--ink)", color: "var(--bg)", fontWeight: 600, fontSize: 14.5, fontFamily: "inherit",
};
const ghostBtn: React.CSSProperties = {
  padding: "11px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontFamily: "inherit",
  background: "transparent", border: "1px solid var(--line)", color: "var(--ink-2)",
};
const hint: React.CSSProperties = { marginTop: 10, fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 };
const inlineErr: React.CSSProperties = { marginTop: 8, fontSize: 12.5, color: "var(--red)" };
const divider: React.CSSProperties = { height: 1, background: "var(--line)", margin: "22px 0 14px" };
const secondary: React.CSSProperties = { opacity: 0.9 };
