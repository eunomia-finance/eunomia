// The whitelist is not enumerable on-chain (storage keys are Payee(Address)); the contract
// emits payee_add / payee_rm, so the set is rebuilt from events and every candidate is
// re-checked with is_payee before it is reported.
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
// Live listing: events nominate candidates, the cache remembers them, is_payee decides.
import { rpc, scValToNative } from "@stellar/stellar-sdk";
import type { Client } from "./bindings/treasury.js";
import type { TreasurySnapshot } from "./budget.js";
import type { KnownPayeeCache } from "./cache.js";
import type { NetworkConfig } from "./network.js";
import { isPayee } from "./treasury.js";

export interface PayeeListing {
  payees: string[];
  reputationPolicy: TreasurySnapshot["reputationPolicy"];
  coverage: { eventsFromLedger: number; latestLedger: number; cachedKnown: number; note: string };
}

const PAGE = 200;

/** Every payee_add / payee_rm the RPC still holds for this contract, oldest first. */
export async function fetchPayeeEvents(
  net: NetworkConfig,
  contractId: string,
): Promise<{ events: PayeeEvent[]; fromLedger: number; latestLedger: number }> {
  const server = new rpc.Server(net.rpcUrl);
  const health = await server.getHealth();
  // The window's first ledger may already have rolled off by the time we ask; one
  // ledger in is safely inside it.
  const fromLedger = health.oldestLedger + 1;
  const filters = [{ type: "contract" as const, contractIds: [contractId] }];
  const events: PayeeEvent[] = [];
  let cursor: string | undefined;
  let latestLedger = health.latestLedger;
  for (;;) {
    const page = await server.getEvents(
      cursor ? { cursor, filters, limit: PAGE } : { startLedger: fromLedger, filters, limit: PAGE },
    );
    latestLedger = page.latestLedger;
    for (const e of page.events) {
      const kind = String(scValToNative(e.topic[0]));
      if (kind === "payee_add" || kind === "payee_rm") {
        events.push({ kind, payee: String(scValToNative(e.value)) });
      }
    }
    if (page.events.length < PAGE || !page.cursor) break;
    cursor = page.cursor;
  }
  return { events, fromLedger, latestLedger };
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
