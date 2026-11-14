// The relay's daily fee budget as a Durable Object: one instance, so every worker instance
// charges the same counters. The accounting is src/lib/relayBudget.ts; this is only the
// storage and the wire format between the worker and the object.
import { budgetDay, budgetKey, isLane, releaseIn, reserveIn, type FeeBudget } from "../src/lib/relayBudget";

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
}

export interface BudgetNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(url: string, init: RequestInit): Promise<Response> };
}

interface Wire {
  op?: "reserve" | "release";
  stroops: string;
  limit?: string;
  lane?: string;
}

export class RelayBudget {
  private readonly state: DurableObjectState;
  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const { op, stroops, limit, lane } = (await req.json()) as Wire;
    // Only the worker can reach this object, but a lane becomes a storage key: one that does
    // not look like a lane is refused rather than written.
    if (lane !== undefined && !isLane(lane)) return Response.json({ ok: false });
    const store = { get: (k: string) => this.state.storage.get<string>(k), put: (k: string, v: string) => this.state.storage.put(k, v) };
    const key = budgetKey(budgetDay(Date.now()), lane);
    if (op === "release") {
      await releaseIn(store, key, BigInt(stroops));
      return Response.json({ ok: true });
    }
    if (limit === undefined) return Response.json({ ok: false });
    return Response.json({ ok: await reserveIn(store, key, BigInt(stroops), BigInt(limit)) });
  }
}

/** The budget the relay sees, backed by the single `relay` instance of the object. A failed
 *  call to the object counts as a refusal: an unreachable budget is no budget. */
export function durableBudget(ns: BudgetNamespace): FeeBudget {
  const stub = ns.get(ns.idFromName("relay"));
  const call = async (wire: Wire): Promise<boolean> => {
    const res = await stub.fetch("https://relay-budget/charge", { method: "POST", body: JSON.stringify(wire) });
    return ((await res.json()) as { ok?: boolean }).ok === true;
  };
  return {
    async reserve(stroops, limit, lane) {
      try {
        return await call({ op: "reserve", stroops: stroops.toString(), limit: limit.toString(), ...(lane ? { lane } : {}) });
      } catch (e) {
        console.error("[relay] budget unreachable:", e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    async release(stroops, lane) {
      try {
        await call({ op: "release", stroops: stroops.toString(), ...(lane ? { lane } : {}) });
      } catch (e) {
        // The charge stays booked: the day ends a little early, which is the safe direction.
        console.error("[relay] could not release a charge:", e instanceof Error ? e.message : String(e));
      }
    },
  };
}
