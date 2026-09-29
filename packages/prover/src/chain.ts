// Read a closed period's real payments off the chain: the treasury's own `paid` events.
//
// A proof has to account for exactly what the treasury moved in the period, so the batch is
// never typed in by hand — it is rebuilt from the events `pay()` emits, and the caller then
// checks it adds up to the treasury's `period_spent`. The public RPC keeps about 7 days of
// events, which matches the verifier's own 7-day lookback: a period too old to read here is
// also too old to attest.
import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";

const SECONDS_PER_DAY = 86_400;
// Testnet closes a ledger roughly every 5 s; the margin covers slower stretches.
const SECONDS_PER_LEDGER = 5;
const MARGIN_LEDGERS = 2_000;

export interface PeriodPayment {
  to: string;
  amount: bigint;
  taskId: bigint;
  txHash: string;
  ledger: number;
  closedAt: string;
}

const PAID = xdr.ScVal.scvSymbol("paid").toXDR("base64");

/** Every `paid` event of `treasury` whose ledger closed inside UTC day `periodId`. */
export async function readPeriodPayments(
  rpcUrl: string,
  treasury: string,
  periodId: number,
): Promise<PeriodPayment[]> {
  const server = new rpc.Server(rpcUrl);
  const latest = (await server.getLatestLedger()).sequence;
  const dayStart = periodId * SECONDS_PER_DAY;
  const dayEnd = dayStart + SECONDS_PER_DAY;
  const secondsBack = Math.floor(Date.now() / 1000) - dayStart;
  const startLedger = Math.max(1, latest - Math.ceil(secondsBack / SECONDS_PER_LEDGER) - MARGIN_LEDGERS);

  const out: PeriodPayment[] = [];
  const filters: rpc.Api.EventFilter[] = [
    { type: "contract", contractIds: [treasury], topics: [[PAID, "*"]] },
  ];
  // The RPC scans a slice of ledgers per call and hands back a cursor even when that slice
  // was empty — page until the cursor reaches the tip, not until a page comes back short.
  let page = await server.getEvents({ startLedger, filters, limit: 200 });
  for (;;) {
    for (const e of page.events) {
      const t = Date.parse(e.ledgerClosedAt) / 1000;
      if (t < dayStart || t >= dayEnd) continue;
      const [to, amount] = scValToNative(e.value) as [string, bigint];
      const taskId = scValToNative(e.topic[1]) as bigint;
      out.push({ to, amount: BigInt(amount), taskId: BigInt(taskId), txHash: e.txHash, ledger: e.ledger, closedAt: e.ledgerClosedAt });
    }
    const cursorLedger = page.cursor ? Number(BigInt(page.cursor.split("-")[0]) >> 32n) : latest;
    if (!page.cursor || cursorLedger >= page.latestLedger) break;
    page = await server.getEvents({ cursor: page.cursor, filters, limit: 200 });
  }
  return out;
}
