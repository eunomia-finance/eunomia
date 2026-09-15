// Filing, reading and closing an exception request on the agent account (manageData).
// The owner's dashboard reads the same entries from Horizon; the agent reads its own by
// exact key over the RPC. Closing deletes the entry (and frees its base reserve).
import { Keypair, Operation, rpc, xdr } from "@stellar/stellar-sdk";
import {
  decodeExceptionPayload,
  encodeExceptionPayload,
  exceptionEntryName,
  exceptionIdOf,
  type ExceptionPayload,
} from "./exceptionCodec.js";
import type { NetworkConfig } from "./network.js";
import { requireTreasury } from "./pay.js";
import type { ServerContext } from "./server.js";
import { agentKeypair, submitClassic, type ClassicDeps } from "./signer.js";

export function dataEntryKey(agentPublicKey: string, name: string): xdr.LedgerKey {
  return xdr.LedgerKey.data(
    new xdr.LedgerKeyData({ accountId: Keypair.fromPublicKey(agentPublicKey).xdrAccountId(), dataName: name }),
  );
}

export async function submitException(
  ctx: ServerContext,
  payload: ExceptionPayload,
  deps: ClassicDeps & { nowMs?: () => number } = {},
): Promise<{ id: string; name: string; txHash: string; ledger: number }> {
  const treasuryId = requireTreasury(ctx);
  if (!ctx.credential) throw new Error("No agent credential — run `eunomia-mcp init` first.");
  const name = exceptionEntryName(treasuryId, (deps.nowMs ?? Date.now)());
  const op = Operation.manageData({ name, value: Buffer.from(encodeExceptionPayload(payload)) });
  const res = await submitClassic(ctx.net, agentKeypair(ctx.credential), [op], deps);
  if (res.status !== "SUCCESS") throw new Error(`the request transaction failed on-chain (${res.txHash})`);
  return { id: exceptionIdOf(name), name, txHash: res.txHash, ledger: res.ledger };
}

export async function readExceptionEntry(
  net: NetworkConfig,
  agentPublicKey: string,
  name: string,
  deps: { server?: rpc.Server } = {},
): Promise<ExceptionPayload | null> {
  const server = deps.server ?? new rpc.Server(net.rpcUrl);
  const res = await server.getLedgerEntries(dataEntryKey(agentPublicKey, name));
  const entry = res.entries[0];
  if (!entry) return null;
  return decodeExceptionPayload(new Uint8Array(entry.val.data().dataValue()));
}

export async function closeException(
  ctx: ServerContext,
  name: string,
  deps: ClassicDeps = {},
): Promise<{ txHash: string; ledger: number }> {
  if (!ctx.credential) throw new Error("No agent credential — run `eunomia-mcp init` first.");
  const op = Operation.manageData({ name, value: null });
  const res = await submitClassic(ctx.net, agentKeypair(ctx.credential), [op], deps);
  if (res.status !== "SUCCESS") throw new Error(`closing the request failed on-chain (${res.txHash})`);
  return { txHash: res.txHash, ledger: res.ledger };
}
