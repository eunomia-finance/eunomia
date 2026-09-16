// Thin seam over passkey-kit. The kit is injected so this file unit-tests without WebAuthn
// or the DOM — the same pattern walletSigner.ts uses for StellarWalletsKit.
//
// Two things about the kit shape the design here:
//   - `createWallet` does not submit anything. It registers the passkey, derives the wallet
//     address and hands back a SIGNED DEPLOY TRANSACTION for us to relay.
//   - `sign` takes an AssembledTransaction, not an XDR string: it fills in the wallet's auth
//     entries in place. So the passkey path signs at the transaction level, not the callback
//     level the wallet path uses.
//
// Raw WebAuthn and kit errors never reach the user.

import { walletOnlyLimits } from "./recovery";

export interface PasskeyIdentity {
  contractId: string;
  /** Base64url credential id — what lets a later session re-attach without a ceremony. */
  keyId: string;
}

/** Answers "which wallet does this credential belong to?" when the kit's own derivation
 *  finds nothing on-chain — a recovered wallet's new key id derives the WRONG address. */
export type ResolveContractId = (keyId: string) => string | undefined;

export interface PasskeyBackend {
  createWallet(app: string, user: string): Promise<PasskeyIdentity & { signedTx: string }>;
  /** `resolve` feeds the kit's `getContractId` fallback (see ResolveContractId). With no
   *  `keyId` the authenticator asks the user to pick a passkey — that is "sign in". */
  connectWallet(keyId?: string, resolve?: ResolveContractId): Promise<PasskeyIdentity>;
  /** Whether the kit currently holds a connected wallet. A freshly built one does not. */
  connected(): boolean;
  sign<T>(tx: T): Promise<T>;
  signAuthEntry<T>(entry: T): Promise<T>;
  /** Register a bare passkey — a WebAuthn ceremony with no wallet deploy attached. */
  createKey(app: string, user: string): Promise<{ keyId: string; publicKey: Uint8Array }>;
  /** Build the add-Ed25519-signer transaction on the CONNECTED wallet and sign it
   *  with the session passkey. The caller relays the result. */
  addEd25519Signer(publicKey: string, limits: Map<string, undefined>): Promise<unknown>;
  /** Attach `wallet` without a ceremony (the fresh key id is not a signer yet, so
   *  connectWallet's ownership check would reject it), build the add-passkey
   *  transaction and sign it with the recovery secret. The caller relays the result. */
  addSecp256r1Signer(
    wallet: string,
    keyId: string,
    publicKey: Uint8Array,
    secret: string,
  ): Promise<unknown>;
}

export interface PasskeyWallet {
  /** Register a passkey. The returned deploy transaction still has to be submitted. */
  create(user: string): Promise<PasskeyIdentity & { signedTx: string }>;
  /** Resolve the wallet behind an existing passkey. Pass a known key id to skip the
   *  discovery ceremony; `resolve` finds wallets the key id does not derive. */
  connect(keyId?: string, resolve?: ResolveContractId): Promise<PasskeyIdentity>;
  /** Attach a wallet to the kit if it has none.
   *
   *  passkey-kit refuses to sign anything until a wallet is connected, and a kit built
   *  after a reload — or simply a second kit instance — starts out empty. Reconnecting by
   *  key id costs one ledger read and raises no WebAuthn prompt, so this is safe to call
   *  before every signature. */
  ensureConnected(keyId?: string): Promise<void>;
  /** Fill in the wallet's auth entries on an assembled transaction. */
  sign<T>(tx: T): Promise<T>;
  /** Sign one standalone auth entry — the shape a deploy produces, where there is no
   *  contract-client transaction to hand over. */
  signAuthEntry<T>(entry: T): Promise<T>;
  /** Register a bare passkey for recovery — no wallet deploy attached. */
  createKey(user: string): Promise<{ keyId: string; publicKey: Uint8Array }>;
  /** Add a recovery signer scoped to the wallet contract alone: it can re-key the
   *  wallet, it can never authorize a treasury call. Returns the signed transaction
   *  for the relay. */
  addRecoverySigner(publicKey: string, walletContractId: string): Promise<unknown>;
  /** Install a fresh passkey on the wallet, authorized by the recovery secret instead
   *  of the lost passkey. Returns the signed transaction for the relay. */
  addPasskeyFromRecovery(
    wallet: string,
    keyId: string,
    publicKey: Uint8Array,
    secret: string,
  ): Promise<unknown>;
  /** Connect a just-recovered wallet: the new key id plus the wallet address the
   *  recovery code carried. */
  connectRecovered(keyId: string, wallet: string): Promise<PasskeyIdentity>;
}

const CANCELLED = "Passkey prompt cancelled — try again.";
const OWNERSHIP = "We couldn't open your wallet with that passkey. Try connecting a wallet instead.";
const NOT_FOUND =
  "No treasury wallet belongs to that passkey. Pick the passkey you created here, or use 'Lost your passkey? Restore access' with your recovery code.";
const GENERIC = "Couldn't use your passkey. Try again or connect a wallet instead.";

/** The browser reports a dismissed prompt and a timeout the same way (NotAllowedError), and
 *  neither is worth showing verbatim. An ownership failure is kept separate: telling that user
 *  "cancelled" would send them round in circles. So is "no wallet for this passkey" — the
 *  sign-in case where the user picked a passkey from another site or another account.
 *
 *  Every passkey step funnels into the same few sentences, so the original error is logged
 *  with the step that raised it. Without this, a failure anywhere in the chain is indis-
 *  tinguishable from any other — which is exactly how one live failure cost a whole round. */
function humanise(step: string, e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[passkey] ${step} failed:`, e);
  if (/ownership/i.test(msg)) return new Error(OWNERSHIP);
  if (/could not resolve a wallet|wallet_not_found/i.test(msg)) return new Error(NOT_FOUND);
  if (/notallowed|aborterror|timed out|cancel/i.test(msg)) return new Error(CANCELLED);
  return new Error(GENERIC);
}

/** The kit carries the connection: `kit.wallet` is set by createWallet/connectWallet and is
 *  what sign() checks. Handing out a new kit per call therefore handed out a kit that could
 *  not sign, so the instance is shared for the life of the tab. */
let backend: Promise<PasskeyBackend> | null = null;

/** The only place that touches passkey-kit directly. If the kit's signatures shift, this
 *  function is the single thing that changes — nothing else in the app knows about it. */
export function realPasskeyBackend(): Promise<PasskeyBackend> {
  backend ??= buildPasskeyBackend();
  return backend;
}

/** Drop the shared kit — the session it was connected to is over. */
export function resetPasskeyBackend(): void {
  backend = null;
}

async function buildPasskeyBackend(): Promise<PasskeyBackend> {
  const { PasskeyKit } = await import("passkey-kit");
  const { RPC_URL, NETWORK_PASSPHRASE, WALLET_WASM_HASH, RP_ID } = await import("../config");

  const kit = new PasskeyKit({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    walletWasmHash: WALLET_WASM_HASH,
    ...(RP_ID ? { rpId: RP_ID } : {}),
  });

  return {
    createWallet: async (app, user) => {
      const { contractId, signedTx, keyIdBase64 } = await kit.createWallet(app, user);
      return { contractId, signedTx, keyId: keyIdBase64 };
    },
    connectWallet: async (keyId, resolve) => {
      // The kit derives the address from the key id and checks the chain; only when
      // nothing is there does it ask `getContractId` — our device memory of wallets.
      const { contractId, keyIdBase64 } = await kit.connectWallet(
        keyId || resolve
          ? {
              ...(keyId ? { keyId } : {}),
              ...(resolve ? { getContractId: async (k: string) => resolve(k) } : {}),
            }
          : undefined,
      );
      return { contractId, keyId: keyIdBase64 };
    },
    connected: () => !!kit.wallet,
    sign: (tx) => kit.sign(tx as never) as never,
    signAuthEntry: (entry) => kit.signAuthEntry(entry as never) as never,
    createKey: async (app, user) => {
      const { keyId, publicKey } = await kit.createKey(app, user);
      return { keyId, publicKey };
    },
    addEd25519Signer: async (publicKey, limits) => {
      const { SignerStore } = await import("passkey-kit");
      // Persistent storage: a recovery signer that silently expired would be a
      // recovery signer that does not exist on the day it is needed.
      const tx = await kit.addEd25519(publicKey, limits, SignerStore.Persistent);
      return kit.sign(tx);
    },
    addSecp256r1Signer: async (wallet, keyId, publicKey, secret) => {
      const { PasskeyClient, SignerStore, Ed25519Signer } = await import("passkey-kit");
      // No ceremony can attach this wallet — the fresh key id is not a signer yet,
      // so connectWallet's ownership check would reject exactly the session that
      // needs it. The kit's wallet field is public; hand it a client directly.
      kit.wallet = new PasskeyClient({
        contractId: wallet,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      const tx = await kit.addSecp256r1(keyId, publicKey, undefined, SignerStore.Persistent);
      return kit.sign(tx, Ed25519Signer.fromSecret(secret));
    },
  };
}

export function makePasskeyWallet(be: PasskeyBackend, app: string): PasskeyWallet {
  return {
    async create(user) {
      try {
        return await be.createWallet(app, user);
      } catch (e) {
        throw humanise("create wallet", e);
      }
    },
    async connect(keyId, resolve) {
      try {
        return await be.connectWallet(keyId, resolve);
      } catch (e) {
        throw humanise("connect wallet", e);
      }
    },
    async ensureConnected(keyId) {
      if (be.connected()) return;
      try {
        await be.connectWallet(keyId);
      } catch (e) {
        throw humanise(`reattach wallet (keyId ${keyId ? "stored" : "missing"})`, e);
      }
    },
    async sign(tx) {
      try {
        return await be.sign(tx);
      } catch (e) {
        throw humanise("sign transaction", e);
      }
    },
    async signAuthEntry(entry) {
      try {
        return await be.signAuthEntry(entry);
      } catch (e) {
        throw humanise("sign auth entry", e);
      }
    },
    async createKey(user) {
      try {
        return await be.createKey(app, user);
      } catch (e) {
        throw humanise("register recovery passkey", e);
      }
    },
    async addRecoverySigner(publicKey, walletContractId) {
      try {
        return await be.addEd25519Signer(publicKey, walletOnlyLimits(walletContractId));
      } catch (e) {
        throw humanise("add recovery signer", e);
      }
    },
    async addPasskeyFromRecovery(wallet, keyId, publicKey, secret) {
      try {
        return await be.addSecp256r1Signer(wallet, keyId, publicKey, secret);
      } catch (e) {
        throw humanise("re-key wallet from recovery", e);
      }
    },
    async connectRecovered(keyId, wallet) {
      try {
        return await be.connectWallet(keyId, () => wallet);
      } catch (e) {
        throw humanise("connect recovered wallet", e);
      }
    },
  };
}
