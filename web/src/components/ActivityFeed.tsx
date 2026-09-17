// Activity — the platform's full, live ledger. Three layers merged by tx hash:
// (1) full history from Supabase `activity` (the RPC forgets old events; this doesn't),
// (2) a Realtime INSERT subscription so any user's action lands here the second it's
// logged, (3) the original Soroban RPC cursor-poll for richer on-chain event labels.
import { useEffect, useMemo, useState } from "react";
import { rpc } from "@stellar/stellar-sdk";
import { EXPLORER, RPC_URL, TREASURY_ID, VERIFIER_ID, shortAddr } from "../config";
import { dedupeById, fetchAllEvents, fetchEventsPage, type FeedEvent } from "../lib/events";
import { fetchActivityHistory, mergeFeedEvents, subscribeActivity } from "../lib/activity";
import { filterFeed, type FeedFilter } from "../lib/feedFilter";
import { getTreasuryId } from "../lib/treasuryStore";
import { useWalletAddress } from "../lib/useWalletAddress";
import { whenOf } from "./shell/ledgerFormat";

const POLL_MS = 6000; // ~1 testnet ledger
const MAX_ITEMS = 120;
const PAGE = 30; // rows revealed per "Load more"

// The kind column. Only two kinds carry colour — a refusal writes in red, a payment the
// rules let through gets the green mark — the rest are neutral words.
function kindOf(kind: string): { cls: string; text: string; mark: string | null } {
  if (kind === "blocked") return { cls: "ledger__kind is-no", text: "Blocked", mark: "mark--no" };
  if (kind === "paid") return { cls: "ledger__kind", text: "Allowed", mark: "mark--ok" };
  if (kind === "fund") return { cls: "ledger__kind", text: "Funded", mark: null };
  if (kind === "deploy") return { cls: "ledger__kind", text: "Created", mark: null };
  if (kind === "whitelist" || kind === "payee_add") return { cls: "ledger__kind", text: "Payee +", mark: null };
  if (kind === "payee_rm") return { cls: "ledger__kind", text: "Payee −", mark: null };
  if (kind === "leash") return { cls: "ledger__kind", text: "Leash", mark: null };
  if (kind === "revoked") return { cls: "ledger__kind", text: "Revoked", mark: null };
  return { cls: "ledger__kind", text: kind.replace(/_/g, " "), mark: null };
}

export default function ActivityFeed({ filter }: { filter?: FeedFilter }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [state, setState] = useState<"connecting" | "live" | "error">("connecting");
  const [visible, setVisible] = useState(PAGE);

  // Watch the connected user's own treasury alongside the demo treasury + verifier —
  // otherwise a user's payments never show up here and the feed looks broken.
  const address = useWalletAddress();
  const myTreasury = address ? getTreasuryId(address) : null;

  const contractIds = useMemo(
    () => (myTreasury ? [TREASURY_ID, VERIFIER_ID, myTreasury] : [TREASURY_ID, VERIFIER_ID]),
    [myTreasury],
  );

  useEffect(() => {
    const server = new rpc.Server(RPC_URL);
    let cursor = "";
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stopped) return;
      try {
        const page = await fetchEventsPage(server, cursor ? { cursor, contractIds } : ({ contractIds } as never));
        if (page.events.length) {
          setEvents((prev) => mergeFeedEvents(dedupeById(page.events), prev, MAX_ITEMS));
        }
        if (page.cursor) cursor = page.cursor;
      } catch {
        /* transient RPC hiccup — keep polling */
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };

    const bootstrap = async () => {
      if (stopped) return;
      // Full platform history first — it doesn't depend on the RPC, so the feed paints
      // even when the RPC is down or the chain window has long forgotten the events.
      const history = await fetchActivityHistory(MAX_ITEMS);
      if (stopped) return;
      if (history.length) setEvents((prev) => mergeFeedEvents(prev, history, MAX_ITEMS));
      try {
        const latest = await server.getLatestLedger();
        const start = Math.max(1, latest.sequence - 17280); // RPC layer: ~last day, for richer labels
        // getEvents scans ~10k ledgers per call, so a day-wide window spans multiple
        // pages — page through to the head up front (head-based stop), or the newest
        // events (past the first, often empty, page) never render and the feed looks dead.
        const { events: all, cursor: c } = await fetchAllEvents(server, { startLedger: start, contractIds });
        if (stopped) return;
        setEvents((prev) => mergeFeedEvents(dedupeById(all), prev, MAX_ITEMS));
        cursor = c;
        setState("live");
        timer = setTimeout(tick, POLL_MS);
      } catch {
        // `tick` only ever starts after a successful bootstrap, so a failed one must
        // reschedule itself — otherwise the live layer stays dead for the whole session.
        setState(history.length ? "live" : "error");
        if (!stopped) timer = setTimeout(bootstrap, POLL_MS);
      }
    };

    bootstrap();

    // Realtime: any user's logged action lands here the moment it's inserted.
    const unsubscribe = subscribeActivity((e) => {
      if (!stopped) setEvents((prev) => mergeFeedEvents(prev, [e], MAX_ITEMS));
    });

    return () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [contractIds]);

  // View-level filter + paging: merge/poll state above stays untouched, so switching
  // chips never refetches — it just re-slices what's already in memory.
  const shown = useMemo(() => {
    const list = filter ? filterFeed(events, filter) : events;
    return { list: list.slice(0, visible), total: list.length };
  }, [events, filter, visible]);

  return (
    <section className="panel ledger">
      <div className="ledger__head">
        <div>
          <div className="eyebrow">Every decision on Eunomia</div>
          <div className="panel__title" style={{ marginTop: 4 }}>Activity</div>
        </div>
        <span className="count">
          <i className={`mark ${state === "live" ? "mark--ok" : state === "error" ? "mark--no" : "mark--ink"}`} style={{ borderRadius: "50%", width: 7, height: 7 }} />
          {state === "live" ? "live" : state === "connecting" ? "connecting" : "offline — retrying"}
        </span>
      </div>
      <div className="ledger__row ledger__row--feed ledger__row--head">
        <span className="eyebrow">Time</span>
        <span className="eyebrow">Kind</span>
        <span className="eyebrow sm-hide">Treasury</span>
        <span className="eyebrow">What</span>
        <span className="eyebrow sm-hide" style={{ textAlign: "right" }}>Proof</span>
      </div>

      {shown.list.length === 0 ? (
        <div className="ledger__empty">
          {state === "error"
            ? "Couldn't reach the network — retrying…"
            : state === "connecting"
              ? "Loading platform activity…"
              : filter && events.length > 0
                ? "Nothing matches these filters."
                : "No activity yet — the first treasury action lands here live."}
        </div>
      ) : (
        shown.list.map((e) => {
          const k = kindOf(e.kind);
          const decision = e.kind === "paid" || e.kind === "blocked";
          return (
            <div key={e.id} className={`ledger__row ledger__row--feed${decision ? "" : " ledger__row--quiet"}`}>
              <span className="ledger__when">{whenOf(e.at)}</span>
              <span className={k.cls}>
                {k.mark && <i className={`mark ${k.mark}`} />}
                {k.text}
              </span>
              <span className="ledger__when sm-hide" title={e.treasuryId ?? undefined}>{e.treasuryId ? shortAddr(e.treasuryId) : "—"}</span>
              <span className={`ledger__what${decision ? "" : " is-muted"}`} title={e.label}>{e.label}</span>
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
      {shown.total > visible && (
        <div className="ledger__more">
          <span>{shown.total - shown.list.length} older</span>
          <button onClick={() => setVisible((v) => v + PAGE)} type="button">Load more</button>
        </div>
      )}
    </section>
  );
}
