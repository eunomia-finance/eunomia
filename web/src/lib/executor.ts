// Two things differ between the wallet path and the passkey path: who signs, and who submits.
// ContractSigner already covered the first. TxExecutor covers both, so the treasury operations
// stay indifferent to which door the user came in through.
//
// The wallet path is preserved exactly: the wallet signs each transaction and the contract
// client submits it over RPC, hash read from the same field as before.
//
// The passkey path cannot use RPC at all — a smart wallet holds no XLM, so there is nobody to
// pay the fee. It signs the assembled transaction with the passkey and hands it to the relay,
// which submits from its own channel account.
import type { xdr } from "@stellar/stellar-sdk";
import type { ContractSigner } from "./walletSigner";
import type { PasskeyWallet } from "./passkey";

/** The shape every contract-client transaction shares — enough to submit it either way.
 *  `built` is the assembled envelope the relay path reads its host function out of. */
export interface SubmittableTx {
  signAndSend: () => Promise<unknown>;
  built?: unknown;
}

export interface TxExecutor {
  /** The account that owns the treasury: a G-address for wallets, a C-address for passkeys. */
  address: string;
  kind: "wallet" | "passkey";
  /** Handed to the contract client when it is built. */
  signer: ContractSigner;
  /** Sign and submit, returning the on-chain hash when there is one. */
  submit: (tx: SubmittableTx) => Promise<{ hash?: string }>;
  /** Deploy a contract with this session as the deployer, returning its id.
   *
   *  Only the passkey path defines it. A wallet deploys the ordinary way — from its own
   *  transaction source account — and that path is left exactly as it was. */
  deployContract?: (wasmHash: string, constructorArgs: xdr.ScVal[]) => Promise<string>;
  /** Move XLM from this session's address into a contract, authorised by its own signature.
   *
   *  Only the passkey path defines it. A wallet moves its XLM the ordinary way — it can
   *  source and pay for a transaction, so nothing has to be delegated. */
  transferXlm?: (to: string, amountStroops: bigint) => Promise<void>;
  /** Invoke any contract as this session's address and return the call's result.
   *
   *  Only the passkey path defines it: a wallet drives contract clients directly. This is
   *  what carries the factory's one-signature setup for smart wallets. */
  invoke?: (op: xdr.Operation) => Promise<xdr.ScVal>;
}

/** The existing path, unchanged. */
export function makeWalletExecutor(address: string, signer: ContractSigner): TxExecutor {
  return {
    address,
    kind: "wallet",
    signer,
    submit: async (tx) => {
      const sent = await tx.signAndSend();
      const hash = (sent as { sendTransactionResponse?: { hash?: string } }).sendTransactionResponse
        ?.hash;
      return { hash };
    },
  };
}

/** The passkey path: the smart wallet signs the assembled transaction, the relay submits it. */
export function makePasskeyExecutor(
  contractId: string,
  wallet: PasskeyWallet,
  relay: (tx: SubmittableTx) => Promise<{ hash?: string }>,
  deployContract: (wasmHash: string, constructorArgs: xdr.ScVal[]) => Promise<string>,
  transferXlm: (to: string, amountStroops: bigint) => Promise<void>,
  invoke?: (op: xdr.Operation) => Promise<xdr.ScVal>,
): TxExecutor {
  return {
    address: contractId,
    kind: "passkey",
    signer: {
      // The kit signs AssembledTransactions, never raw XDR. Anything reaching for this
      // callback has routed a passkey session down the wallet path by mistake.
      signTransaction: () =>
        Promise.reject(new Error("A passkey session signs transactions, not raw XDR.")),
    },
    submit: async (tx) => relay(await wallet.sign(tx)),
    deployContract,
    transferXlm,
    ...(invoke ? { invoke } : {}),
  };
}
