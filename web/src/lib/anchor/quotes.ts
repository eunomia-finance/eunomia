// SEP-38. Two kinds of price: an indicative one to show while the user is still typing (no
// sign-in, nothing promised), and a firm quote the anchor commits to until it expires. A
// transfer is always tied to a firm quote, so the amount the user agreed to is the amount
// that arrives.
import { FIAT_TRY, stellarAsset, type Anchor } from "./discover";
import { anchorJson } from "./http";

/** Which way the money moves: TRY in and USDC out, or the reverse. */
export type Direction = "deposit" | "withdraw";

export interface Price {
  /** Units of the sold asset per unit bought, fee included. */
  totalPrice: string;
  sellAmount: string;
  buyAmount: string;
  feeTotal: string;
  feeAsset: string;
}

export interface Quote extends Price {
  id: string;
  expiresAt: string;
}

interface RawPrice {
  total_price: string;
  sell_amount: string;
  buy_amount: string;
  fee: { total: string; asset: string };
}

const sides = (anchor: Anchor, direction: Direction) =>
  direction === "deposit"
    ? { sell_asset: FIAT_TRY, buy_asset: stellarAsset(anchor) }
    : { sell_asset: stellarAsset(anchor), buy_asset: FIAT_TRY };

const toPrice = (p: RawPrice): Price => ({
  totalPrice: p.total_price,
  sellAmount: p.sell_amount,
  buyAmount: p.buy_amount,
  feeTotal: p.fee.total,
  feeAsset: p.fee.asset,
});

/** What `sellAmount` would buy right now. Not a commitment — use it for the live preview. */
export async function indicativePrice(
  anchor: Anchor,
  direction: Direction,
  sellAmount: string,
  fetchFn: typeof fetch = fetch,
): Promise<Price> {
  const raw = await anchorJson<RawPrice>(
    `${anchor.quote}/price`,
    { query: { ...sides(anchor, direction), sell_amount: sellAmount, context: "sep6" } },
    fetchFn,
  );
  return toPrice(raw);
}

/** A rate the anchor holds until `expiresAt`. Its id goes into the SEP-6 transfer. */
export async function firmQuote(
  anchor: Anchor,
  token: string,
  direction: Direction,
  sellAmount: string,
  fetchFn: typeof fetch = fetch,
): Promise<Quote> {
  const raw = await anchorJson<RawPrice & { id: string; expires_at: string }>(
    `${anchor.quote}/quote`,
    {
      method: "POST",
      token,
      body: { ...sides(anchor, direction), sell_amount: sellAmount, context: "sep6" },
    },
    fetchFn,
  );
  return { ...toPrice(raw), id: raw.id, expiresAt: raw.expires_at };
}
