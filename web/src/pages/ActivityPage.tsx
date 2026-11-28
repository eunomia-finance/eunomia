// Activity page: the platform ledger with view filters — kind-group chips and, when a
// treasury is open, a "my treasury only" toggle. Works without a wallet too (the platform
// feed is public social proof).
import { useMemo, useState } from "react";
import ActivityFeed from "../components/ActivityFeed";
import { KIND_GROUPS, type FeedFilter, type KindGroup } from "../lib/feedFilter";
import { tx, useLang } from "../lib/i18n";
import { useTreasury } from "../state/useTreasury";

const groupLabel = (): Record<KindGroup, string> => ({
  payments: tx("Allowed", "Ödendi"),
  blocked: tx("Blocked", "Reddedildi"),
  fund: tx("Funded", "Para yatırıldı"),
  deploy: tx("Created", "Oluşturuldu"),
  whitelist: tx("Payees", "Alıcılar"),
  leash: tx("Leash", "Yetki"),
  lifecycle: tx("Lifecycle", "Yaşam döngüsü"),
  zk: "ZK",
});

export default function ActivityPage() {
  useLang();
  const t = useTreasury();
  const labels = groupLabel();
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
          <div className="eyebrow">{tx("Show", "Göster")}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className={`chip${active.size === 0 ? " is-on" : ""}`} onClick={() => setActive(new Set())} type="button">
              {tx("All", "Hepsi")}
            </button>
            {(Object.keys(KIND_GROUPS) as KindGroup[]).map((g) => (
              <button key={g} className={`chip${active.has(g) ? " is-on" : ""}`} onClick={() => toggle(g)} type="button">
                {labels[g]}
              </button>
            ))}
          </div>
          {t.treasuryId && (
            <button className={`chip${mineOnly ? " is-on" : ""}`} style={{ width: "100%", marginTop: 4 }} onClick={() => setMineOnly((m) => !m)} type="button">
              {tx("my treasury only", "sadece benim kasam")}
            </button>
          )}
          <div className="panel__note">
            {tx(
              "Every treasury action across Eunomia — full history, streamed live. On-chain events from your own treasury ride on top.",
              "Eunomia'daki her kasa hareketi, tüm geçmişiyle canlı akar. Kendi kasanın zincir olayları da üstüne eklenir.",
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
