// The hero page. It answers three questions at a glance: what is in the treasury, what the
// agent spent of today's limit, and — until an agent has bought something — which step comes
// next. Once there is a decision to show, the latest one sits in the dark panel and the
// ledger under it lists them all; the side column holds the agent, the rules and what the
// budget is for.
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
import { useNow } from "../lib/useNow";
import type { View } from "../lib/routes";
import RecentActivity from "../components/shell/RecentActivity";
import { amountOf, inToken, whenOf } from "../components/shell/ledgerFormat";
import ExceptionRequests from "../components/ExceptionRequests";
import BottomSheet from "../components/shell/BottomSheet";
import { decisionsByDay } from "../lib/insights";
import { useIsMobile } from "../lib/useIsMobile";

// The four steps from an open treasury to an agent that has bought something. They used to
// be one line of advice; three builders in a row needed to see all of them and where they
// stood, so they are a strip again — one that goes away when the fourth is done.
const JOURNEY_TITLE: Record<JourneyStep, string> = {
  open: "Open the treasury",
  fund: "Add funds",
  agent: "Connect your agent",
  ask: "Ask it for something",
};

const EASE = [0.2, 0.7, 0.3, 1] as const;
const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, delay, ease: EASE },
});

function countdown(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function Overview({ onGo }: { onGo: (v: View) => void }) {
  const t = useTreasury();
  const treasuryId = t.treasuryId as string; // the shell only renders Overview with one open
  const analytics = useAnalyticsScore(treasuryId, t.refreshKey);
  const { rows: written, freshId } = useTreasuryActivity(treasuryId, t.refreshKey);
  // One list feeds the verdict, the ledger and the bars — set the unit once, here.
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

  // The bars read the same feed the ledger renders, so a bar and a row can never disagree.
  const week = useMemo(() => decisionsByDay(rows), [rows]);

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
  const walletFundForm = (inSheet: boolean) => (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
      <input
        className="field field--mono"
        style={{ flex: 1, minWidth: 160 }}
        ref={inSheet ? undefined : fundInput}
        autoFocus={inSheet}
        inputMode="decimal"
        placeholder={`Amount in ${t.tokenCode}`}
        aria-label={`Fund amount in ${t.tokenCode}`}
        value={fundAmt}
        onChange={(e) => setFundAmt(e.target.value)}
      />
      <button className="btn" onClick={() => void doFund()} disabled={!!t.busy} type="button">
        {t.busy === "fund" ? "Funding…" : "Fund"}
      </button>
      {t.tokenCode === "USDC" && walletUsdc !== null && (
        <div className="panel__note" style={{ width: "100%" }}>
          {walletUsdc > 0
            ? `Your wallet holds ${walletUsdc.toFixed(2)} USDC.`
            : "Your wallet holds no USDC yet — send some to it first."}
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
  const leashPct = session && session.limit > 0n ? Math.min(100, Number((session.spent * 10000n) / session.limit) / 100) : 0;

  // The latest decision the contract made — the only thing worth a dark panel.
  const latest = rows.find((e) => e.kind === "paid" || e.kind === "blocked") ?? null;
  // Not before the state is read: with the balance still unknown the step to do now would
  // read as "fund", and once it loaded the button would change under the cursor.
  const journey = ownerJourney({ balance: t.loading || !s ? null : s.balance, agentOn: !!leashOn, hasPaid });
  const journeyDetail = (step: JourneyStep, done: boolean): string => {
    if (!s) return "";
    switch (step) {
      case "open":
        return `At most ${fmtXlm(s.dailyLimit)} ${t.tokenCode} a day, ${fmtXlm(s.perTaskLimit)} per payment.`;
      case "fund":
        return done ? `${fmtXlm(s.balance)} ${t.tokenCode} in the treasury.` : "It is empty. Your agent pays from this balance.";
      case "agent":
        return done && session
          ? `It may spend for ${countdown(Number(session.valid_until) * 1000 - now)} more.`
          : "One command and one button on the Agent page.";
      case "ask":
        return "Open your AI client and ask: “read this page and summarise it”. It pays by itself.";
    }
  };
  const closeFund = () => {
    setFundOpen(false);
    setFundErr("");
  };
  // The deposit comes from the wallet, in the treasury's own token.
  const fundForm = walletFundForm;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {t.legacy && (
        <div className="notice">
          <span>
            This is an early treasury — agent sessions, pause and withdraw arrived later. Your funds are safe;{" "}
            <button className="linkbtn" onClick={() => onGo("settings")} type="button">see Settings for the exit path</button>
          </span>
        </div>
      )}

      {anomaly && (
        <div className="notice notice--warn">
          <span>Most recent payment attempts were refused. That is your rules working — but check whether the payee list or today's limit needs updating.</span>
        </div>
      )}

      {/* A low wallet only matters while the treasury itself is empty: after a one-signature
          setup moved everything in, "you need 20 XLM to fund a treasury" is just noise. */}
      {t.address && t.tokenCode === "XLM" && t.walletXlm !== undefined && needsFunding(t.walletXlm) && s && s.balance === 0n && (
        <div className="notice">
          <span>
            {t.walletXlm === null ? "Your wallet holds no XLM yet." : `Your wallet holds ${t.walletXlm.toFixed(2)} XLM.`}{" "}
            The treasury is empty and you need about {MIN_XLM} XLM in the wallet to fund it.
          </span>
        </div>
      )}

      {/* WHERE YOU ARE — the four steps, until an agent has bought something */}
      {journey && !journey.complete && (
        <motion.section className="journey" aria-label="Getting started" {...fadeUp(0)}>
          {journey.steps.map(({ step, done }, i) => {
            const isNow = journey.now === step;
            return (
              <div key={step} className={`journey__step${isNow ? " is-now" : done ? " is-done" : " is-todo"}`}>
                <span className="journey__n">
                  {i + 1}
                  {done ? <b> · done</b> : isNow ? " · now" : ""}
                </span>
                <span className="journey__t">{JOURNEY_TITLE[step]}</span>
                <span className="journey__d">{journeyDetail(step, done)}</span>
                {isNow && step === "fund" && (
                  <div className="journey__cta">
                    <button className="btn btn--gold" onClick={openFund} disabled={!!t.busy && t.busy !== "fund"} type="button">Add funds</button>
                  </div>
                )}
                {isNow && step === "agent" && (
                  <div className="journey__cta">
                    <button className="btn btn--gold" onClick={() => onGo("agent")} type="button">Connect your agent</button>
                  </div>
                )}
              </div>
            );
          })}
        </motion.section>
      )}

      <div className="page">
        <div className="page__main">
          {/* VERDICT — the latest decision, in ink. Only once there is one: before that the
              steps above are the thing to read. */}
          {latest && (
            <motion.section className="verdict" {...fadeUp(0)}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <div className="eyebrow">Latest decision · {whenOf(latest.at)}</div>
                <div className="verdict__line">
                  <span className="verdict__amount">{amountOf(latest) ? `${Number(amountOf(latest))} ${t.tokenCode}` : latest.kind === "blocked" ? "Refused" : "Paid"}</span>
                </div>
                <div className="verdict__why">{latest.label}</div>
              </div>
              <div className="verdict__side">
                <span className={`pill pill--lg ${latest.kind === "blocked" ? "pill--no" : "pill--ok"}`} style={latest.kind === "blocked" ? { color: "#e2a394" } : undefined}>
                  {latest.kind === "blocked" ? "Blocked" : "Allowed"}
                </span>
                {latest.txHash && (
                  <a className="verdict__tx" href={`${EXPLORER}/tx/${latest.txHash}`} target="_blank" rel="noreferrer">
                    tx {shortAddr(latest.txHash)} ↗
                  </a>
                )}
              </div>
            </motion.section>
          )}

          {/* THE TWO NUMBERS — what the treasury holds, what the agent spent of today's limit */}
          <motion.div className="figures" {...fadeUp(0.04)}>
            <section className="panel panel--pad">
              <div className="eyebrow">In the treasury</div>
              {t.loading || !s ? (
                <div className="shell__skel" style={{ height: 46, width: "60%" }} />
              ) : (
                <>
                  <div className="figure__big">
                    <span data-testid="treasury-balance">{fmtXlm(s.balance)}</span>
                    <small>{t.tokenCode}</small>
                  </div>
                  {s.balance === 0n && <div className="panel__note">Empty. Your agent pays from this balance — add funds before it can buy anything.</div>}
                </>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                <button className="btn btn--gold" onClick={() => (fundOpen ? closeFund() : openFund())} disabled={!!t.busy && t.busy !== "fund"} type="button">Add funds</button>
              </div>
              {fundOpen && !isMobile && <div ref={fundPanel}>{fundForm(false)}</div>}
            </section>
            <section className="panel panel--pad">
              <div className="eyebrow">Spent in the last 24 hours</div>
              {t.loading || !s ? (
                <div className="shell__skel" style={{ height: 40, width: "60%" }} />
              ) : (
                <>
                  <div className="figure__big figure__big--sm">
                    <span>{fmtXlm(s.daySpent)}</span>
                    <small>/ {fmtXlm(s.dailyLimit)} {t.tokenCode}</small>
                  </div>
                  <div className="bar"><div className="bar__fill" style={{ width: `${dayPct}%` }} /></div>
                  <div className="meter__line">
                    <span>≤ {fmtXlm(s.perTaskLimit)} {t.tokenCode} per payment</span>
                    <span className="num">{fmtXlm(remaining)} left today</span>
                  </div>
                </>
              )}
            </section>
          </motion.div>

          {/* LEDGER */}
          <motion.div {...fadeUp(0.08)}>
            <RecentActivity rows={rows} freshId={freshId} week={week} onViewAll={() => onGo("activity")} />
          </motion.div>
        </div>

        <div className="page__side">
          {/* THE AGENT — whether one may spend, how much of its allowance is left, until when */}
          <motion.section className="panel panel--pad" {...fadeUp(0.06)}>
            <div className="panel__head">
              <div className="eyebrow">Your agent</div>
              {leashOn ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)" }}>
                  <i className="mark mark--ok" style={{ borderRadius: "50%", width: 7, height: 7 }} />may spend
                </span>
              ) : (
                <button className="linkbtn" onClick={() => onGo("agent")} type="button">connect one</button>
              )}
            </div>
            {leashOn && session ? (
              <>
                <div className="panel__title" style={{ fontSize: 22 }}>{countdown(Number(session.valid_until) * 1000 - now)} left</div>
                <div className="bar bar--thin"><div className="bar__fill" style={{ width: `${leashPct}%` }} /></div>
                <div className="meter__line">
                  <span className="num">{fmtXlm(session.spent)} / {fmtXlm(session.limit)} {t.tokenCode} used</span>
                  <span className="num">{shortAddr(session.agent)}</span>
                </div>
                <div>
                  <button className="danger-link" onClick={() => onGo("agent")} type="button">Revoke on the Agent page</button>
                </div>
              </>
            ) : (
              <div className="panel__note">No agent may spend right now. Connect one and it pays on its own, inside your rules, with no prompts.</div>
            )}
          </motion.section>

          {/* WAITING — exception requests the agent filed */}
          {session && <ExceptionRequests agent={session.agent} />}

          {/* RULES */}
          <motion.section className="panel panel--pad" {...fadeUp(0.1)}>
            <div className="panel__head">
              <div className="eyebrow">Rules on Stellar</div>
              <a className="linkbtn" href={`${EXPLORER}/contract/${treasuryId}`} target="_blank" rel="noreferrer">{shortAddr(treasuryId)} ↗</a>
            </div>
            {s ? (
              <>
                <div className="panel__kv"><span>Per day, at most</span><span className="num">{fmtXlm(s.dailyLimit)} {t.tokenCode}</span></div>
                <div className="panel__kv"><span>Per payment, at most</span><span className="num">{fmtXlm(s.perTaskLimit)} {t.tokenCode}</span></div>
                <div className="panel__kv"><span>Places it may pay</span><span className="num">{payeeCount ?? "—"}</span></div>
                {t.lifecycle?.paused && <div className="err">Spending is paused — every payment is refused until you resume.</div>}
              </>
            ) : (
              <div className="shell__skel" style={{ height: 80 }} />
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              <button className="btn btn--ghost" onClick={() => onGo("settings")} type="button">Change rules</button>
              <button className="btn btn--ghost" onClick={() => onGo("payments")} type="button">Payees</button>
            </div>
          </motion.section>

          {/* WHAT THE BUDGET IS FOR — a few things the agent can buy, with what each costs */}
          {t.tokenCode === "USDC" && (
            <motion.section className="panel panel--pad" {...fadeUp(0.14)}>
              <div className="eyebrow">What your agent can buy</div>
              {CATALOG_EXAMPLES.map((c) => (
                <div className="panel__kv" key={c.label}><span>{c.label}</span><span className="num">{c.price}</span></div>
              ))}
              <div className="panel__note">USDC per call, from the service catalog. Your agent finds the full list itself.</div>
            </motion.section>
          )}
        </div>
      </div>

      <BottomSheet open={fundOpen && isMobile} onClose={closeFund} title="Fund treasury">
        {fundForm(true)}
      </BottomSheet>
    </div>
  );
}
