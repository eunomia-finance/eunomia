// "Withdraw to your bank": what the agent did not spend goes back to where it came from —
// USDC out of the treasury, TRY into an IBAN, through the same anchor that brought it in.
//
// One owner signature, and it comes in the middle on purpose: the rate is locked and the
// anchor's instructions are in hand *before* the treasury releases anything, so a refusal
// from the anchor costs nothing (see lib/anchor/withdrawToBank.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { EXPLORER, fmtXlm, shortAddr } from "../config";
import { theAnchor } from "../lib/anchor/addFunds";
import { fundingKey } from "../lib/anchor/fundingAccount";
import { isValidTrIban, normalizeIban } from "../lib/anchor/iban";
import { indicativePrice, type Price } from "../lib/anchor/quotes";
import { finishWithdrawal, startWithdrawal, type FinishedWithdrawal, type WithdrawStep } from "../lib/anchor/withdrawToBank";
import { useTreasury } from "../state/useTreasury";

// The anchor's per-withdrawal window (its /sep6/info).
const MIN_USDC = 1;
const MAX_USDC = 300;
// A checksum-valid IBAN for testers who have none at hand; the sandbox pays nobody.
const SAMPLE_IBAN = "TR330006100519786457841326";

const STEP_LINE: Record<WithdrawStep | "treasury", string> = {
  account: "Opening the funding account",
  "sign-in": "Signing in to the anchor",
  quote: "Locking the rate",
  instructions: "Asking where to send it",
  treasury: "Releasing it from the treasury — confirm",
  send: "Sending the USDC to the anchor",
  anchor: "Anchor is paying TRY",
};

const errLine = (e: unknown) => (e instanceof Error && e.message ? e.message : "Something went wrong talking to the anchor.");

export default function WithdrawTry() {
  const t = useTreasury();
  const treasuryId = t.treasuryId as string;
  const funding = useMemo(() => fundingKey(treasuryId), [treasuryId]);

  const [amount, setAmount] = useState("");
  const [iban, setIban] = useState("");
  const [preview, setPreview] = useState<Price | null>(null);
  const [step, setStep] = useState<WithdrawStep | "treasury" | null>(null);
  const [done, setDone] = useState<(FinishedWithdrawal & { releaseTx?: string; iban: string }) | null>(null);
  const [err, setErr] = useState("");

  const balance = t.state ? Number(t.state.balance) / 1e7 : 0;
  const value = Number(amount);
  const amountOk = Number.isFinite(value) && value >= MIN_USDC && value <= Math.min(MAX_USDC, balance);
  const ibanOk = isValidTrIban(iban);

  const asked = useRef(0);
  useEffect(() => {
    if (!amountOk) return;
    const mine = ++asked.current;
    const timer = setTimeout(() => {
      void theAnchor()
        .then((a) => indicativePrice(a, "withdraw", String(value)))
        .then((p) => mine === asked.current && setPreview(p))
        .catch(() => mine === asked.current && setPreview(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [amountOk, value]);

  const run = async () => {
    setErr("");
    try {
      const pending = await startWithdrawal(funding, String(value), iban, setStep);
      setStep("treasury");
      const released = await t.withdraw(funding.publicKey(), pending.usdcAmount);
      if (!released.ok) {
        // Nothing has left the treasury: the locked quote simply expires.
        setErr(released.msg);
        return;
      }
      const fin = await finishWithdrawal(funding, pending, setStep);
      setDone({ ...fin, releaseTx: released.hash, iban: normalizeIban(iban) });
      setAmount("");
    } catch (e) {
      setErr(`${errLine(e)} If USDC already left the treasury it is safe in the funding account — open Add funds on Overview to move it back in.`);
    } finally {
      setStep(null);
    }
  };

  if (done) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="rowline">
          <span className="eyebrow">Paid to your bank</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)" }}>
            <i className="mark mark--ok" />{done.transfer.bankRef ?? "sent"}
          </span>
        </div>
        <div className="meter__big">
          <span className="num">{done.tryAmount}</span>
          <small>TRY</small>
        </div>
        <div className="panel__kv"><span>From the treasury</span><span className="num">{Number(done.transfer.amountIn ?? 0) || ""} USDC</span></div>
        <div className="panel__kv"><span>To</span><span className="num" style={{ fontSize: 12.5 }}>{done.iban}</span></div>
        {done.releaseTx && (
          <div className="panel__kv">
            <span>Released</span>
            <a className="linkbtn num" href={`${EXPLORER}/tx/${done.releaseTx}`} target="_blank" rel="noreferrer">tx {shortAddr(done.releaseTx)} ↗</a>
          </div>
        )}
        <div className="panel__kv">
          <span>Sent to the anchor</span>
          <a className="linkbtn num" href={`${EXPLORER}/tx/${done.paymentTxHash}`} target="_blank" rel="noreferrer">tx {shortAddr(done.paymentTxHash)} ↗</a>
        </div>
        <div className="panel__note">This anchor is a testnet sandbox: the FAST payout is simulated, the USDC it received was real testnet USDC.</div>
        <div><button className="btn btn--ghost" onClick={() => setDone(null)} type="button">Done</button></div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="eyebrow" style={{ marginTop: 8 }}>Withdraw to your bank · TRY</div>
      <input
        className="field field--mono"
        inputMode="decimal"
        aria-label="Amount in USDC to withdraw to your bank"
        placeholder={`Amount (USDC) · ${MIN_USDC} – ${Math.min(MAX_USDC, Math.floor(balance))} `}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <input
        className="field field--mono"
        aria-label="IBAN to receive TRY"
        placeholder="IBAN — TR.. .... .... .... .... .... .."
        spellCheck={false}
        value={iban}
        onChange={(e) => setIban(e.target.value)}
      />
      {!iban && (
        <div><button className="linkbtn" onClick={() => setIban(SAMPLE_IBAN)} type="button">no IBAN at hand? use a sample one</button></div>
      )}
      {amountOk && preview ? (
        <>
          <div className="panel__kv"><span>You receive</span><span className="num">≈ {preview.buyAmount} TRY</span></div>
          <div className="panel__kv"><span>Anchor fee</span><span className="num">{Number(preview.feeTotal).toFixed(4)} USDC</span></div>
        </>
      ) : (
        <div className="panel__note">
          {amount.trim() && !amountOk
            ? `Between ${MIN_USDC} and ${Math.min(MAX_USDC, Math.floor(balance))} USDC — the treasury holds ${t.state ? fmtXlm(t.state.balance) : "0"}.`
            : "What the agent didn't spend, back to a bank account. The rate is locked before anything leaves the treasury; you sign once."}
        </div>
      )}
      {iban.trim() !== "" && !ibanOk && <div className="err">That is not a valid Turkish IBAN — check the digits.</div>}
      <div>
        <button className="btn btn--danger" onClick={() => void run()} disabled={!amountOk || !ibanOk || !!step || !!t.busy} type="button">
          {step ? `${STEP_LINE[step]}…` : "Withdraw to bank"}
        </button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}
