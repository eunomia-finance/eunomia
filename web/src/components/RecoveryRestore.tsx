// "Lost your passkey?" — paste the recovery code, register a fresh passkey on
// this device, and let the recovery signer authorize it on the wallet.
//
// All behaviour lives in tested lib code (recoveryFlow / walletKit); this file
// is presentation and sequencing only.
import { useState } from "react";
import { connectPasskeyRecovery } from "../../lib/walletKit";
import { errText } from "../../lib/wallet-errors";

export default function RecoveryRestore({
  onDone,
  onClose,
}: {
  /** Called with the session adopted — route into the workspace. */
  onDone: () => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const restore = async () => {
    setErr("");
    setBusy(true);
    try {
      await connectPasskeyRecovery(code);
      onDone();
    } catch (e) {
      setErr(errText(e) || "Couldn't restore access. Check the code and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={backdrop} role="dialog" aria-modal="true" aria-label="Restore access">
      <div style={card}>
        <div style={tag}>Recovery</div>
        <h2 style={title}>Restore access</h2>
        <p style={body}>
          Paste the recovery code you saved when you created your treasury. You'll register
          a fresh passkey on this device, and the code authorizes it on your account.
        </p>

        <textarea
          style={inputBox}
          rows={3}
          placeholder="EUN1.S….C…"
          aria-label="Recovery code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (err) setErr("");
          }}
        />

        <button
          style={{ ...primaryBtn, opacity: busy || !code.trim() ? 0.6 : 1 }}
          onClick={() => void restore()}
          disabled={busy || !code.trim()}
          type="button"
        >
          {busy ? "Restoring…" : "Restore with a new passkey"}
        </button>

        {err && <p style={inlineErr}>{err}</p>}

        <button style={closeLink} onClick={onClose} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center",
  padding: 16, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)",
};
const card: React.CSSProperties = {
  width: "min(520px, 100%)", boxSizing: "border-box", padding: "26px 24px", borderRadius: 16,
  background: "var(--bg)", border: "1px solid var(--line)", color: "var(--ink)",
};
const tag: React.CSSProperties = {
  fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-2)",
};
const title: React.CSSProperties = {
  margin: "8px 0 0", fontSize: 26, letterSpacing: "-0.02em", lineHeight: 1.2,
  fontFamily: "'Questrial', system-ui, sans-serif", fontWeight: 500,
};
const body: React.CSSProperties = { color: "var(--ink-2)", fontSize: 14, lineHeight: 1.6, marginTop: 10 };
const inputBox: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", marginTop: 14, padding: "12px 13px", borderRadius: 12,
  background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", resize: "vertical",
};
const primaryBtn: React.CSSProperties = {
  marginTop: 14, width: "100%", padding: "13px 18px", borderRadius: 11, border: "none",
  cursor: "pointer", background: "var(--ink)", color: "var(--bg)", fontWeight: 600,
  fontSize: 14.5, fontFamily: "inherit",
};
const inlineErr: React.CSSProperties = { marginTop: 10, fontSize: 12.5, color: "var(--red)" };
const closeLink: React.CSSProperties = {
  display: "block", margin: "12px auto 0", background: "none", border: "none", cursor: "pointer",
  color: "var(--ink-2)", fontSize: 12.5, fontFamily: "inherit",
};
