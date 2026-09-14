// Live reads against a deployed treasury. Everything here is a simulation — nothing is
// signed or submitted — so no key is needed to ask the chain what the policy is.
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { Client } from "./bindings/treasury.js";
import type { TreasurySnapshot } from "./budget.js";
import type { NetworkConfig } from "./network.js";

export function makeClient(net: NetworkConfig, contractId: string): Client {
  // No publicKey: reads simulate against the SDK's null account (the same choice the
  // dashboard makes on its passkey path). Authorisation is not involved in a read.
  return new Client({ contractId, networkPassphrase: net.passphrase, rpcUrl: net.rpcUrl });
}

/** Treasuries are immutable and older ones lack newer read surfaces: v1 has no `locked`
 *  or reputation policy, pre-M2 has no pause/session. A missing function surfaces as a
 *  failed simulation when `.result` is read, so the read itself is the thing to guard. */
async function optional<T>(p: Promise<AssembledTransaction<T>>): Promise<T | undefined> {
  try {
    return (await p).result;
  } catch {
    return undefined;
  }
}

export async function readTreasury(client: Client, contractId: string): Promise<TreasurySnapshot> {
  const [cfg, bal, day] = await Promise.all([client.get_config(), client.balance(), client.day_spent()]);
  const [locked, rep, paused, session] = await Promise.all([
    optional(client.locked()),
    optional(client.get_reputation_policy()),
    optional(client.is_paused()),
    optional(client.get_session()),
  ]);
  return {
    contractId,
    config: cfg.result,
    balance: bal.result,
    daySpent: day.result,
    locked: locked ?? 0n,
    reputationPolicy: rep ? { registry: rep[0], minReputation: rep[1] } : null,
    paused: paused ?? false,
    session: session ?? null,
    // The dashboard's rule: no session surface → pre-M2 treasury, hide agent features.
    legacy: paused === undefined,
  };
}

/** The chain's exact answer to "is this address whitelisted?". */
export async function isPayee(client: Client, payee: string): Promise<boolean> {
  return (await client.is_payee({ payee })).result;
}
