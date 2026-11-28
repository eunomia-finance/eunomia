// The mandatory step between "wallet deployed" and "you're in": mint a recovery
// code, make the user save it, then write the wallet-scoped recovery signer on
// chain. The code is shown exactly once and never leaves the browser.
//
// All behaviour lives in tested lib code (recoveryFlow / walletKit); this file
// is presentation and sequencing only.
import { useState } from "react";
import { mintRecoveryCode } from "../../lib/recoveryFlow";
import { activateRecovery } from "../../lib/walletKit";
import { errText } from "../../lib/wallet-errors";

export default function RecoverySetup({
  address,
  onDone,
}: {
  /** The freshly created smart-wallet address the code must point at. */
  address: string;
  /** Called once the signer is on chain — or after the explicit unhappy escape. */
  onDone: () => void;
}) {
  // Minted once per mount: re-renders must not rotate the code under the user.
  const [minted] = useState(() => mintRecoveryCode(address));
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fails, setFails] = useState(0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(minted.code);
      setCopied(true);
    } catch {
      /* clipboard can be unavailable — the code stays selectable */
    }
  };

  const download = () => {
    const blob = new Blob(
      [
        "Eunomia recovery code\n",
        "Keep this offline. Anyone with it can re-key your treasury.\n\n",
        `${minted.code}\n`,
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "eunomia-recovery-code.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const activate = async () => {
    setErr("");
    setBusy(true);
    try {
      await activateRecovery(minted.publicKey, address);
      onDone();
    } catch (e) {
      setErr(errText(e) || "Couldn't back up your access. Try again.");
      setFails((f) => f + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={backdrop} role="dialog" aria-modal="true" aria-label="Save your recovery code">
      <div style={card}>
        <div style={tag}>One more step</div>
        <h2 style={title}>Save your recovery code</h2>
        <p style={body}>
          Your passkey lives on this device. If the device is ever lost, this code is the
          only way back into your treasury — we can't recover it for you.
        </p>

        <div style={codeBox}>
          <code style={codeText}>{minted.code}</code>
        </div>

        <div style={row}>
          <button style={ghostBtn} onClick={() => void copy()} type="button">
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <button style={ghostBtn} onClick={download} type="button">
            Download .txt
          </button>
        </div>

        <p style={note}>
          Keep it offline. The code can't spend from your treasury on its own, but anyone
          holding it could re-key your account — treat it like a key, not a note.
        </p>

        <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} onClick={() => void activate()} disabled={busy} type="button">
          {busy ? "Backing up on Stellar…" : "I saved it — finish setup"}
        </button>

        {err && <p style={inlineErr}>{err}</p>}

        {/* The step is mandatory, but a broken relay must not lock a paying user out of
            their own fresh wallet. The escape appears only after repeated failures. */}
        {fails >= 2 && (
          <button style={escapeLink} onClick={onDone} type="button">
            Continue without backup (you can't add one later yet — not recommended)
          </button>
        )}
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
const codeBox: React.CSSProperties = {
  marginTop: 14, padding: "13px 14px", borderRadius: 12,
  background: "var(--surface)", border: "1px solid var(--line)",
};
const codeText: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5,
  overflowWrap: "anywhere", lineHeight: 1.6, userSelect: "all",
};
const row: React.CSSProperties = { display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" };
const ghostBtn: React.CSSProperties = {
  padding: "9px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13.5, fontFamily: "inherit",
  background: "transparent", border: "1px solid var(--line)", color: "var(--ink)",
};
const note: React.CSSProperties = { color: "var(--ink-2)", fontSize: 12.5, lineHeight: 1.55, marginTop: 12 };
const primaryBtn: React.CSSProperties = {
  marginTop: 14, width: "100%", padding: "13px 18px", borderRadius: 11, border: "none",
  cursor: "pointer", background: "var(--ink)", color: "var(--bg)", fontWeight: 600,
  fontSize: 14.5, fontFamily: "inherit",
};
const inlineErr: React.CSSProperties = { marginTop: 10, fontSize: 12.5, color: "var(--red)" };
const escapeLink: React.CSSProperties = {
  display: "block", margin: "12px auto 0", background: "none", border: "none", cursor: "pointer",
  color: "var(--ink-2)", fontSize: 12.5, fontFamily: "inherit", textDecoration: "underline",
};
