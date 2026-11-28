// Real-time contract event synchronisation (Level 2). Soroban has no push stream, so
// we cursor-poll the RPC's getEvents for the contracts a view follows and surface them as
// a live activity feed.
import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { tx } from "./i18n";

export interface FeedEvent {
  id: string;
  kind: string; // topic symbol: paid / attested / escrowed / payee_add / paused / …
  label: string; // human summary
  txHash: string;
  at: string; // ISO timestamp (ledgerClosedAt)
  amountXlm?: number; // for `paid` events — the XLM amount, used by analytics
  treasuryId?: string; // emitting contract (or the activity row's treasury) — per-treasury filters
  payee?: string; // for payee_add / payee_rm — the whitelisted/removed address
}

const short = (s: unknown) => {
  const a = String(s);
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
};
const xlm = (v: unknown) => (Number(v) / 1e7).toLocaleString(undefined, { maximumFractionDigits: 4 });
// 32-byte big-endian field element (e.g. periodId) -> its integer value.
export const bytesToInt = (b: unknown): string => {
  if (b instanceof Uint8Array) {
    let n = 0n;
    for (const x of b) n = (n << 8n) | BigInt(x);
    return n.toString();
  }
  return String(b ?? "");
};

/** Pure formatter: decoded topic symbols + data -> a human label. Testable in isolation. */
export function formatEvent(topics: unknown[], data: unknown): { kind: string; label: string } {
  const kind = String(topics[0] ?? "event");
  const d = data as unknown[];
  switch (kind) {
    case "paid":
      return { kind, label: `Agent paid ${xlm(d?.[1])} XLM to ${short(d?.[0])} · task ${topics[1]}` };
    case "attested":
      return { kind, label: tx(`ZK compliance attested · period ${bytesToInt(d?.[1])}`, `ZK uyumluluk kanıtlandı · dönem ${bytesToInt(d?.[1])}`) };
    case "escrowed":
      return { kind, label: tx(
          `Escrow #${topics[1]} opened · ${xlm(d?.[1])} XLM for ${short(d?.[0])}`,
          `Emanet #${topics[1]} açıldı · ${xlm(d?.[1])} XLM · ${short(d?.[0])} için`,
        ) };
    case "released":
      return { kind, label: tx(`Escrow #${topics[1]} released to ${short(d?.[0])}`, `Emanet #${topics[1]} bırakıldı · ${short(d?.[0])}`) };
    case "refunded":
      return { kind, label: tx(`Escrow #${topics[1]} refunded`, `Emanet #${topics[1]} iade edildi`) };
    case "payee_add":
      return { kind, label: tx(`Payee approved: ${short(data)}`, `Alıcı onaylandı: ${short(data)}`) };
    case "payee_rm":
      return { kind, label: tx(`Payee removed: ${short(data)}`, `Alıcı kaldırıldı: ${short(data)}`) };
    case "paused":
      return { kind, label: data ? tx("Treasury paused", "Kasa durduruldu") : tx("Treasury resumed", "Kasa devam ediyor") };
    case "revoked":
      return { kind, label: "Leash revoked" };
    case "agent":
      return { kind, label: tx(`Root agent rotated to ${short(data)}`, `Kök ajan değişti: ${short(data)}`) };
    default:
      return { kind, label: kind };
  }
}

/** One page of getEvents, decoded into feed items, for the contracts named — plus either
 *  startLedger or a cursor. */
export async function fetchEventsPage(
  server: rpc.Server,
  o: { contractIds: string[]; startLedger?: number; cursor?: string; limit?: number },
): Promise<{ events: FeedEvent[]; cursor: string; latestLedger: number }> {
  // An empty filter would not mean "nothing": it would ask for every contract's events.
  if (o.contractIds.length === 0) throw new Error("fetchEventsPage: no contracts to watch.");
  const filters = [{ type: "contract" as const, contractIds: o.contractIds }];
  const res = await server.getEvents(
    o.cursor
      ? { cursor: o.cursor, filters, limit: o.limit }
      : { startLedger: o.startLedger ?? 0, filters, limit: o.limit },
  );

  const events = res.events.map((e): FeedEvent => {
    const topics = e.topic.map((t) => scValToNative(t));
    const data = scValToNative(e.value);
    const { kind, label } = formatEvent(topics, data);
    const d = data as unknown[];
    const amountXlm = kind === "paid" ? Number(d?.[1]) / 1e7 : undefined;
    const payee = kind === "payee_add" || kind === "payee_rm" ? String(data) : undefined;
    return {
      id: e.id,
      kind,
      label,
      txHash: e.txHash,
      at: e.ledgerClosedAt,
      amountXlm,
      treasuryId: e.contractId?.toString(),
      payee,
    };
  });
  return {
    events,
    cursor: (res as { cursor?: string }).cursor ?? "",
    latestLedger: (res as { latestLedger?: number }).latestLedger ?? 0,
  };
}

/** The ledger a getEvents paging cursor points at (the TOID's high 32 bits).
 *  Returns 0 when the cursor is empty/unparsable — callers then fall back to the
 *  maxPages guard, so a format change can never loop forever. */
export function cursorLedger(cursor: string): number {
  const toid = cursor.split("-")[0];
  if (!toid || !/^\d+$/.test(toid)) return 0;
  return Number(BigInt(toid) >> 32n);
}

/** Drop duplicate event ids, keeping each id's first occurrence. */
export function dedupeById(list: FeedEvent[]): FeedEvent[] {
  const seen = new Set<string>();
  return list.filter((e) => (seen.has(e.id) ? false : seen.add(e.id)));
}

/** Page from the fetcher's starting point all the way to the chain head. Termination is
 *  head-based (cursor ledger vs latestLedger), NOT events-length-based: an empty page can
 *  just be a quiet scan window, and the RPC returns a cursor even at head. The newest
 *  events are therefore never silently dropped; `truncated` reports the rare case where
 *  the maxPages guard tripped before reaching head (history incomplete at the OLD end
 *  of what was read — the caller should surface, not ignore, partial totals). */
export async function pageToHead(
  fetchPage: (
    cursor?: string,
  ) => Promise<{ events: FeedEvent[]; cursor: string; latestLedger: number }>,
  maxPages = 50,
): Promise<{ events: FeedEvent[]; cursor: string; truncated: boolean }> {
  let page = await fetchPage();
  let events = page.events;
  let pages = 1;
  const behindHead = () =>
    Boolean(page.cursor) && page.latestLedger > 0 && cursorLedger(page.cursor) <= page.latestLedger;
  while (pages < maxPages && behindHead()) {
    const before = cursorLedger(page.cursor);
    page = await fetchPage(page.cursor);
    events = [...events, ...page.events];
    pages++;
    // Head-stall: once the RPC has caught up to head it hands back an empty page whose
    // cursor no longer advances. Without this, `behindHead()` (cursor ledger == latest)
    // stays true and we spin to maxPages, reporting spurious truncation. Both conditions
    // are required — an empty page whose cursor DID advance is just a quiet scan window.
    if (page.events.length === 0 && cursorLedger(page.cursor) <= before) break;
  }
  // Only a real maxPages cut-off means history was left unread at the old end.
  return { events, cursor: page.cursor, truncated: pages >= maxPages && behindHead() };
}

/** getEvents from `startLedger` (or an incremental `cursor`) up to the chain head. */
export async function fetchAllEvents(
  server: rpc.Server,
  opts: { contractIds: string[]; startLedger?: number; cursor?: string },
): Promise<{ events: FeedEvent[]; cursor: string; truncated: boolean }> {
  return pageToHead((c) => {
    const cursor = c ?? opts.cursor;
    return fetchEventsPage(
      server,
      cursor
        ? { cursor, contractIds: opts.contractIds, limit: 1000 }
        : { startLedger: opts.startLedger, contractIds: opts.contractIds, limit: 1000 },
    );
  });
}
