// The anchor speaks decimal strings ("2.0396090" USDC, "100.00" TRY); the contracts speak
// stroops. Converting through a float is how 2.0396090 becomes 2.0396089999 — so this goes
// digit by digit.

const DECIMALS = 7;

/** "2.0396090" -> 20396090n. Refuses anything that is not a plain non-negative decimal, and
 *  anything finer than a stroop — silently dropping digits would forward less than arrived. */
export function decimalToStroops(amount: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) throw new Error(`"${amount}" is not an amount.`);
  const frac = m[2] ?? "";
  if (frac.length > DECIMALS && /[1-9]/.test(frac.slice(DECIMALS))) {
    throw new Error(`"${amount}" is finer than the smallest unit.`);
  }
  return BigInt(m[1]) * 10n ** BigInt(DECIMALS) + BigInt(frac.slice(0, DECIMALS).padEnd(DECIMALS, "0"));
}

/** 20396090n -> "2.0396090". Always seven places — the form Stellar operations expect. */
export function stroopsToDecimal(stroops: bigint): string {
  if (stroops < 0n) throw new Error("Amounts are never negative.");
  const s = stroops.toString().padStart(DECIMALS + 1, "0");
  return `${s.slice(0, -DECIMALS)}.${s.slice(-DECIMALS)}`;
}
