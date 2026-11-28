// Payments: what the agent paid and what the rules refused, one decision per row, with the
// payee list — the rule behind most refusals — managed beside it. Paying by hand is the
// escape hatch and stays folded: the product is the agent paying on its own. The contract
// still has the final word on a hand payment; a BLOCKED result is the product working.
import { useCallback, useEffect, useMemo, useState } from "react";
import { EXPLORER, fmtXlm, shortAddr } from "../config";
import { useTreasury } from "../state/useTreasury";
import { executorFor } from "../lib/walletKit";
import { isPayee, makeTreasury } from "../lib/userTreasury";
import { isValidPaymentDest } from "../lib/validate";
import { payeeLacksTrustline } from "../lib/receivable";
import { dedupeRefusals, useAgentRejections } from "../lib/agentRejections";
import { loadLedger } from "../lib/eventLedger";
import { loadPayeeBook, mergePayees, payeesFromEvents, rememberPayee, forgetPayee, type PayeeEntry } from "../lib/payees";
import { fetchActivityHistory, mergeFeedEvents, subscribeActivity } from "../lib/activity";
import { filterFeed } from "../lib/feedFilter";
import type { FeedEvent } from "../lib/events";
import { amountOf, inToken, verdictOf, whenOf } from "../components/shell/ledgerFormat";
import { tx, useLang } from "../lib/i18n";

type Verify = Record<string, boolean | undefined>; // address -> on-chain whitelist truth
type Slice = "all" | "paid" | "blocked";

export default function Payments() {
  useLang();
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
      setSendErr(tx("Contract addresses can't receive payments — use a G… account address.", "Kontrat adresleri ödeme alamaz — G… hesap adresi kullan."));
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
  // An address the owner chose to approve despite the trustline warning — a second click goes through.
  const [approveAnyway, setApproveAnyway] = useState("");

  const doAdd = async () => {
    setPayeeErr("");
    const addr = newPayee.trim();
    if (addr !== approveAnyway && (await payeeLacksTrustline(addr, t.tokenCode))) {
      const own = addr === t.lifecycle?.session?.agent ? tx("This is your agent's own key. ", "Bu, ajanının kendi anahtarı. ") : "";
      setPayeeErr(
        `${own}${tx(
          "This account has no USDC trustline, so the token refuses every payment to it (error #13) — approving it won't change that. ",
          "Bu hesabın USDC trustline'ı yok; token ona yapılan her ödemeyi reddeder (hata #13) — onaylasan da değişmez. ",
        )}` +
          tx(
            "Add the trustline on that account first, or press Add payee again to approve it anyway.",
            "Önce o hesaba trustline ekle ya da yine de onaylamak için Alıcı ekle'ye bir daha bas.",
          ),
      );
      setApproveAnyway(addr);
      return;
    }
    setApproveAnyway("");
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

  // Payments an agent made from its own machine (eunomia-mcp) never pass through this app, so
  // the activity log has no row for them. The chain does: the treasury emits `paid` for each,
  // and the Overview's scan keeps those in the local ledger. Add the ones the log lacks.
  const chainPaid = useMemo(
    () => loadLedger(treasuryId).filter((e) => e.kind === "paid"),
    // refreshKey: re-read after every action, when the scan has had reason to run again
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [treasuryId, t.refreshKey],
  );
  // And the refusals it met: the contract leaves no event and no transaction behind when it
  // reverts, so the record is the request the agent filed on its own account.
  const agentRefusals = useAgentRejections(t.lifecycle?.session?.agent ?? null, treasuryId, t.refreshKey);
  const decisions = useMemo(
    () =>
      dedupeRefusals(
        mergeFeedEvents(filterFeed(history, { groups: new Set(["payments", "blocked"]), treasuryId }), [...chainPaid, ...agentRefusals], 120),
      ).map((e) => inToken(e, t.tokenCode)),
    [history, chainPaid, agentRefusals, treasuryId, t.tokenCode],
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
              <div className="eyebrow">{tx("Agent payments", "Ajan ödemeleri")}</div>
              <div className="panel__note" style={{ marginTop: 4 }}>
                {tx("Every attempt against this treasury — allowed or refused by the rules on Stellar.", "Bu kasaya yapılan her deneme — Stellar'daki kurallar ya ödedi ya reddetti.")}
              </div>
            </div>
            <div className="ledger__counts">
              <button className={`chip${slice === "all" ? " is-on" : ""}`} onClick={() => setSlice("all")} type="button">
                {tx("All", "Hepsi")} {decisions.length}
              </button>
              <button className={`chip${slice === "paid" ? " is-on" : ""}`} onClick={() => setSlice("paid")} type="button">
                <i className="mark mark--ok" style={{ marginRight: 6 }} />{tx("Allowed", "Ödendi")} {allowed}
              </button>
              <button className={`chip${slice === "blocked" ? " is-on" : ""}`} onClick={() => setSlice("blocked")} type="button">
                <i className="mark mark--no" style={{ marginRight: 6 }} />{tx("Blocked", "Reddedildi")} {blocked}
              </button>
            </div>
          </div>
          <div className="ledger__row ledger__row--wide ledger__row--head">
            <span className="eyebrow">{tx("Time", "Zaman")}</span>
            <span className="eyebrow">{tx("Verdict", "Karar")}</span>
            <span className="eyebrow">{tx("What", "Ne")}</span>
            <span className="eyebrow sm-hide" style={{ textAlign: "right" }}>{tx("Amount", "Tutar")}</span>
            <span className="eyebrow sm-hide" style={{ textAlign: "right" }}>{tx("Proof", "Kanıt")}</span>
          </div>
          {shown.length === 0 ? (
            <div className="ledger__empty">
              {decisions.length === 0
                ? tx(
                    "No payment tried yet. Put your agent on a Leash and its first attempt lands here — allowed or refused.",
                    "Henüz ödeme denenmedi. Ajanına yetki ver; ilk denemesi buraya düşer — ödendi ya da reddedildi.",
                  )
                : tx("Nothing in this slice.", "Bu dilimde bir şey yok.")}
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
            <div className="ledger__more"><span>{decisions.length - shown.length} {tx("older on the Activity page", "daha eski, Hareketler sayfasında")}</span></div>
          )}
        </section>
      </div>

      {/* The payee list is the rule behind most refusals, so it lives beside the ledger,
          not behind a tab. */}
      <div className="page__side">
        <section className="panel panel--pad">
          <div className="panel__head">
            <div className="eyebrow">{tx("Approved payees", "Onaylı alıcılar")}</div>
            <span className="num" style={{ fontSize: 13 }}>{payees.length}</span>
          </div>
          {payees.length === 0 ? (
            <div className="panel__note">{tx("Nobody yet. Payments can only go to an address on this list — anything else is refused.", "Henüz kimse yok. Ödeme yalnız bu listedeki adreslere gider — gerisi reddedilir.")}</div>
          ) : (
            <div>
              {payees.map((p) => (
                <div key={p.address} className="rowline" style={{ padding: "9px 0", borderTop: "1px solid var(--line)" }}>
                  <button
                    className="linkbtn"
                    style={{ fontFamily: "var(--code)", fontSize: 13, color: "var(--ink)" }}
                    onClick={() => pick(p.address)}
                    title={tx("Pay this payee by hand", "Bu alıcıya elle öde")}
                    type="button"
                  >
                    {shortAddr(p.address)}
                  </button>
                  <span style={{ fontSize: 12, color: "var(--ink-2)", whiteSpace: "nowrap" }}>
                    {verify[p.address] === true ? tx("on chain ✓", "zincirde ✓") : verify[p.address] === false ? tx("not approved", "onaylı değil") : tx("checking…", "bakılıyor…")}
                  </span>
                  <button className="chip" onClick={() => void doRemove(p.address)} disabled={!!t.busy} type="button">
                    {tx("remove", "çıkar")}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="lab" style={{ marginTop: 6 }}>
            <span className="eyebrow">{tx("Approve a payee", "Alıcı onayla")}</span>
            <input
              className="field field--mono"
              placeholder={tx("G… or C…", "G… ya da C…")}
              aria-label={tx("Payee address", "Alıcı adresi")}
              spellCheck={false}
              value={newPayee}
              onChange={(e) => setNewPayee(e.target.value)}
            />
          </div>
          <div className="rowline">
            <span />
            <button className="btn" onClick={() => void doAdd()} disabled={!!t.busy} type="button">
              {t.busy === "whitelist" ? tx("Adding…", "Ekleniyor…") : tx("Add payee", "Alıcı ekle")}
            </button>
          </div>
          {payeeErr && <div className="err">{payeeErr}</div>}
        </section>

        <section className="panel panel--pad">
          <div className="panel__head">
            <div className="eyebrow">{tx("Pay by hand", "Elle öde")}</div>
            <button className="btn btn--ghost" onClick={() => setHand((h) => !h)} type="button">
              {hand ? tx("Close", "Kapat") : tx("Pay by hand", "Elle öde")}
            </button>
          </div>
          {!hand ? (
            <div className="panel__note">{tx("The agent pays on its own. If you send something yourself, the same rules check it.", "Ajan kendi öder. Sen elle gönderirsen de aynı kurallar bakar.")}</div>
          ) : (
            <>
              <div className="lab">
                <span className="eyebrow">{tx("To", "Kime")}</span>
                <input
                  className="field field--mono"
                  list="payees-list"
                  placeholder={tx("Payee address (G…)", "Alıcı adresi (G…)")}
                  aria-label={tx("Payment destination address", "Ödeme gidecek adres")}
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
                      ? tx("Contract addresses can't receive payments — use a G… account.", "Kontrat adresleri ödeme alamaz — G… hesap kullan.")
                      : tx("That doesn't look like a Stellar account address.", "Bu bir Stellar hesap adresine benzemiyor.")}
                  </div>
                )}
                {payees.length === 0 && (
                  <div className="panel__note">
                    {tx("No payees yet — approve one above.", "Henüz alıcı yok — yukarıdan bir tane onayla.")}
                  </div>
                )}
              </div>
              <div className="lab">
                <span className="eyebrow">{tx("Amount", "Tutar")}</span>
                <input
                  className="field field--mono"
                  inputMode="decimal"
                  placeholder={t.tokenCode}
                  aria-label={tx(`Payment amount in ${t.tokenCode}`, `Ödeme tutarı, ${t.tokenCode}`)}
                  value={payAmt}
                  onChange={(e) => setPayAmt(e.target.value)}
                />
                {s && (
                  <div className={overPerTask || overDaily ? "err" : "panel__note"}>
                    ≤ {fmtXlm(s.perTaskLimit)} {t.tokenCode} {tx("per payment", "ödeme başı")} · {remaining !== null ? fmtXlm(remaining) : "—"} {t.tokenCode} {tx("left today", "bugün kaldı")}
                    {overPerTask && tx(" — above your per-payment cap; it will be blocked", " — ödeme başı tavanını aşıyor; reddedilir")}
                    {!overPerTask && overDaily && tx(" — above what's left today; it will be blocked", " — bugün kalanı aşıyor; reddedilir")}
                  </div>
                )}
              </div>
              <div className="rowline">
                <span className="panel__note">
                  {t.sessionActive ? tx("the Leash signs — no popup", "ajanın yetkisi imzalar — pencere açılmaz") : tx("you approve it in your wallet", "cüzdanında onaylarsın")}
                </span>
                <button className="btn" onClick={() => void doSend()} disabled={!!t.busy} type="button">
                  {t.busy === "spend" ? tx("Sending…", "Gönderiliyor…") : tx("Send payment", "Ödemeyi gönder")}
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
