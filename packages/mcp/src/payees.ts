// The whitelist is not enumerable on-chain (storage keys are Payee(Address)); the contract
// emits payee_add / payee_rm, so the set is rebuilt from events and every candidate is
// re-checked with is_payee before it is reported.
import { rpc, scValToNative } from "@stellar/stellar-sdk";
import type { Client } from "./bindings/treasury.js";
import type { TreasurySnapshot } from "./budget.js";
import type { KnownPayeeCache } from "./cache.js";
import type { NetworkConfig } from "./network.js";
import { isPayee } from "./treasury.js";

export interface PayeeEvent {
  kind: string;
  payee?: string;
}

/** Replay add/remove events into the current set. Pure; order of first appearance kept. */
export function reducePayeeEvents(events: PayeeEvent[]): string[] {
  const set = new Set<string>();
  for (const e of events) {
    if (!e.payee) continue;
    if (e.kind === "payee_add") set.add(e.payee);
    else if (e.kind === "payee_rm") set.delete(e.payee);
  }
  return [...set];
}

// ---------------------------------------------------------------------------------
// Pagination. The RPC scans at most ~10 000 ledgers per getEvents call and hands back a
// cursor even when that slice held no events, so "fewer events than the limit" says
// nothing about being done — only the cursor's ledger reaching the tip does. Measured
// on testnet 2026-09-14: a 120 960-ledger window came back as 0 events + a cursor
// 9 999 ledgers in.

export interface EventPage {
  events: PayeeEvent[];
  cursor?: string;
  latestLedger: number;
}
export type FetchPage = (q: { startLedger?: number; cursor?: string }) => Promise<EventPage>;

/** A getEvents cursor is `<toid>-<event index>`; the ledger is the toid's top 32 bits. */
export const cursorLedger = (cursor: string): number => Number(BigInt(cursor.split("-")[0]) >> 32n);

const MAX_PAGES = 200;

/** Walk every page from `fromLedger` to the tip, whatever each page held. */
export async function collectPayeeEvents(
  fetchPage: FetchPage,
  fromLedger: number,
): Promise<{ events: PayeeEvent[]; latestLedger: number; pages: number }> {
  const events: PayeeEvent[] = [];
  let page = await fetchPage({ startLedger: fromLedger });
  let pages = 1;
  for (;;) {
    events.push(...page.events);
    if (!page.cursor || cursorLedger(page.cursor) >= page.latestLedger || pages >= MAX_PAGES) {
      return { events, latestLedger: page.latestLedger, pages };
    }
    page = await fetchPage({ cursor: page.cursor });
    pages++;
  }
}

const PAGE = 200;
// The retention window slides one ledger every ~5 s; starting a little inside it keeps
// the first request valid even if health was read a moment ago.
const WINDOW_MARGIN = 20;

/** Every payee_add / payee_rm the RPC still holds for this contract, oldest first. */
export async function fetchPayeeEvents(
  net: NetworkConfig,
  contractId: string,
): Promise<{ events: PayeeEvent[]; fromLedger: number; latestLedger: number }> {
  const server = new rpc.Server(net.rpcUrl);
  const filters = [{ type: "contract" as const, contractIds: [contractId] }];
  const fetchPage: FetchPage = async (q) => {
    const res = await server.getEvents(
      q.cursor ? { cursor: q.cursor, filters, limit: PAGE } : { startLedger: q.startLedger!, filters, limit: PAGE },
    );
    const events: PayeeEvent[] = [];
    for (const e of res.events) {
      const kind = String(scValToNative(e.topic[0]));
      if (kind === "payee_add" || kind === "payee_rm") {
        events.push({ kind, payee: String(scValToNative(e.value)) });
      }
    }
    return { events, cursor: res.cursor, latestLedger: res.latestLedger };
  };
  const health = await server.getHealth();
  const fromLedger = health.oldestLedger + WINDOW_MARGIN;
  const { events, latestLedger } = await collectPayeeEvents(fetchPage, fromLedger);
  return { events, fromLedger, latestLedger };
}

export interface PayeeListing {
  payees: string[];
  reputationPolicy: TreasurySnapshot["reputationPolicy"];
  coverage: { eventsFromLedger: number; latestLedger: number; cachedKnown: number; note: string };
}

export const COVERAGE_NOTE =
  "Payees are rebuilt from the contract's payee_add/payee_rm events (the RPC keeps ~7 days) plus a local cache, and each address is re-verified on-chain with is_payee before it is listed. A payee approved before the event window and never seen by this machine will not appear here — check_payee answers exactly for any address.";

export async function listAllowedPayees(
  net: NetworkConfig,
  client: Client,
  contractId: string,
  cache: KnownPayeeCache,
  rep: TreasurySnapshot["reputationPolicy"],
): Promise<PayeeListing> {
  const { events, fromLedger, latestLedger } = await fetchPayeeEvents(net, contractId);
  const known = cache.load(contractId);
  const candidates = [...new Set([...known, ...reducePayeeEvents(events)])];
  // is_payee is the chain's answer; events and the cache only nominate candidates.
  const checks = await Promise.all(candidates.map(async (p) => [p, await isPayee(client, p)] as const));
  const payees = checks.filter(([, ok]) => ok).map(([p]) => p);
  cache.save(contractId, payees);
  return {
    payees,
    reputationPolicy: rep,
    coverage: { eventsFromLedger: fromLedger, latestLedger, cachedKnown: known.length, note: COVERAGE_NOTE },
  };
}
