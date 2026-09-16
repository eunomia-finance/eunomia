// A balance read right after a funding request can still see the ledger before the
// funding landed — the dispenser answers once the transaction is accepted, not once it is
// applied — and one stale read used to leave the setup page insisting the wallet held
// 0.00 XLM (and, briefly, refusing starting funds against it). Poll until it moves.
// Pure over an injected reader and sleeper so it unit-tests without a clock.

export interface WaitOptions {
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Read the balance until it differs from `previous` (or is positive when `previous` is
 *  unknown), returning the last reading either way. */
export async function waitForBalanceChange(
  read: () => Promise<number | null>,
  previous: number | null | undefined,
  opts: WaitOptions = {},
): Promise<number | null> {
  const attempts = opts.attempts ?? 10;
  const delayMs = opts.delayMs ?? 1500;
  const sleep = opts.sleep ?? wait;
  let last: number | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await read();
    const moved = previous == null ? last != null && last > 0 : last != null && last !== previous;
    if (moved) return last;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return last;
}
