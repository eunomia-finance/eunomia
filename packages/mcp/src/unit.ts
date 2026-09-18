// What an amount is an amount OF. Every figure these tools return is a decimal string in the
// treasury's token, and until now nothing said which token that was except a contract id —
// an agent reading `"amount": "1.5"` could not tell 1.5 USDC from 1.5 XLM.
//
// The unit is read from the chain, not from a table: the token contract answers SEP-41
// `symbol()`. A Stellar asset's contract returns its code ("USDC"); the native asset's
// returns "native", which is spelled XLM everywhere a person reads it.
import { Account, BASE_FEE, Contract, TransactionBuilder, rpc, scValToNative } from "@stellar/stellar-sdk";
import { NULL_ACCOUNT } from "@stellar/stellar-sdk/contract";
import type { NetworkConfig } from "./network.js";
import { makeClient } from "./treasury.js";

export const unitFromSymbol = (symbol: unknown): string | null => {
  if (typeof symbol !== "string" || !symbol.trim()) return null;
  return symbol === "native" ? "XLM" : symbol.trim();
};

/** `symbol()` of a token contract, by simulation — no key, no fee. */
export async function readTokenUnit(net: NetworkConfig, tokenId: string, server = new rpc.Server(net.rpcUrl)): Promise<string | null> {
  const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), { fee: BASE_FEE, networkPassphrase: net.passphrase })
    .addOperation(new Contract(tokenId).call("symbol"))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) return null;
  return unitFromSymbol(scValToNative(sim.result.retval));
}

// A treasury's token is fixed in its constructor and a token's symbol does not change, so
// one successful read serves the life of the process. Failures are not remembered.
const known = new Map<string, string>();

/** The unit of a treasury's amounts, or null when it cannot be read.
 *
 *  Null on purpose rather than a throw: the unit is a label. A payment that is otherwise
 *  fine must not fail, and a budget must not go unanswered, because an RPC hiccup kept a
 *  word from being fetched — the amounts and `token` are still exact without it. */
export async function treasuryUnit(net: NetworkConfig, treasuryId: string, tokenId?: string): Promise<string | null> {
  const key = `${net.name}:${treasuryId}`;
  const hit = known.get(key);
  if (hit) return hit;
  try {
    const token = tokenId ?? (await makeClient(net, treasuryId).get_config()).result.token;
    const unit = await readTokenUnit(net, token);
    if (unit) known.set(key, unit);
    return unit;
  } catch {
    return null;
  }
}
