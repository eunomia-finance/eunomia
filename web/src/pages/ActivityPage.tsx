// Activity page: the platform ledger with view filters — kind-group chips and, when a
// treasury is open, a "my treasury only" toggle. Works without a wallet too (the platform
// feed is public social proof).
import { useMemo, useState } from "react";
import ActivityFeed from "../components/ActivityFeed";
import { KIND_GROUPS, type FeedFilter, type KindGroup } from "../lib/feedFilter";
import { useTreasury } from "../state/useTreasury";

const GROUP_LABEL: Record<KindGroup, string> = {
  payments: "Allowed",
  blocked: "Blocked",
  fund: "Funded",
  deploy: "Created",
  whitelist: "Payees",
  leash: "Leash",
  lifecycle: "Lifecycle",
  zk: "ZK",
};

export default function ActivityPage() {
  const t = useTreasury();
  const [active, setActive] = useState<Set<KindGroup>>(new Set());
  const [mineOnly, setMineOnly] = useState(false);

  const toggle = (g: KindGroup) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const filter = useMemo<FeedFilter | undefined>(() => {
    const groups = active.size > 0 ? active : null;
    const treasuryId = mineOnly && t.treasuryId ? t.treasuryId : null;
    return groups || treasuryId ? { groups, treasuryId } : undefined;
  }, [active, mineOnly, t.treasuryId]);

  return (
    <div className="page">
      <div className="page__main">
        <ActivityFeed filter={filter} />
      </div>

      {/* Filters as a standing panel rather than a chip strip above the ledger: which slice
          you are looking at should be visible while you read it, not scrolled off. */}
      <div className="page__side">
        <section className="panel panel--pad">
          <div className="eyebrow">Show</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className={`chip${active.size === 0 ? " is-on" : ""}`} onClick={() => setActive(new Set())} type="button">
              All
            </button>
            {(Object.keys(KIND_GROUPS) as KindGroup[]).map((g) => (
              <button key={g} className={`chip${active.has(g) ? " is-on" : ""}`} onClick={() => toggle(g)} type="button">
                {GROUP_LABEL[g]}
              </button>
            ))}
          </div>
          {t.treasuryId && (
            <button className={`chip${mineOnly ? " is-on" : ""}`} style={{ width: "100%", marginTop: 4 }} onClick={() => setMineOnly((m) => !m)} type="button">
              my treasury only
            </button>
          )}
          <div className="panel__note">
            Every treasury action across Eunomia — full history, streamed live. On-chain events from the demo treasury,
            the ZK verifier and your own treasury ride on top.
          </div>
        </section>
      </div>
    </div>
  );
}
