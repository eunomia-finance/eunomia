// Connecting an agent, as one action. An agent's key is useless until four things are true:
// its account exists on Stellar, the treasury may pay it (that is how a float reaches it), the
// treasury may pay the services it will buy from, and it holds a Leash. Each used to be its
// own page and its own copied address; the first builder session lost an hour between them.
// This module works out which of the four are still missing, so the Agent page can walk the
// owner through exactly those, in order, from one button.
//
// Nothing here widens what an owner signs: every step is a transaction the owner could
// already make by hand, shown by name before it is signed, and each is a separate signature —
// the contract has no call that does them together.
import { BASE_FEE, Horizon, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { HORIZON_URL, NETWORK_PASSPHRASE } from "../config";
import { kit } from "./walletKit";

/** What a new agent account is opened with: the 1 XLM base reserve, 0.5 XLM for the token
 *  trustline it adds itself, and fees for a long time. */
export const AGENT_START_XLM = "3";

/** What the owner's wallet should hold before the account step is offered: the amount sent,
 *  and room for the fees of the signatures that follow. */
export const OWNER_MIN_XLM = 3.5;

export interface CatalogPayee {
  label: string;
  address: string;
}

/** Where the service catalog's routes settle (the `payTo` of the ROZO MPP Router catalog on
 *  mainnet, read 2026-11-27: 441 of 448 payable routes settle to the first, the Stellar data
 *  routes to the second). An agent can pay a route only once its address is an approved
 *  payee, so connecting an agent offers to approve them. */
export const CATALOG_PAYEES: CatalogPayee[] = [
  { label: "Service catalog (ROZO MPP Router)", address: "GDK3AVW3YE6UL3J4WLNKBMP65KSY32YPUKIOC6PXW65XJ3LEG3YIDXXB" },
  { label: "Stellar data (Mercury)", address: "GC5KJLF3UOKRWWWQCRGNXP4A3CFBNUD6ZQFVSJNBA4UVNICZXPBLMHC3" },
];

export type StepKind = "account" | "payee" | "leash";
export type StepStatus = "todo" | "signing" | "done" | "failed" | "manual";

export interface SetupStep {
  id: string;
  kind: StepKind;
  /** the address a payee step approves */
  address?: string;
  label: string;
  status: StepStatus;
}

export interface SetupFacts {
  agent: string;
  accountExists: boolean;
  /** a classic wallet can open the account itself; a passkey smart wallet cannot make a
   *  classic create-account operation, so its owner sends the XLM from any wallet */
  ownerIsWallet: boolean;
  agentIsPayee: boolean;
  /** catalog addresses the owner chose to approve, with whether each already is */
  catalog: (CatalogPayee & { approved: boolean })[];
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** The steps still to do, in the order they are signed. What is already true is left out, so
 *  pressing the button again after a refused signature resumes where it stopped. */
export function planAgentSetup(f: SetupFacts): SetupStep[] {
  const steps: SetupStep[] = [];
  if (!f.accountExists) {
    steps.push(
      f.ownerIsWallet
        ? { id: "account", kind: "account", label: `Open the agent's account with ${AGENT_START_XLM} XLM from your wallet`, status: "todo" }
        : {
            id: "account",
            kind: "account",
            label: `Send about ${AGENT_START_XLM} XLM to the agent's key ${short(f.agent)} from any wallet — a passkey wallet cannot open an account`,
            status: "manual",
          },
    );
  }
  if (!f.agentIsPayee) {
    steps.push({ id: `payee:${f.agent}`, kind: "payee", address: f.agent, label: "Let the treasury hand the agent its task money", status: "todo" });
  }
  for (const c of f.catalog) {
    if (!c.approved) steps.push({ id: `payee:${c.address}`, kind: "payee", address: c.address, label: `Approve ${c.label} as a payee`, status: "todo" });
  }
  steps.push({ id: "leash", kind: "leash", label: "Start the Leash", status: "todo" });
  return steps;
}

/** Whether a classic account exists. Unknown (Horizon down) is an error, not "no": opening an
 *  account that already exists fails, and the owner would be told the wrong thing. */
export async function agentAccountExists(address: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const res = await fetchFn(`${HORIZON_URL}/accounts/${address}`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Horizon error ${res.status} — could not check the agent's account.`);
  return true;
}

/** Open the agent's account from the owner's wallet: one classic create-account operation.
 *  Resolves with the transaction hash once Horizon has it in a ledger. */
export async function createAgentAccount(owner: string, agent: string): Promise<string> {
  const server = new Horizon.Server(HORIZON_URL);
  const source = await server.loadAccount(owner);
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.createAccount({ destination: agent, startingBalance: AGENT_START_XLM }))
    .setTimeout(180)
    .build();
  const { signedTxXdr } = await kit.signTransaction(tx.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE, address: owner });
  const res = await server.submitTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE));
  return res.hash;
}

/** What a catalog address is, for a page that lists payees. */
export const catalogLabel = (address: string): string | null => CATALOG_PAYEES.find((c) => c.address === address)?.label ?? null;
