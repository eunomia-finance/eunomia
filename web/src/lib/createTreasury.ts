// One signature from zero to a Leashed treasury: the factory contract deploys the
// treasury, approves the payees, starts the Leash, moves the funding and registers it,
// all under the owner's single authorisation (see contracts/treasury_factory). This is what
// replaced the five-transaction setup (deploy → register → fund → payee → Leash).
import { Address, Contract } from "@stellar/stellar-sdk";
import { Client as FactoryClient, type Setup } from "./factoryClient";
import type { TxExecutor } from "./executor";
import { TREASURY_FACTORY_ID } from "./treasuryWasm";
import { XLM_SAC, toStroops } from "./userTreasury";
import { NETWORK_PASSPHRASE, RPC_URL } from "../config";

export interface TreasurySetup {
  /** The token the treasury holds and spends. XLM when left out; the anchor's USDC for a
   *  treasury funded with TRY. Every amount below is in this token (both are 7-decimal). */
  token?: string;
  dailyXlm: number;
  perTaskXlm: number;
  /** Payees approved from the start. */
  payees: string[];
  /** An agent key the owner already holds the public half of (eunomia-mcp init). */
  leash?: { agent: string; capXlm: number; hours: number };
  /** XLM moved from the owner into the treasury in the same transaction. */
  fundXlm: number;
  /** Record it in the registry (cross-device recovery). Off for test runs. */
  register: boolean;
}

/** 32 random bytes: what makes a wallet's second treasury a different contract. */
export const freshSalt = (): Buffer => Buffer.from(crypto.getRandomValues(new Uint8Array(32)));

/** The factory's `Setup` argument, in contract units. Pure, so the mapping is testable. */
export function factorySetupArgs(owner: string, s: TreasurySetup, nowSec: number, salt: Buffer): Setup {
  return {
    owner,
    token: s.token ?? XLM_SAC,
    daily_limit: toStroops(s.dailyXlm),
    per_task_limit: toStroops(s.perTaskXlm),
    payees: s.payees,
    leash: s.leash
      ? [
          {
            agent: s.leash.agent,
            valid_until: BigInt(nowSec + Math.round(s.leash.hours * 3600)),
            limit: toStroops(s.leash.capXlm),
          },
        ]
      : [],
    fund: toStroops(s.fundXlm),
    register: s.register,
    salt,
  };
}

const readOnlyFactory = () =>
  new FactoryClient({ contractId: TREASURY_FACTORY_ID, networkPassphrase: NETWORK_PASSPHRASE, rpcUrl: RPC_URL });

/** Create and set up a treasury with ONE owner signature. Returns the treasury id.
 *
 *  A wallet sources the transaction itself (source-account auth covers the whole tree);
 *  a smart wallet invokes the factory as itself and the relay submits — same call, same
 *  single authorisation, different plumbing. */
export async function createTreasury(executor: TxExecutor, s: TreasurySetup): Promise<string> {
  const setup = factorySetupArgs(executor.address, s, Math.floor(Date.now() / 1000), freshSalt());
  if (executor.invoke) {
    const args = readOnlyFactory().spec.funcArgsToScVals("create", { s: setup });
    const retval = await executor.invoke(new Contract(TREASURY_FACTORY_ID).call("create", ...args));
    return Address.fromScVal(retval).toString();
  }
  const tx = await new FactoryClient({
    contractId: TREASURY_FACTORY_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: executor.address,
    signTransaction: executor.signer.signTransaction,
  }).create({ s: setup });
  // The treasury's address is known from simulation, so it survives either submit path.
  const treasuryId = tx.result;
  await executor.submit(tx);
  return treasuryId;
}
