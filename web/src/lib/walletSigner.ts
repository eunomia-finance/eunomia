// Adapts a StellarWalletsKit-style signer to the shape the
// `@stellar/stellar-sdk/contract` Client expects (the same return shape as
// `basicNodeSigner`): `(xdr, opts?) => Promise<{ signedTxXdr, signerAddress }>`.
// Kept pure (the kit is injected) so it unit-tests without the kit's DOM-bound init.
import { isStaleSessionError, staleSessionMsg } from "./wallet-errors";

export interface KitSigner {
  signTransaction(
    xdr: string,
    opts: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }>;
}

export interface ContractSigner {
  signTransaction: (
    xdr: string,
    opts?: { networkPassphrase?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress: string }>;
}

/** Bind a connected wallet `address` to a contract-client signer driven by `kit`.
 *  `onStaleSession` fires when the wallet has dropped the session behind the kit — every
 *  action signs through here, so clearing it once puts the user back on "Connect wallet"
 *  instead of leaving them tapping buttons that silently never open a wallet. */
export function makeWalletSigner(
  kit: KitSigner,
  address: string,
  defaultPassphrase: string,
  onStaleSession?: () => void,
): ContractSigner {
  return {
    signTransaction: async (xdr, opts) => {
      try {
        const res = await kit.signTransaction(xdr, {
          networkPassphrase: opts?.networkPassphrase ?? defaultPassphrase,
          address,
        });
        return { signedTxXdr: res.signedTxXdr, signerAddress: res.signerAddress ?? address };
      } catch (e) {
        if (!isStaleSessionError(e)) throw e;
        onStaleSession?.();
        throw new Error(staleSessionMsg(), { cause: e });
      }
    },
  };
}
