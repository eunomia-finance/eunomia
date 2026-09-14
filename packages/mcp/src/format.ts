// Amount + link helpers. Every Stellar SAC (XLM, USDC) uses 7 decimals, so one
// converter serves whatever token the treasury holds.
export type NetworkName = "testnet" | "pubnet";

export const UNIT = 10_000_000n;

/** "2.5" → 25_000_000n. Extra fractional digits are truncated, never rounded up:
 *  an agent must not be able to nudge a pre-flight past a cap by a rounding step. */
export function toStroops(decimal: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!m) throw new Error(`Invalid amount "${decimal}" — use a positive decimal like 2.5`);
  const whole = BigInt(m[1]);
  const frac = (m[2] ?? "").slice(0, 7).padEnd(7, "0");
  return whole * UNIT + BigInt(frac);
}

export function fromStroops(v: bigint, maxFrac = 7): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = (abs / UNIT).toString();
  const frac = (abs % UNIT).toString().padStart(7, "0").slice(0, maxFrac).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

const EXPLORER: Record<NetworkName, string> = {
  testnet: "https://stellar.expert/explorer/testnet",
  pubnet: "https://stellar.expert/explorer/public",
};

export const txUrl = (n: NetworkName, hash: string) => `${EXPLORER[n]}/tx/${hash}`;
export const contractUrl = (n: NetworkName, id: string) => `${EXPLORER[n]}/contract/${id}`;
export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
