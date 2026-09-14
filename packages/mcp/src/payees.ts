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
