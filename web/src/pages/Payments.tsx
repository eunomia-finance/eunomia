// Payments: what the agent paid and what the rules refused, one decision per row, with the
// payee list — the rule behind most refusals — managed beside it. Paying by hand is the
// escape hatch and stays folded: the product is the agent paying on its own. The contract
// still has the final word on a hand payment; a BLOCKED result is the product working.
import { useCallback, useEffect, useMemo, useState } from "react";
import { EXPLORER, fmtXlm, SERVICE, shortAddr } from "../config";
import { useTreasury } from "../state/useTreasury";
import { executorFor } from "../lib/walletKit";
import { isPayee, makeTreasury } from "../lib/userTreasury";
import { isValidPaymentDest } from "../lib/validate";
import { loadLedger } from "../lib/eventLedger";
import { loadPayeeBook, mergePayees, payeesFromEvents, rememberPayee, forgetPayee, type PayeeEntry } from "../lib/payees";
import { fetchActivityHistory, mergeFeedEvents, subscribeActivity } from "../lib/activity";
import { filterFeed } from "../lib/feedFilter";
import type { FeedEvent } from "../lib/events";
import { amountOf, verdictOf, whenOf } from "../components/shell/ledgerFormat";

type Verify = Record<string, boolean | undefined>; // address -> on-chain whitelist truth
type Slice = "all" | "paid" | "blocked";

export default function Payments() {
  const t = useTreasury();
  const treasuryId = t.treasuryId as string;

  // ---- payee list (derived, no state: refreshKey bumps after every action) -------
  const [verify, setVerify] = useState<Verify>({});
  const [payeeBump, setPayeeBump] = useState(0); // optimistic re-derive right after add/remove
  const payees = useMemo<PayeeEntry[]>(
    () => mergePayees(payeesFromEvents(loadLedger(treasuryId)), loadPayeeBook(treasuryId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey/payeeBump invalidate the localStorage-backed derivation
    [treasuryId, t.refreshKey, payeeBump],
  );
  const reloadPayees = useCallback(() => setPayeeBump((b) => b + 1), []);

  // Verify each derived row against the chain (read-only simulate; no signatures).
  useEffect(() => {
    const addr = t.address;
    if (!addr || payees.length === 0) return;
    let alive = true;
    (async () => {
      const treasury = makeTreasury(treasuryId, await executorFor(addr));
      for (const p of payees) {
        try {
          const ok = await isPayee(treasury, p.address);
          if (!alive) return;
          setVerify((v) => ({ ...v, [p.address]: ok }));
        } catch {
          /* RPC hiccup — leave the badge unknown */
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [payees, t.address, treasuryId]);

  // ---- pay by hand (escape hatch) ------------------------------------------------
  const [hand, setHand] = useState(false);
  const [payTo, setPayTo] = useState("");
  const [payAmt, setPayAmt] = useState("");
  const [sendErr, setSendErr] = useState("");

  const s = t.state;
  const remaining = s ? (s.dailyLimit > s.daySpent ? s.dailyLimit - s.daySpent : 0n) : null;
  const amtNum = Number(payAmt);
  const overPerTask = s && Number.isFinite(amtNum) && amtNum > Number(s.perTaskLimit) / 1e7;
  const overDaily = remaining !== null && Number.isFinite(amtNum) && amtNum > Number(remaining) / 1e7;
  const destLooksOff = payTo.trim() !== "" && !isValidPaymentDest(payTo);

  const doSend = async () => {
    setSendErr("");
    if (payTo.trim().startsWith("C")) {
      setSendErr("Contract addresses can't receive payments — use a G… account address.");
      return;
    }
    const res = await t.spend(payTo, payAmt);
    if (res.ok) setPayAmt("");
    else if (res.validation) setSendErr(res.msg);
  };

  const pick = (addr: string) => {
    setPayTo(addr);
    setHand(true);
  };

  // ---- add / remove payee -------------------------------------------------------
  const [newPayee, setNewPayee] = useState("");
  const [payeeErr, setPayeeErr] = useState("");

  const doAdd = async () => {
    setPayeeErr("");
    const addr = newPayee.trim();
    const res = await t.whitelist(addr);
    if (res.ok) {
      rememberPayee(treasuryId, addr);
      setNewPayee("");
      reloadPayees();
      setVerify((v) => ({ ...v, [addr]: true })); // optimistic — the tx just confirmed it
    } else if (res.validation) {
      setPayeeErr(res.msg);
    }
  };

  const doRemove = async (addr: string) => {
    const res = await t.removePayeeAddr(addr);
    if (res.ok) {
      forgetPayee(treasuryId, addr);
      reloadPayees();
      setVerify((v) => ({ ...v, [addr]: false }));
    }
  };

  // ---- the ledger ---------------------------------------------------------------
  const [history, setHistory] = useState<FeedEvent[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await fetchActivityHistory(80);
      if (alive) setHistory(rows);
    })();
    const unsub = subscribeActivity((e) => setHistory((list) => mergeFeedEvents([e], list, 80)));
    return () => {
      alive = false;
      unsub();
    };
  }, [treasuryId, t.refreshKey]);

  const decisions = useMemo(
    () => filterFeed(history, { groups: new Set(["payments", "blocked"]), treasuryId }),
    [history, treasuryId],
  );
  const [slice, setSlice] = useState<Slice>("all");
  const shown = useMemo(
    () => (slice === "all" ? decisions : decisions.filter((e) => e.kind === slice)).slice(0, 40),
    [decisions, slice],
  );
  const allowed = decisions.filter((e) => e.kind === "paid").length;
  const blocked = decisions.length - allowed;

  return (
    <div className="page">
      <div className="page__main">
        <section className="panel ledger">
          <div className="ledger__head">
            <div>
              <div className="eyebrow">Agent payments</div>
              <div className="panel__note" style={{ marginTop: 4 }}>
                Every attempt against this treasury — allowed or refused by the rules on Stellar.
              </div>
            </div>
            <div className="ledger__counts">
              <button className={`chip${slice === "all" ? " is-on" : ""}`} onClick={() => setSlice("all")} type="button">
                All {decisions.length}
              </button>
              <button className={`chip${slice === "paid" ? " is-on" : ""}`} onClick={() => setSlice("paid")} type="button">
                <i className="mark mark--ok" style={{ marginRight: 6 }} />Allowed {allowed}
              </button>
              <button className={`chip${slice === "blocked" ? " is-on" : ""}`} onClick={() => setSlice("blocked")} type="button">
                <i className="mark mark--no" style={{ marginRight: 6 }} />Blocked {blocked}
              </button>
            </div>
          </div>
          <div className="ledger__row ledger__row--wide ledger__row--head">
            <span className="eyebrow">Time</span>
            <span className="eyebrow">Verdict</span>
            <span className="eyebrow">What</span>
            <span className="eyebrow sm-hide" style={{ textAlign: "right" }}>Amount</span>
            <span className="eyebrow sm-hide" style={{ textAlign: "right" }}>Proof</span>
          </div>
          {shown.length === 0 ? (
            <div className="ledger__empty">
              {decisions.length === 0
                ? "No payment tried yet. Put your agent on a Leash and its first attempt lands here — allowed or refused."
                : "Nothing in this slice."}
            </div>
          ) : (
            shown.map((e) => {
              const v = verdictOf(e.kind);
              return (
                <div key={e.id} className="ledger__row ledger__row--wide">
                  <span className="ledger__when">{whenOf(e.at)}</span>
                  <span className={v.cls}>{v.text}</span>
                  <span className="ledger__what" title={e.label}>{e.label}</span>
                  <span className="ledger__amt sm-hide">{amountOf(e)}</span>
                  {e.txHash ? (
                    <a className="ledger__tx sm-hide" href={`${EXPLORER}/tx/${e.txHash}`} target="_blank" rel="noreferrer">
                      {shortAddr(e.txHash)} ↗
                    </a>
                  ) : (
                    <span className="ledger__tx sm-hide">—</span>
                  )}
                </div>
              );
            })
          )}
          {decisions.length > shown.length && slice === "all" && (
            <div className="ledger__more"><span>{decisions.length - shown.length} older on the Activity page</span></div>
          )}
        </section>
      </div>

      {/* The payee list is the rule behind most refusals, so it lives beside the ledger,
          not behind a tab. */}
      <div className="page__side">
        <section className="panel panel--pad">
          <div className="panel__head">
            <div className="eyebrow">Approved payees</div>
            <span className="num" style={{ fontSize: 13 }}>{payees.length}</span>
          </div>
          {payees.length === 0 ? (
            <div className="panel__note">Nobody yet. Payments can only go to an address on this list — anything else is refused.</div>
          ) : (
            <div>
              {payees.map((p) => (
                <div key={p.address} className="rowline" style={{ padding: "9px 0", borderTop: "1px solid var(--line)" }}>
                  <button
                    className="linkbtn"
                    style={{ fontFamily: "var(--code)", fontSize: 13, color: "var(--ink)" }}
                    onClick={() => pick(p.address)}
                    title="Pay this payee by hand"
                    type="button"
                  >
                    {shortAddr(p.address)}
                  </button>
                  <span style={{ fontSize: 12, color: "var(--ink-2)", whiteSpace: "nowrap" }}>
                    {verify[p.address] === true ? "on chain ✓" : verify[p.address] === false ? "not approved" : "checking…"}
                  </span>
                  <button className="chip" onClick={() => void doRemove(p.address)} disabled={!!t.busy} type="button">
                    remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="lab" style={{ marginTop: 6 }}>
            <span className="eyebrow">Approve a payee</span>
            <input
              className="field field--mono"
              placeholder="G… or C…"
              aria-label="Payee address"
              spellCheck={false}
              value={newPayee}
              onChange={(e) => setNewPayee(e.target.value)}
            />
          </div>
          <div className="rowline">
            <button className="linkbtn" type="button" onClick={() => setNewPayee(SERVICE)}>
              use the sample vendor ({shortAddr(SERVICE)})
            </button>
            <button className="btn" onClick={() => void doAdd()} disabled={!!t.busy} type="button">
              {t.busy === "whitelist" ? "Adding…" : "Add payee"}
            </button>
          </div>
          {payeeErr && <div className="err">{payeeErr}</div>}
        </section>

        <section className="panel panel--pad">
          <div className="panel__head">
            <div className="eyebrow">Pay by hand</div>
            <button className="btn btn--ghost" onClick={() => setHand((h) => !h)} type="button">
              {hand ? "Close" : "Pay by hand"}
            </button>
          </div>
          {!hand ? (
            <div className="panel__note">The agent pays on its own. If you send something yourself, the same rules check it.</div>
          ) : (
            <>
              <div className="lab">
                <span className="eyebrow">To</span>
                <input
                  className="field field--mono"
                  list="payees-list"
                  placeholder="Payee address (G…)"
                  aria-label="Payment destination address"
                  spellCheck={false}
                  value={payTo}
                  onChange={(e) => setPayTo(e.target.value)}
                />
                <datalist id="payees-list">
                  {payees.map((p) => (
                    <option key={p.address} value={p.address} />
                  ))}
                </datalist>
                {destLooksOff && (
                  <div className="err">
                    {payTo.trim().startsWith("C")
                      ? "Contract addresses can't receive payments — use a G… account."
                      : "That doesn't look like a Stellar account address."}
                  </div>
                )}
                {payees.length === 0 && (
                  <div className="panel__note">
                    No payees yet —{" "}
                    <button className="linkbtn" type="button" onClick={() => setPayTo(SERVICE)}>
                      use the sample vendor ({shortAddr(SERVICE)})
                    </button>{" "}
                    or approve one above.
                  </div>
                )}
              </div>
              <div className="lab">
                <span className="eyebrow">Amount</span>
                <input
                  className="field field--mono"
                  inputMode="decimal"
                  placeholder="XLM"
                  aria-label="Payment amount in XLM"
                  value={payAmt}
                  onChange={(e) => setPayAmt(e.target.value)}
                />
                {s && (
                  <div className={overPerTask || overDaily ? "err" : "panel__note"}>
                    ≤ {fmtXlm(s.perTaskLimit)} XLM per payment · {remaining !== null ? fmtXlm(remaining) : "—"} XLM left today
                    {overPerTask && " — above your per-payment cap; it will be blocked"}
                    {!overPerTask && overDaily && " — above what's left today; it will be blocked"}
                  </div>
                )}
              </div>
              <div className="rowline">
                <span className="panel__note">
                  {t.sessionActive ? "the Leash signs — no popup" : "you approve it in your wallet"}
                </span>
                <button className="btn" onClick={() => void doSend()} disabled={!!t.busy} type="button">
                  {t.busy === "spend" ? "Sending…" : "Send payment"}
                </button>
              </div>
              {sendErr && <div className="err">{sendErr}</div>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
