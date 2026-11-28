// The Overview's ledger: what the rules did, one decision per row, newest first. The verdict
// column is the only colour on the page (green fills, red writes); every row that landed on
// chain links its proof. Pure display — the data (durable history + live stream) comes from
// useTreasuryActivity in the parent, which also feeds the counters, so both always agree.
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { EXPLORER, shortAddr } from "../../config";
import { tx, useLang } from "../../lib/i18n";
import type { FeedEvent } from "../../lib/events";
import type { DayBucket } from "../../lib/insights";
import { amountOf, verdictOf, whenOf } from "./ledgerFormat";

const SHOW = 6;

export default function RecentActivity({
  rows,
  freshId,
  week,
  onViewAll,
}: {
  rows: FeedEvent[];
  freshId: string | null;
  week?: DayBucket[];
  onViewAll: () => void;
}) {
  useLang();
  const reduce = useReducedMotion();
  const shown = rows.slice(0, SHOW);
  const allowed = rows.filter((e) => e.kind === "paid").length;
  const blocked = rows.filter((e) => e.kind === "blocked").length;
  const maxDay = week ? Math.max(1, ...week.map((b) => b.allowed + b.blocked)) : 1;
  const weekAllowed = week ? week.reduce((n, b) => n + b.allowed, 0) : 0;
  const weekBlocked = week ? week.reduce((n, b) => n + b.blocked, 0) : 0;

  return (
    <section className="panel ledger">
      <div className="ledger__head">
        <div className="eyebrow">{tx("What your rules did", "Kuralların ne yaptı")}</div>
        {rows.length > 0 && (
          <div className="ledger__counts">
            <span className="count"><i className="mark mark--ok" />{allowed} {tx("allowed", "ödendi")}</span>
            <span className="count"><i className="mark mark--no" />{blocked} {tx("blocked", "reddedildi")}</span>
          </div>
        )}
      </div>
      <div className="ledger__row ledger__row--head">
        <span className="eyebrow">{tx("Time", "Saat")}</span>
        <span className="eyebrow">{tx("Verdict", "Karar")}</span>
        <span className="eyebrow">{tx("What", "Ne")}</span>
        <span className="eyebrow sm-hide" style={{ textAlign: "right" }}>{tx("Amount", "Tutar")}</span>
        <span className="eyebrow sm-hide" style={{ textAlign: "right" }}>{tx("Proof", "Kanıt")}</span>
      </div>

      {shown.length === 0 ? (
        <div className="ledger__empty">
          {tx("Nothing decided yet. The first payment your agent tries lands here — allowed or refused.", "Henüz karar yok. Ajanın denediği ilk ödeme buraya düşer: ödendi ya da reddedildi.")}
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {shown.map((e, i) => {
            const v = verdictOf(e.kind);
            const decision = e.kind === "paid" || e.kind === "blocked";
            return (
              <motion.div
                key={e.id}
                layout
                className={`ledger__row${decision ? "" : " ledger__row--quiet"}`}
                style={{ position: "relative" }}
                initial={reduce ? false : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, delay: reduce ? 0 : Math.min(i, 4) * 0.045 }}
              >
                <span className="ledger__when">{whenOf(e.at)}</span>
                <span className={v.cls}>{v.text}</span>
                <span className={`ledger__what${decision ? "" : " is-muted"}`} title={e.label}>{e.label}</span>
                <span className="ledger__amt sm-hide">{amountOf(e)}</span>
                {e.txHash ? (
                  <a className="ledger__tx sm-hide" href={`${EXPLORER}/tx/${e.txHash}`} target="_blank" rel="noreferrer">
                    {shortAddr(e.txHash)} ↗
                  </a>
                ) : (
                  <span className="ledger__tx sm-hide">—</span>
                )}
                {freshId === e.id && !reduce && (
                  <motion.span
                    aria-hidden
                    className="ledger__flash"
                    initial={{ background: "rgba(162,203,40,0.35)" }}
                    animate={{ background: "rgba(162,203,40,0)" }}
                    transition={{ duration: 1.1 }}
                  />
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      )}

      {week && (
        <div className="ledger__foot">
          <span className="eyebrow">{tx("Seven days", "Yedi gün")}</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 12, alignItems: "end", height: 30 }}>
            {week.map((b) => (
              <div key={b.day} style={{ display: "flex", gap: 3, alignItems: "flex-end", height: "100%" }} title={tx(`${b.day}: ${b.allowed} allowed · ${b.blocked} blocked`, `${b.day}: ${b.allowed} ödendi · ${b.blocked} reddedildi`)}>
                <span className="mark mark--ok" style={{ width: 10, height: Math.max(3, (b.allowed / maxDay) * 28) }} />
                <span className="mark mark--no" style={{ width: 10, height: Math.max(3, (b.blocked / maxDay) * 28) }} />
              </div>
            ))}
          </div>
          <span className="num">
            {weekAllowed} {tx("allowed", "ödendi")} · {weekBlocked} {tx("blocked", "reddedildi")}
            {rows.length > SHOW && (
              <>
                {" · "}
                <button className="linkbtn" onClick={onViewAll} type="button">{tx("every decision", "her karar")}</button>
              </>
            )}
          </span>
        </div>
      )}
    </section>
  );
}
