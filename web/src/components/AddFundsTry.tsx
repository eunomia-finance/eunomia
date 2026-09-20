// "Add funds with TRY": lira in through the anchor, USDC out into the treasury. Three states
// in one slot, swapped in place — type an amount and watch what it buys; get the bank details
// at a locked rate; then each leg of the money's trip reports as it lands, with its proof.
//
// No wallet prompt anywhere in here. The anchor leg runs on the treasury's funding account
// (see lib/anchor/fundingAccount.ts), so a passkey owner adds money without a single ceremony.
import { useEffect, useMemo, useRef, useState } from "react";
import { EXPLORER, shortAddr } from "../config";
import { logActivity } from "../lib/activity";
import { finishDeposit, startDeposit, theAnchor, type DepositStep, type FinishedDeposit, type PendingDeposit } from "../lib/anchor/addFunds";
import { forwardToTreasury, fundingBalance, fundingKey } from "../lib/anchor/fundingAccount";
import { indicativePrice, type Price } from "../lib/anchor/quotes";
import { simulateBankTransfer } from "../lib/anchor/transfers";
import { useTreasury } from "../state/useTreasury";

// The anchor's per-deposit window, from its /sep6/info and guide. Checked here so the user
// reads the limit before asking, and again by the anchor, which has the last word.
const MIN_TRY = 50;
const MAX_TRY = 3000;

const STEP_LINE: Record<DepositStep, string> = {
  account: "Opening the funding account",
  "sign-in": "Signing in to the anchor",
  quote: "Locking the rate",
  instructions: "Asking for bank details",
  anchor: "Anchor is paying USDC",
  forward: "Moving it into the treasury",
};

// Both legs take about twenty seconds — friendbot, a trustline, SEP-10, a quote, then the
// anchor's own payment. A button whose label changes is not enough on a phone: the owner
// reported it as the app having hung. The whole trip is listed, with the step it is on.
const LEGS: Record<"bank" | "money", DepositStep[]> = {
  bank: ["account", "sign-in", "quote", "instructions"],
  money: ["anchor", "forward"],
};

function Progress({ leg, step }: { leg: "bank" | "money"; step: DepositStep }) {
  const steps = LEGS[leg];
  const at = steps.indexOf(step);
  return (
    <div className="progress" aria-live="polite">
      {steps.map((s, i) => (
        <div key={s} className={`progress__row${i === at ? " is-now" : i < at ? " is-done" : ""}`}>
          <i className={`mark ${i < at ? "mark--ok" : "mark--idle"}`} />
          <span>{STEP_LINE[s]}</span>
          {i === at && <span className="progress__dots">…</span>}
        </div>
      ))}
      <div className="panel__note" style={{ marginTop: 2 }}>
        This takes about twenty seconds. Keep this screen open — leaving the tab stops it.
      </div>
    </div>
  );
}

const trimZeros = (usdc: string) => usdc.replace(/(\.\d{2}\d*?)0+$/, "$1");
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const errLine = (e: unknown) => (e instanceof Error && e.message ? e.message : "Something went wrong talking to the anchor.");

export default function AddFundsTry({ onDone }: { onDone?: () => void }) {
  const t = useTreasury();
  const treasuryId = t.treasuryId as string;
  const funding = useMemo(() => fundingKey(treasuryId), [treasuryId]);

  const [amount, setAmount] = useState("500");
  const [preview, setPreview] = useState<Price | null>(null);
  const [pending, setPending] = useState<PendingDeposit | null>(null);
  const [done, setDone] = useState<FinishedDeposit | null>(null);
  const [step, setStep] = useState<DepositStep | null>(null);
  const [err, setErr] = useState("");

  // Each state is taller than the last and opens at the bottom of a side column, where the
  // bank reference — the one thing the user must copy — ended up under the floating feedback
  // button. Bring the slot to the middle of the screen whenever its content swaps.
  const root = useRef<HTMLDivElement>(null);
  const stage = done ? "landed" : pending ? "bank" : "amount";
  useEffect(() => {
    if (stage !== "amount") root.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [stage]);

  // A transfer that stopped half-way — a reload or a dropped connection between the anchor's
  // payment and the forward — leaves USDC in the funding account. Look for it on open and
  // offer to finish the trip; money that arrived must never depend on the tab that asked.
  const [waiting, setWaiting] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    let alive = true;
    void theAnchor()
      .then((a) => fundingBalance(funding, a))
      .then((b) => alive && setWaiting(Number(b) > 0 ? b : null))
      // No funding account yet is the ordinary case (Horizon answers 404): nothing waits.
      .catch(() => alive && setWaiting(null));
    return () => {
      alive = false;
    };
  }, [funding]);

  const moveWaiting = async (usdc: string) => {
    setErr("");
    setMoving(true);
    try {
      const hash = await forwardToTreasury(funding, await theAnchor(), treasuryId, usdc);
      if (t.address) {
        void logActivity({ walletAddress: t.address, treasuryId, action: "fund", txHash: hash, amountXlm: Number(usdc) });
      }
      setWaiting(null);
      await t.refresh();
    } catch (e) {
      setErr(errLine(e));
    } finally {
      setMoving(false);
    }
  };

  const value = Number(amount);
  const inRange = Number.isFinite(value) && value >= MIN_TRY && value <= MAX_TRY;
  const tryAmount = inRange ? value.toFixed(2) : "";

  // Live preview while typing. Debounced, and a late answer for an old amount is dropped.
  const asked = useRef(0);
  useEffect(() => {
    if (!tryAmount || pending) return;
    const mine = ++asked.current;
    const timer = setTimeout(() => {
      void theAnchor()
        .then((a) => indicativePrice(a, "deposit", tryAmount))
        .then((p) => mine === asked.current && setPreview(p))
        .catch(() => mine === asked.current && setPreview(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [tryAmount, pending]);

  const begin = async () => {
    setErr("");
    try {
      setPending(await startDeposit(funding, tryAmount, setStep));
    } catch (e) {
      setErr(errLine(e));
    } finally {
      setStep(null);
    }
  };

  const settle = async (p: PendingDeposit) => {
    setErr("");
    try {
      // SANDBOX: no bank stands behind the mock anchor, so the transfer is declared, not
      // made. With a production anchor this line goes and the wait below does the rest.
      setStep("anchor");
      await simulateBankTransfer(p.anchor, p.token, p.instructions.id, p.tryAmount);
      const fin = await finishDeposit(funding, treasuryId, p, setStep);
      setDone(fin);
      if (t.address) {
        void logActivity({
          walletAddress: t.address,
          treasuryId,
          action: "fund",
          txHash: fin.treasuryTxHash,
          amountXlm: Number(fin.usdcAmount),
        });
      }
      await t.refresh();
    } catch (e) {
      setErr(errLine(e));
    } finally {
      setStep(null);
    }
  };

  const again = () => {
    setPending(null);
    setDone(null);
    setErr("");
  };

  // ---- 3 · landed -----------------------------------------------------------------
  if (done) {
    return (
      <div ref={root} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="rowline">
          <span className="eyebrow">Added</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)" }}>
            <i className="mark mark--ok" />in the treasury
          </span>
        </div>
        <div className="meter__big">
          <span className="num">{trimZeros(done.usdcAmount)}</span>
          <small>USDC</small>
        </div>
        <div className="panel__kv"><span>You sent</span><span className="num">{done.transfer.amountIn ?? pending?.tryAmount} TRY</span></div>
        {done.anchorTxHash && (
          <div className="panel__kv">
            <span>Anchor paid</span>
            <a className="linkbtn num" href={`${EXPLORER}/tx/${done.anchorTxHash}`} target="_blank" rel="noreferrer">tx {shortAddr(done.anchorTxHash)} ↗</a>
          </div>
        )}
        <div className="panel__kv">
          <span>Into the treasury</span>
          <a className="linkbtn num" href={`${EXPLORER}/tx/${done.treasuryTxHash}`} target="_blank" rel="noreferrer">tx {shortAddr(done.treasuryTxHash)} ↗</a>
        </div>
        <div className="panel__note">Your agent can spend it now — inside the limits, to approved payees only.</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn--ghost" onClick={again} type="button">Add more</button>
          {onDone && <button className="btn btn--ghost" onClick={onDone} type="button">Close</button>}
        </div>
      </div>
    );
  }

  // ---- 2 · bank details at a locked rate ----------------------------------------------
  if (pending) {
    const { instructions: bank, quote } = pending;
    return (
      <div ref={root} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="eyebrow">Send this transfer</div>
        <div className="meter__big">
          <span className="num">{quote.sellAmount}</span>
          <small>TRY</small>
        </div>
        <div className="panel__kv"><span>Treasury receives</span><span className="num">{trimZeros(quote.buyAmount)} USDC</span></div>
        <div className="panel__kv"><span>Bank</span><span>{bank.bankName}</span></div>
        <div className="panel__kv"><span>IBAN</span><span className="num" style={{ fontSize: 12.5 }}>{bank.iban}</span></div>
        <div className="panel__kv"><span>Description</span><span className="num">{bank.reference}</span></div>
        <div className="panel__kv"><span>Rate held until</span><span className="num">{clock(quote.expiresAt)}</span></div>
        <div className="panel__note">
          The description is how the anchor knows the money is yours. This anchor is a testnet sandbox with no
          bank behind it, so the transfer is declared instead of made; the USDC it pays is real testnet USDC.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => void settle(pending)} disabled={!!step} type="button">
            {step ? "Working…" : "Declare the transfer sent"}
          </button>
          <button className="btn btn--ghost" onClick={again} disabled={!!step} type="button">Back</button>
        </div>
        {step && <Progress leg="money" step={step} />}
        {err && <div className="err">{err}</div>}
      </div>
    );
  }

  // ---- 1 · how much -------------------------------------------------------------------
  return (
    <div ref={root} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {waiting && (
        <div className="notice" style={{ padding: "10px 12px" }}>
          <span><span className="num">{trimZeros(waiting)} USDC</span> from an earlier transfer is waiting outside the treasury.</span>
          <button className="btn btn--ghost" onClick={() => void moveWaiting(waiting)} disabled={moving} type="button">
            {moving ? "Moving…" : "Move it in"}
          </button>
        </div>
      )}
      <label className="lab">
        <span className="eyebrow">Add funds with TRY</span>
        <input
          className="field field--mono"
          inputMode="decimal"
          autoFocus
          aria-label="Amount in TRY"
          placeholder={`${MIN_TRY} – ${MAX_TRY} TRY`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      {inRange && preview ? (
        <>
          <div className="panel__kv"><span>Treasury receives</span><span className="num">≈ {trimZeros(preview.buyAmount)} USDC</span></div>
          <div className="panel__kv"><span>Rate, fee included</span><span className="num">{Number(preview.totalPrice).toFixed(4)} TRY</span></div>
          <div className="panel__kv"><span>Anchor fee</span><span className="num">{preview.feeTotal} TRY</span></div>
        </>
      ) : (
        <div className="panel__note">
          {amount.trim() && !inRange ? `The anchor takes ${MIN_TRY} to ${MAX_TRY} TRY per transfer.` : "Bank transfer in, USDC out. The rate is locked before you send anything."}
        </div>
      )}
      <div>
        <button className="btn" onClick={() => void begin()} disabled={!inRange || !!step} type="button">
          {step ? "Working…" : "Get bank details"}
        </button>
      </div>
      {step && <Progress leg="bank" step={step} />}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
