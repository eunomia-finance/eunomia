// The hero page. It answers three questions at a glance: what is in the treasury, what the
// agent spent of today's limit, and — until an agent has bought something — which step comes
// next. Under the steps sit three cards: the treasury with its rules, the agent with what it
// can buy, and the one ivory card, the latest things the rules decided.
//
// There is no "send a payment" here on purpose: the agent pays, the rules decide, this
// page reports. Paying by hand is the escape hatch on the Payments page.
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { EXPLORER, USDC_TOKEN, fmtXlm, shortAddr } from "../config";
import { useTreasury } from "../state/useTreasury";
import { useAnalyticsScore } from "../lib/useAnalytics";
import { useTreasuryActivity } from "../lib/useTreasuryActivity";
import { mergeFeedEvents } from "../lib/activity";
import { dedupeRefusals, useAgentRejections } from "../lib/agentRejections";
import { computeAnomaly, mergeLedger } from "../lib/eventLedger";
import { loadPayeeBook, mergePayees, payeesFromEvents } from "../lib/payees";
import { ownerJourney, type JourneyStep } from "../lib/onboarding";
import { CATALOG_EXAMPLES } from "../lib/agentSetup";
import { getTokenBalance, needsFunding, MIN_XLM } from "../lib/funding";
import { tx, useLang } from "../lib/i18n";
import { useNow } from "../lib/useNow";
import type { View } from "../lib/routes";
import { amountOf, inToken, whenOf } from "../components/shell/ledgerFormat";
import ExceptionRequests from "../components/ExceptionRequests";
import BottomSheet from "../components/shell/BottomSheet";
import { useIsMobile } from "../lib/useIsMobile";

// The four steps from an open treasury to an agent that has bought something. They used to
// be one line of advice; three builders in a row needed to see all of them and where they
// stood, so they are a strip again — one that goes away when the fourth is done.
const journeyTitle = (step: JourneyStep): string =>
  ({
    open: tx("Open the treasury", "Kasayı aç"),
    fund: tx("Add funds", "Para yatır"),
    agent: tx("Connect your agent", "Ajanı bağla"),
    ask: tx("Ask it for something", "Ajandan bir şey iste"),
  })[step];

const EASE = [0.2, 0.7, 0.3, 1] as const;
const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, delay, ease: EASE },
});

function countdown(ms: number): string {
  if (ms <= 0) return tx("expired", "süresi doldu");
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return tx(`${d} d ${h} h`, `${d} gün ${h} sa`);
  return h > 0 ? tx(`${h} h ${m} m`, `${h} sa ${m} dk`) : tx(`${m} m`, `${m} dk`);
}

/** How many decisions the ivory card lists; the Activity page has them all. */
const FEED_ROWS = 6;

export default function Overview({ onGo }: { onGo: (v: View) => void }) {
  useLang();
  const t = useTreasury();
  const treasuryId = t.treasuryId as string; // the shell only renders Overview with one open
  const analytics = useAnalyticsScore(treasuryId, t.refreshKey);
  const { rows: written } = useTreasuryActivity(treasuryId, t.refreshKey);
  // One list feeds the card — set the unit once, here.
  //
  // The activity log only knows what passed through this app. An agent paying from its own
  // machine (eunomia-mcp) never does — but the treasury emits `paid` for every payment, and
  // the chain scan above already has those. Add the ones the log does not carry, matched by
  // tx hash, so the owner sees what the agent did without having been there.
  //
  // Refusals are a third source, and they have to be: the contract reverts, so it emits no
  // event, and the refused call never reaches a ledger. What survives is the request the
  // agent filed about it on its own account — the only way an agent running on someone
  // else's machine gets its refusals in front of the owner.
  const agentRefusals = useAgentRejections(t.lifecycle?.session?.agent ?? null, treasuryId, t.refreshKey);
  const rows = useMemo(
    () =>
      dedupeRefusals(
        mergeFeedEvents(written, [...analytics.events.filter((e) => e.kind === "paid"), ...agentRefusals]),
      ).map((e) => inToken(e, t.tokenCode)),
    [written, analytics.events, agentRefusals, t.tokenCode],
  );

  const [fundOpen, setFundOpen] = useState(false);
  const fundPanel = useRef<HTMLDivElement>(null);
  const fundInput = useRef<HTMLInputElement>(null);
  const [fundAmt, setFundAmt] = useState("");
  const [fundErr, setFundErr] = useState("");

  const payees = useMemo(
    () => mergePayees(payeesFromEvents(analytics.events), loadPayeeBook(treasuryId)),
    [analytics.events, treasuryId],
  );
  const payeeCount =
    analytics.status === "loading" && analytics.events.length === 0 ? null : payees.length;

  // Durable truths from the activity log — chain events older than the RPC's retention
  // window can't be re-scanned, but the Supabase log remembers them.
  const paidSeen = rows.some((e) => e.kind === "paid");

  // Anomaly runs on the MERGED, deduped ledger (chain scan + durable activity log) so a
  // Realtime row arriving before the RPC re-scan can't make the notice flicker on and off.
  const anomaly = useMemo(
    () => computeAnomaly(mergeLedger(analytics.events, rows)),
    [analytics.events, rows],
  );

  const hasPaid = analytics.score.payments > 0 || paidSeen || (t.state ? t.state.daySpent > 0n : false);

  const doFund = async () => {
    setFundErr("");
    const res = await t.fund(fundAmt);
    if (res.ok) {
      setFundAmt("");
      setFundOpen(false);
    } else if (res.validation) {
      setFundErr(res.msg);
    }
  };

  // On phones the fund form opens as a bottom sheet; on desktop the inline panel stays.
  const isMobile = useIsMobile();
  const openFund = () => {
    setFundOpen(true);
    if (isMobile) return; // the sheet carries its own focus
    requestAnimationFrame(() => {
      fundPanel.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      fundInput.current?.focus({ preventScroll: true });
    });
  };

  // The wallet's USDC, read when the form opens. XLM has its own low-wallet notice above;
  // USDC has none, and a deposit from an empty wallet is the first thing to go wrong.
  const [walletUsdc, setWalletUsdc] = useState<number | null>(null);
  useEffect(() => {
    if (!fundOpen || t.tokenCode !== "USDC" || !t.address) return;
    let live = true;
    void getTokenBalance(USDC_TOKEN, t.address).then((b) => live && setWalletUsdc(b));
    return () => {
      live = false;
    };
  }, [fundOpen, t.tokenCode, t.address, t.refreshKey]);

  // A deposit always moves the treasury's own token, so the form speaks in it.
  const fundForm = (inSheet: boolean) => (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
      <input
        className="field field--mono"
        style={{ flex: 1, minWidth: 140 }}
        ref={inSheet ? undefined : fundInput}
        autoFocus={inSheet}
        inputMode="decimal"
        placeholder={tx(`Amount in ${t.tokenCode}`, `Tutar (${t.tokenCode})`)}
        aria-label={tx(`Fund amount in ${t.tokenCode}`, `Yatırılacak tutar (${t.tokenCode})`)}
        value={fundAmt}
        onChange={(e) => setFundAmt(e.target.value)}
      />
      <button className="btn" onClick={() => void doFund()} disabled={!!t.busy} type="button">
        {t.busy === "fund" ? tx("Sending…", "Gönderiliyor…") : tx("Deposit", "Yatır")}
      </button>
      {t.tokenCode === "USDC" && walletUsdc !== null && (
        <div className="panel__note" style={{ width: "100%" }}>
          {walletUsdc > 0
            ? tx(`Your wallet holds ${walletUsdc.toFixed(2)} USDC. Your wallet will ask you to sign.`, `Cüzdanında ${walletUsdc.toFixed(2)} USDC var. Cüzdanın imza isteyecek.`)
            : tx("Your wallet holds no USDC yet — send some to it first.", "Cüzdanında henüz USDC yok — önce cüzdanına USDC gönder.")}
        </div>
      )}
      {fundErr && <div className="err" style={{ width: "100%" }}>{fundErr}</div>}
    </div>
  );

  const s = t.state;
  const remaining = s ? (s.dailyLimit > s.daySpent ? s.dailyLimit - s.daySpent : 0n) : 0n;
  const dayPct = s && s.dailyLimit > 0n ? Math.min(100, Number((s.daySpent * 10000n) / s.dailyLimit) / 100) : 0;
  const session = t.lifecycle?.session ?? null;
  const now = useNow(!!(t.sessionActive && session));
  // sessionActive is computed when the treasury was last read; the clock keeps ticking past
  // valid_until, and an expired Leash must stop reading "active" the moment it expires.
  const leashOn = t.sessionActive && session && Number(session.valid_until) * 1000 > now;

  // Not before the state is read: with the balance still unknown the step to do now would
  // read as "fund", and once it loaded the button would change under the cursor.
  const journey = ownerJourney({ balance: t.loading || !s ? null : s.balance, agentOn: !!leashOn, hasPaid });
  const journeyDetail = (step: JourneyStep, done: boolean): string => {
    if (!s) return "";
    switch (step) {
      case "open":
        return tx(
          `At most ${fmtXlm(s.dailyLimit)} ${t.tokenCode} a day, ${fmtXlm(s.perTaskLimit)} per payment.`,
          `Günde en fazla ${fmtXlm(s.dailyLimit)}, ödeme başı ${fmtXlm(s.perTaskLimit)} ${t.tokenCode}.`,
        );
      case "fund":
        return done
          ? tx(`${fmtXlm(s.balance)} ${t.tokenCode} in the treasury.`, `Kasada ${fmtXlm(s.balance)} ${t.tokenCode} var.`)
          : tx("It is empty. Your agent pays from this balance.", "Kasa boş. Ajan bu bakiyeden öder.");
      case "agent":
        return done && session
          ? tx(`It may spend for ${countdown(Number(session.valid_until) * 1000 - now)} more.`, `Yetkisi ${countdown(Number(session.valid_until) * 1000 - now)} daha açık.`)
          : tx("One command and one button on the Agent page.", "Ajan sayfasında tek komut, tek düğme.");
      case "ask":
        return tx(
          "Open your AI client and ask: “read this page and summarise it”. It pays by itself.",
          "Claude'u aç ve iste: “şu sayfayı oku ve özetle”. Ödemeyi kendisi yapar.",
        );
    }
  };
  const closeFund = () => {
    setFundOpen(false);
    setFundErr("");
  };

  const feed = rows.slice(0, FEED_ROWS);
  // A row in the owner's words. The feed's writers describe an event from the chain's side
  // ("Agent paid 0,1 XLM to GACB…POJV · task 0"); the owner wants to know what it was.
  const agentKey = session?.agent ?? "";
  const feedTitle = (e: { kind: string; label: string }): string => {
    switch (e.kind) {
      case "paid": {
        const to = /\bto (\S+)/.exec(e.label)?.[1] ?? "";
        const isAgent = !!agentKey && to.startsWith(agentKey.slice(0, 4)) && to.endsWith(agentKey.slice(-4));
        if (isAgent) return tx("Task money to your agent", "Ajana görev parası");
        return to ? tx(`Paid to ${to}`, `${to} adresine ödendi`) : tx("Payment", "Ödeme");
      }
      case "blocked":
        return tx("Payment refused by your rules", "Ödeme kurallarına takıldı");
      case "fund":
        return tx("Funds added", "Para yatırıldı");
      case "deploy":
        return tx("Treasury opened", "Kasa açıldı");
      case "whitelist":
        return tx("Payee approved", "Alıcı onaylandı");
      case "leash":
        return /revoked/i.test(e.label) ? tx("Agent revoked", "Ajanın yetkisi iptal edildi") : tx("Agent connected", "Ajan bağlandı");
      default:
        return e.label;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {t.legacy && (
        <div className="notice">
          <span>
            {tx(
              "This is an early treasury — agent sessions, pause and withdraw arrived later. Your funds are safe;",
              "Bu eski bir kasa — ajan yetkisi, durdurma ve çekme sonradan geldi. Paran güvende;",
            )}{" "}
            <button className="linkbtn" onClick={() => onGo("settings")} type="button">
              {tx("see Settings for the exit path", "çıkış yolu için Ayarlar'a bak")}
            </button>
          </span>
        </div>
      )}

      {anomaly && (
        <div className="notice notice--warn">
          <span>
            {tx(
              "Most recent payment attempts were refused. That is your rules working — but check whether the payee list or today's limit needs updating.",
              "Son ödeme denemelerinin çoğu reddedildi. Kuralların çalışıyor — ama alıcı listesini ya da günlük sınırı güncellemen gerekebilir.",
            )}
          </span>
        </div>
      )}

      {/* A low wallet only matters while the treasury itself is empty: after a one-signature
          setup moved everything in, "you need 20 XLM to fund a treasury" is just noise. */}
      {t.address && t.tokenCode === "XLM" && t.walletXlm !== undefined && needsFunding(t.walletXlm) && s && s.balance === 0n && (
        <div className="notice">
          <span>
            {t.walletXlm === null
              ? tx("Your wallet holds no XLM yet.", "Cüzdanında henüz XLM yok.")
              : tx(`Your wallet holds ${t.walletXlm.toFixed(2)} XLM.`, `Cüzdanında ${t.walletXlm.toFixed(2)} XLM var.`)}{" "}
            {tx(
              `The treasury is empty and you need about ${MIN_XLM} XLM in the wallet to fund it.`,
              `Kasa boş; doldurmak için cüzdanında yaklaşık ${MIN_XLM} XLM olmalı.`,
            )}
          </span>
        </div>
      )}

      {/* WHERE YOU ARE — the four steps, until an agent has bought something */}
      {journey && !journey.complete && (
        <motion.section className="journey" aria-label={tx("Getting started", "Başlangıç adımları")} {...fadeUp(0)}>
          {journey.steps.map(({ step, done }, i) => {
            const isNow = journey.now === step;
            return (
              <div key={step} className={`journey__step${isNow ? " is-now" : done ? " is-done" : " is-todo"}`}>
                <span className="journey__n">
                  {i + 1}
                  {done ? <b> · {tx("done", "tamam")}</b> : isNow ? ` · ${tx("now", "şimdi")}` : ""}
                </span>
                <span className="journey__t">{journeyTitle(step)}</span>
                <span className="journey__d">{journeyDetail(step, done)}</span>
                {isNow && step === "fund" && (
                  <div className="journey__cta">
                    <button className="btn btn--gold" onClick={openFund} disabled={!!t.busy && t.busy !== "fund"} type="button">
                      {tx("Add funds", "Para yatır")}
                    </button>
                  </div>
                )}
                {isNow && step === "agent" && (
                  <div className="journey__cta">
                    <button className="btn btn--gold" onClick={() => onGo("agent")} type="button">
                      {tx("Connect your agent", "Ajanı bağla")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </motion.section>
      )}

      <div className="trio">
        {/* THE TREASURY — what it holds, and the rules every payment is checked against */}
        <motion.section className="panel" {...fadeUp(0.04)}>
          <div className="eyebrow">{tx("In the treasury", "Kasada")}</div>
          {t.loading || !s ? (
            <div className="shell__skel" style={{ height: 56, width: "60%" }} />
          ) : (
            <>
              <div className="figure__big">
                <span data-testid="treasury-balance">{fmtXlm(s.balance)}</span>
                <small>{t.tokenCode}</small>
              </div>
              {s.balance === 0n && (
                <div className="panel__note">
                  {tx("Empty. Your agent pays from this balance — add funds before it can buy anything.", "Boş. Ajan bu bakiyeden öder — bir şey alabilmesi için önce para yatır.")}
                </div>
              )}
            </>
          )}
          <div style={{ marginTop: 10 }}>
            <div className="panel__head" style={{ marginBottom: 2 }}>
              <div className="eyebrow">{tx("Rules on Stellar", "Stellar'daki kurallar")}</div>
              <a className="linkbtn" href={`${EXPLORER}/contract/${treasuryId}`} target="_blank" rel="noreferrer">{shortAddr(treasuryId)} ↗</a>
            </div>
            {s ? (
              <div className="rows">
                <div><span>{tx("Per day, at most", "Günde en fazla")}</span><span className="num">{fmtXlm(s.dailyLimit)} {t.tokenCode}</span></div>
                <div><span>{tx("Per payment, at most", "Tek ödemede en fazla")}</span><span className="num">{fmtXlm(s.perTaskLimit)} {t.tokenCode}</span></div>
                <div><span>{tx("Places it may pay", "Ödeyebileceği yerler")}</span><span className="num">{payeeCount ?? "—"}</span></div>
              </div>
            ) : (
              <div className="shell__skel" style={{ height: 80 }} />
            )}
            {t.lifecycle?.paused && (
              <div className="err" style={{ marginTop: 8 }}>
                {tx("Spending is paused — every payment is refused until you resume.", "Harcama durduruldu — sen devam ettirene kadar her ödeme reddedilir.")}
              </div>
            )}
          </div>
          {fundOpen && !isMobile && <div ref={fundPanel}>{fundForm(false)}</div>}
          <div className="card__foot">
            <button className="btn btn--gold" onClick={() => (fundOpen ? closeFund() : openFund())} disabled={!!t.busy && t.busy !== "fund"} type="button">
              {tx("Add funds", "Para yatır")}
            </button>
            <button className="btn btn--ghost" onClick={() => onGo("settings")} type="button">{tx("Change rules", "Kuralları değiştir")}</button>
            <button className="btn btn--ghost" onClick={() => onGo("payments")} type="button">{tx("Payees", "Alıcılar")}</button>
          </div>
        </motion.section>

        {/* THE AGENT — what it spent of today's limit, whether it may spend, what it can buy */}
        <motion.section className="panel" {...fadeUp(0.08)}>
          <div className="panel__head">
            <div className="eyebrow">{tx("Your agent · last 24 hours", "Ajan · son 24 saat")}</div>
            {!leashOn && (
              <button className="linkbtn" onClick={() => onGo("agent")} type="button">{tx("connect one", "ajan bağla")}</button>
            )}
          </div>
          {t.loading || !s ? (
            <div className="shell__skel" style={{ height: 128, width: 128, borderRadius: "50%" }} />
          ) : (
            <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
              <div className="ring" style={{ ["--p" as string]: dayPct }}>
                <div>
                  {fmtXlm(s.daySpent)}
                  <small>{tx(`of ${fmtXlm(s.dailyLimit)} ${t.tokenCode}`, `${fmtXlm(s.dailyLimit)} ${t.tokenCode}'den`)}</small>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: "var(--display)", fontSize: 20, lineHeight: 1.2 }}>
                  {leashOn && session
                    ? tx(`May spend for ${countdown(Number(session.valid_until) * 1000 - now)}`, `Yetkisi ${countdown(Number(session.valid_until) * 1000 - now)} daha açık`)
                    : tx("No agent may spend", "Hiçbir ajan harcayamaz")}
                </div>
                <div className="panel__note">
                  {leashOn && session
                    ? tx(
                        `${fmtXlm(remaining)} ${t.tokenCode} left today · ${fmtXlm(session.spent)} of ${fmtXlm(session.limit)} used in all`,
                        `Bugün kalan ${fmtXlm(remaining)} ${t.tokenCode} · toplamda ${fmtXlm(session.limit)} içinden ${fmtXlm(session.spent)} kullanıldı`,
                      )
                    : tx("Connect one and it pays on its own, inside your rules, with no prompts.", "Bir ajan bağla; kuralların içinde, sana sormadan kendisi öder.")}
                </div>
              </div>
            </div>
          )}
          {t.tokenCode === "USDC" && (
            <div style={{ marginTop: 6 }}>
              <div className="eyebrow" style={{ marginBottom: 2 }}>{tx("What it can buy · USDC per call", "Satın alabildikleri · çağrı başı USDC")}</div>
              <div className="rows">
                {CATALOG_EXAMPLES.map((c) => (
                  <div key={c.label}><span>{tx(c.label, c.labelTr)}</span><span className="num">{c.price}</span></div>
                ))}
              </div>
            </div>
          )}
          {leashOn && (
            <div className="card__foot">
              <button className="danger-link" onClick={() => onGo("agent")} type="button">
                {tx("Revoke the agent on the Agent page", "Ajanın yetkisini Ajan sayfasından iptal et")}
              </button>
            </div>
          )}
        </motion.section>

        {/* WHAT HAPPENED — the one ivory card: the latest things the rules decided */}
        <motion.section className="panel is-contrast" {...fadeUp(0.12)}>
          <div className="panel__head">
            <div className="eyebrow">{tx("What your rules did", "Kuralların ne yaptı")}</div>
            <button className="linkbtn" onClick={() => onGo("activity")} type="button">{tx("All", "Tümü")}</button>
          </div>
          {feed.length === 0 ? (
            <div className="panel__note" style={{ marginTop: 4 }}>
              {tx(
                "Nothing yet. The first payment your agent tries shows here — allowed or refused by the contract, with its proof.",
                "Henüz bir şey yok. Ajanın ilk ödeme denemesi burada görünür — kontrat izin verdi mi, reddetti mi, kanıtıyla.",
              )}
            </div>
          ) : (
            <div>
              {feed.map((e) => (
                <div className="feedline" key={e.id}>
                  <div>
                    <b title={e.label}>{feedTitle(e)}</b>
                    <small>{whenOf(e.at)}</small>
                  </div>
                  <div>
                    {amountOf(e) && <span className="num">{Number(amountOf(e))} {t.tokenCode}</span>}
                    {e.kind === "paid" && <span className="pill pill--ok">{tx("Allowed", "Ödendi")}</span>}
                    {e.kind === "blocked" && <span className="pill pill--no">{tx("Blocked", "Reddedildi")}</span>}
                    {e.txHash && e.kind !== "paid" && e.kind !== "blocked" && (
                      <a className="linkbtn" href={`${EXPLORER}/tx/${e.txHash}`} target="_blank" rel="noreferrer">tx ↗</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.section>
      </div>

      {/* WAITING — exception requests the agent filed */}
      {session && <ExceptionRequests agent={session.agent} />}

      <BottomSheet open={fundOpen && isMobile} onClose={closeFund} title={tx("Add funds", "Para yatır")}>
        {fundForm(true)}
      </BottomSheet>
    </div>
  );
}
