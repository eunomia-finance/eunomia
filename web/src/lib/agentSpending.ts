// What the agent did with its task money. The treasury's own events end where the float
// begins: the contract emits `paid` when it hands the agent its task money, and nothing after
// that, because what follows is not a treasury call. The agent pays a service from its own
// G… account (Stellar's x402 and MPP facilitators settle only from one), and returns what is
// left with a plain token transfer. An owner looking at the ledger saw money go to the agent
// and never saw what it bought.
//
// Horizon has both: every payment the agent's account took part in, token-contract transfers
// included. This module reads the ones the agent sent — to a service, or back to the treasury.
import { useEffect, useMemo, useState } from "react";
import { HORIZON_URL, USDC_ISSUER } from "../config";
import { catalogName } from "./agentSetup";
import type { FeedEvent } from "./events";
import { tx, useLang } from "./i18n";

/** One asset movement inside a contract call, as Horizon reports it. */
export interface BalanceChange {
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  type?: string;
  from?: string;
  to?: string;
  amount?: string;
}

/** A record of Horizon's /payments, reduced to what is read here. A classic payment carries
 *  its asset and parties on the record itself; a token-contract transfer carries them in
 *  `asset_balance_changes`. */
export interface PaymentRecord extends BalanceChange {
  id: string;
  type: string;
  transaction_successful?: boolean;
  created_at: string;
  transaction_hash: string;
  asset_balance_changes?: BalanceChange[];
}

export interface SpendingScope {
  agent: string;
  treasuryId: string;
  /** the treasury's token: the float is handed over in it, so that is what the agent spends */
  token: "XLM" | "USDC";
  usdcIssuer: string;
}

const short = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

/** The agent's outgoing payments as ledger rows: `spent` to a service, `swept` back to the
 *  treasury. Pure. What the agent received is left out — the treasury's `paid` event is the
 *  record of that, and it would otherwise be listed twice. */
export function agentSpendingToFeed(records: PaymentRecord[], scope: SpendingScope): FeedEvent[] {
  // Issuer and all: anyone can issue an asset called USDC.
  const isToken = (c: BalanceChange) =>
    scope.token === "XLM" ? c.asset_type === "native" : c.asset_code === "USDC" && c.asset_issuer === scope.usdcIssuer;
  const out: FeedEvent[] = [];
  for (const r of records) {
    if (r.transaction_successful === false) continue;
    const moves: BalanceChange[] =
      r.type === "invoke_host_function"
        ? (r.asset_balance_changes ?? []).filter((c) => c.type === "transfer")
        : r.type === "payment"
          ? [r]
          : [];
    moves.forEach((m, i) => {
      if (m.from !== scope.agent || !m.to || m.to === scope.agent || !isToken(m)) return;
      const amount = Number(m.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      const row: FeedEvent = {
        id: `ap-${r.id}-${i}`,
        kind: m.to === scope.treasuryId ? "swept" : "spent",
        label: "",
        txHash: r.transaction_hash,
        at: r.created_at,
        amountXlm: amount,
        treasuryId: scope.treasuryId,
        payee: m.to,
      };
      out.push({ ...row, label: spendingLabel(row) });
    });
  }
  return out;
}

/** A row's sentence in the reader's language. */
export function spendingLabel(e: Pick<FeedEvent, "kind" | "payee">): string {
  if (e.kind === "swept") return tx("Unspent task money returned to the treasury", "Artan görev parası kasaya döndü");
  const who = e.payee ? (catalogName(e.payee) ?? short(e.payee)) : "";
  return tx(`Agent paid ${who}`, `Ajan ödedi: ${who}`);
}

/** The newest payments the agent's account took part in. A missing account has none. */
export async function fetchAgentSpending(agent: string, fetchFn: typeof fetch = fetch): Promise<PaymentRecord[]> {
  const res = await fetchFn(`${HORIZON_URL}/accounts/${agent}/payments?order=desc&limit=100`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Horizon error ${res.status} — could not read the agent's payments.`);
  const body = (await res.json()) as { _embedded?: { records?: PaymentRecord[] } };
  return body._embedded?.records ?? [];
}

const NONE: FeedEvent[] = [];

/** What the treasury's current agent paid from its own account, as ledger rows. Empty while
 *  no agent is connected — there is no account to read. */
export function useAgentSpending(
  agent: string | null,
  treasuryId: string | null,
  token: "XLM" | "USDC",
  refreshKey = 0,
): FeedEvent[] {
  const lang = useLang();
  // Keyed by what it was read for, so a new agent or another treasury never shows the last one's rows.
  const [read, setRead] = useState<{ key: string; rows: FeedEvent[] }>({ key: "", rows: NONE });
  const key = agent && treasuryId ? `${agent}:${treasuryId}:${token}` : "";
  useEffect(() => {
    if (!agent || !treasuryId) return;
    let alive = true;
    void fetchAgentSpending(agent)
      .then((records) => alive && setRead({ key, rows: agentSpendingToFeed(records, { agent, treasuryId, token, usdcIssuer: USDC_ISSUER }) }))
      // Horizon down: the ledger shows what it showed before this existed.
      .catch(() => alive && setRead({ key, rows: NONE }));
    return () => {
      alive = false;
    };
  }, [agent, treasuryId, token, key, refreshKey]);
  const rows = key && read.key === key ? read.rows : NONE;
  return useMemo(() => {
    // The sentence is written when the rows are read; a language switch has to rewrite it.
    void lang;
    return rows === NONE ? NONE : rows.map((e) => ({ ...e, label: spendingLabel(e) }));
  }, [rows, lang]);
}
