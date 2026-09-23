// The hero page. Its job is not to report a balance — it is to show what the rules did.
// The latest decision sits in the one dark panel on the page; the ledger under it lists
// every decision; the side column answers the questions those decisions raise (how much of
// the day is left, what the Leash holds, what is waiting for the owner, what the rules are).
//
// There is no "send a payment" here on purpose: the agent pays, the rules decide, this
// page reports. Paying by hand is the escape hatch on the Payments page.
import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { EXPLORER, fmtXlm, shortAddr } from "../config";
import { useTreasury } from "../state/useTreasury";
import { useAnalyticsScore } from "../lib/useAnalytics";
import { useTreasuryActivity } from "../lib/useTreasuryActivity";
import { mergeFeedEvents } from "../lib/activity";
import { dedupeRefusals, useAgentRejections } from "../lib/agentRejections";
import { computeAnomaly, mergeLedger } from "../lib/eventLedger";
import { loadPayeeBook, mergePayees, payeesFromEvents } from "../lib/payees";
import { setupProgress, type SetupStep } from "../lib/onboarding";
import { needsFunding, MIN_XLM } from "../lib/funding";
import { useNow } from "../lib/useNow";
import type { View } from "../lib/routes";
import RecentActivity from "../components/shell/RecentActivity";
import { amountOf, inToken, whenOf } from "../components/shell/ledgerFormat";
import ExceptionRequests from "../components/ExceptionRequests";
import BottomSheet from "../components/shell/BottomSheet";
import AddFundsTry from "../components/AddFundsTry";
import { decisionsByDay } from "../lib/insights";
import { useIsMobile } from "../lib/useIsMobile";

// What the user should do next, in their words — one line, not a five-step strip.
const NEXT_LINE: Partial<Record<SetupStep, string>> = {
  connect: "Connect a wallet to begin.",
  deploy: "Create your treasury with its rules built in.",
  fund: "Your treasury pays from its own balance — top it up to start.",
  whitelist: "Payments can only go to payees you've approved. Approve one.",
};
const NEXT_CTA: Partial<Record<SetupStep, string>> = {
  fund: "Add funds",
  whitelist: "Approve a payee",
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
  const whitelistSeen = rows.some((e) => e.kind === "whitelist");
  const paidSeen = rows.some((e) => e.kind === "paid");

  // Anomaly runs on the MERGED, deduped ledger (chain scan + durable activity log) so a
  // Realtime row arriving before the RPC re-scan can't make the notice flicker on and off.
  const anomaly = useMemo(
    () => computeAnomaly(mergeLedger(analytics.events, rows)),
    [analytics.events, rows],
  );

  const progress = setupProgress({
    connected: !!t.address,
    hasTreasury: true,
    balance: t.state?.balance ?? null,
    payeeCount: payeeCount || (whitelistSeen ? 1 : payeeCount),
    hasPaid: analytics.score.payments > 0 || paidSeen || (t.state ? t.state.daySpent > 0n : false),
  });

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

  const xlmFundForm = (inSheet: boolean) => (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
      <input
        className="field field--mono"
        style={{ flex: 1, minWidth: 160 }}
        ref={inSheet ? undefined : fundInput}
        autoFocus={inSheet}
        inputMode="decimal"
        placeholder="Amount in XLM"
        aria-label="Fund amount in XLM"
        value={fundAmt}
        onChange={(e) => setFundAmt(e.target.value)}
      />
      <button className="btn" onClick={() => void doFund()} disabled={!!t.busy} type="button">
        {t.busy === "fund" ? "Funding…" : "Fund"}
      </button>
      {fundErr && <div className="err" style={{ width: "100%" }}>{fundErr}</div>}
    </div>
  );

  const stepCta = () => {
    if (progress.next === "fund") openFund();
    else if (progress.next === "whitelist") onGo("payments");
  };

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
  const nudge = progress.next && NEXT_LINE[progress.next];
  const closeFund = () => {
    setFundOpen(false);
    setFundErr("");
  };
  // A USDC treasury is funded with TRY through the anchor; an XLM one from the wallet.
  const fundForm = (inSheet: boolean) =>
    t.tokenCode === "USDC" ? <AddFundsTry onDone={closeFund} /> : xlmFundForm(inSheet);

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
            {t.walletXlm === null ? "Your wallet holds no testnet XLM yet." : `Your wallet holds ${t.walletXlm.toFixed(2)} XLM.`}{" "}
            The treasury is empty and you need about {MIN_XLM} XLM in the wallet to fund it.
          </span>
          <button className="btn btn--ghost" onClick={() => void t.friendbot()} disabled={!!t.busy} type="button">
            {t.busy === "friendbot" ? "Sending…" : "Get test XLM"}
          </button>
        </div>
      )}

      {/* Not before the state is read: with the balance still unknown the next step reads as
          "fund", and once it loads the same button turns into "Approve a payee" under the
          cursor — a click meant for one lands on the other and changes the page. */}
      {s && !progress.complete && nudge && (
        <div className="notice">
          <span>{nudge}</span>
          {progress.next && NEXT_CTA[progress.next] && (
            <button className="btn btn--ghost" onClick={stepCta} type="button">{NEXT_CTA[progress.next]}</button>
          )}
        </div>
      )}

      <div className="page">
        <div className="page__main">
          {/* VERDICT — the latest decision, in ink */}
          <motion.section className={`verdict${latest ? "" : " verdict--quiet"}`} {...fadeUp(0)}>
            {latest ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                  <div className="eyebrow">Latest decision · {whenOf(latest.at)}</div>
                  <div className="verdict__line">
                    <span className="verdict__amount">{amountOf(latest) ? `${Number(amountOf(latest))} ${t.tokenCode}` : latest.kind === "blocked" ? "Refused" : "Paid"}</span>
                  </div>
                  <div className="verdict__why">{latest.label}</div>
                </div>
                <div className="verdict__side">
                  <span className={`pill pill--lg ${latest.kind === "blocked" ? "pill--no" : "pill--ok"}`} style={latest.kind === "blocked" ? { color: "#ff8a78" } : undefined}>
                    {latest.kind === "blocked" ? "Blocked" : "Allowed"}
                  </span>
                  {latest.txHash && (
                    <a className="verdict__tx" href={`${EXPLORER}/tx/${latest.txHash}`} target="_blank" rel="noreferrer">
                      tx {shortAddr(latest.txHash)} ↗
                    </a>
                  )}
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="eyebrow">Latest decision</div>
                <div className="verdict__line"><span className="verdict__amount">Nothing yet</span></div>
                <div className="verdict__why">The first payment your agent tries will show here — allowed or refused by the contract, with its proof.</div>
              </div>
            )}
          </motion.section>

          {/* LEDGER */}
          <motion.div {...fadeUp(0.08)}>
            <RecentActivity rows={rows} freshId={freshId} week={week} onViewAll={() => onGo("activity")} />
          </motion.div>
        </div>

        <div className="page__side">
          {/* METER */}
          <motion.section className="panel panel--pad" {...fadeUp(0.06)}>
            <div className="eyebrow">Rolling 24 hours</div>
            {t.loading || !s ? (
              <div className="shell__skel" style={{ height: 40, width: "60%" }} />
            ) : (
              <>
                <div className="meter__big">
                  <span className="num">{fmtXlm(s.daySpent)}</span>
                  <small>/ {fmtXlm(s.dailyLimit)} {t.tokenCode}</small>
                </div>
                <div className="bar"><div className="bar__fill" style={{ width: `${dayPct}%` }} /></div>
                <div className="meter__line">
                  <span>≤ {fmtXlm(s.perTaskLimit)} {t.tokenCode} per payment</span>
                  <span className="num">{fmtXlm(remaining)} left</span>
                </div>
              </>
            )}
          </motion.section>

          {/* LEASH */}
          <motion.section className="panel panel--pad" {...fadeUp(0.1)}>
            <div className="panel__head">
              <div className="eyebrow">Leash</div>
              {leashOn ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)" }}>
                  <i className="mark mark--ok" style={{ borderRadius: "50%", width: 7, height: 7 }} />active
                </span>
              ) : (
                <button className="linkbtn" onClick={() => onGo("agent")} type="button">start one</button>
              )}
            </div>
            {leashOn && session ? (
              <>
                <div className="num" style={{ fontSize: 14 }}>
                  {shortAddr(session.agent)} <span style={{ color: "var(--ink-2)" }}>· {t.sessionSecret ? "this device" : "external agent"}</span>
                </div>
                <div className="bar bar--thin"><div className="bar__fill bar__fill--ink" style={{ width: `${leashPct}%` }} /></div>
                <div className="meter__line">
                  <span className="num">{fmtXlm(session.spent)} / {fmtXlm(session.limit)} {t.tokenCode}</span>
                  <span className="num">expires in {countdown(Number(session.valid_until) * 1000 - now)}</span>
                </div>
              </>
            ) : (
              <div className="panel__note">No agent is on a Leash. Authorise one and it pays on its own, inside these rules, with no prompts.</div>
            )}
          </motion.section>

          {/* WAITING — exception requests the agent filed */}
          {session && <ExceptionRequests agent={session.agent} />}

          {/* RULES */}
          <motion.section className="panel panel--pad" {...fadeUp(0.14)}>
            <div className="panel__head">
              <div className="eyebrow">Rules on Stellar</div>
              <a className="linkbtn" href={`${EXPLORER}/contract/${treasuryId}`} target="_blank" rel="noreferrer">{shortAddr(treasuryId)} ↗</a>
            </div>
            {s ? (
              <>
                <div className="panel__kv"><span>Per day</span><span className="num">{fmtXlm(s.dailyLimit)} {t.tokenCode}</span></div>
                <div className="panel__kv"><span>Per payment</span><span className="num">{fmtXlm(s.perTaskLimit)} {t.tokenCode}</span></div>
                <div className="panel__kv"><span>Approved payees</span><span className="num">{payeeCount ?? "—"}</span></div>
                <div className="panel__kv"><span>Balance</span><span className="num" data-testid="treasury-balance">{fmtXlm(s.balance)} {t.tokenCode}</span></div>
                {t.lifecycle?.paused && <div className="err">Spending is paused — every payment is refused until you resume.</div>}
              </>
            ) : (
              <div className="shell__skel" style={{ height: 80 }} />
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              <button className="btn btn--ghost" onClick={() => (fundOpen ? closeFund() : openFund())} disabled={!!t.busy && t.busy !== "fund"} type="button">Add funds</button>
              <button className="btn btn--ghost" onClick={() => onGo("payments")} type="button">Payees</button>
            </div>
            {fundOpen && !isMobile && <div ref={fundPanel}>{fundForm(false)}</div>}
          </motion.section>
        </div>
      </div>

      <BottomSheet open={fundOpen && isMobile} onClose={closeFund} title="Fund treasury">
        {fundForm(true)}
      </BottomSheet>
    </div>
  );
}
