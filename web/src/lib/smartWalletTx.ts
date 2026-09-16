// Acting *as* a smart wallet, rather than from a transaction source account.
//
// The ordinary path — the contract client's `Client.deploy` — deploys from whatever account
// the transaction is built on, and Soroban authorises that with SOURCE_ACCOUNT credentials.
// OpenZeppelin Channels submits from its own channel account and rejects that shape outright
// ("Detached address credentials required"), which is correct: a source-account signature
// would be the relayer's, not the user's.
//
// Naming the smart wallet as the deployer moves the authorisation onto the wallet's own
// C-address. Simulation then returns ADDRESS credentials — bound to the wallet, carrying a
// nonce — which the passkey can sign and the relayer is free to submit from anywhere.
//
// Measured on testnet before this was written: a G-address deployer yields
// `sorobanCredentialsSourceAccount`, a C-address deployer yields `sorobanCredentialsAddress`.
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Operation,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

/** The one RPC capability this needs, narrowed so it unit-tests without a network. */
export interface SimulatingServer {
  simulateTransaction(tx: Transaction): Promise<{
    error?: string;
    result?: { retval?: xdr.ScVal; auth?: xdr.SorobanAuthorizationEntry[] };
  }>;
}

export interface SmartWalletDeps {
  server: SimulatingServer;
  networkPassphrase: string;
  /** Any funded classic account. Simulation has to be built on *something*, and it is never
   *  submitted from here — the relayer builds the real transaction. Authorisation rides on
   *  the wallet's address credentials, so this account has no say over the deploy. */
  simulationSource: string;
  signAuthEntry: <T>(entry: T) => Promise<T>;
  relay: (func: string, auth: string[]) => Promise<{ hash?: string }>;
}

const PREPARE_FAILED = "That treasury couldn't be prepared — try again.";

/** 32 random bytes: the salt that makes a wallet's second treasury a different contract
 *  from its first. */
function freshSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Deploy `wasmHash` with `walletAddress` as the deployer, returning the new contract id.
 *  The wallet signs; the relayer pays and submits. */
export async function deployFromSmartWallet(
  deps: SmartWalletDeps,
  walletAddress: string,
  wasmHash: string,
  constructorArgs: xdr.ScVal[],
): Promise<string> {
  const retval = await runAsSmartWallet(
    deps,
    Operation.createCustomContract({
      address: new Address(walletAddress),
      wasmHash: Buffer.from(wasmHash, "hex"),
      salt: freshSalt(),
      constructorArgs,
    }),
  );
  // The chain names the contract during simulation, so there is no second implementation of
  // the id derivation to keep in step with the host's.
  return Address.fromScVal(retval).toString();
}

/** Move XLM out of the wallet through the native SAC. The `from` argument is the wallet, so
 *  the transfer is authorised by its signature — which is what lets somebody else source and
 *  pay for the transaction without being able to redirect it. */
export async function transferFromSmartWallet(
  deps: SmartWalletDeps,
  walletAddress: string,
  sac: string,
  to: string,
  amountStroops: bigint,
): Promise<void> {
  await runAsSmartWallet(
    deps,
    new Contract(sac).call(
      "transfer",
      new Address(walletAddress).toScVal(),
      new Address(to).toScVal(),
      nativeToScVal(amountStroops, { type: "i128" }),
    ),
  );
}

/** Any contract call as the wallet — the factory's one-signature setup rides on this: the
 *  wallet authorises the root call and every sub-call under it in one signed entry. */
export async function invokeFromSmartWallet(deps: SmartWalletDeps, op: xdr.Operation): Promise<xdr.ScVal> {
  return runAsSmartWallet(deps, op);
}

/** Simulate an operation as the wallet, have the passkey sign the auth it requires, and hand
 *  the result to the relay. Returns whatever the call returned. */
async function runAsSmartWallet(
  deps: SmartWalletDeps,
  op: xdr.Operation,
): Promise<xdr.ScVal> {
  const tx = new TransactionBuilder(new Account(deps.simulationSource, "0"), {
    fee: BASE_FEE,
    networkPassphrase: deps.networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  const sim = await deps.server.simulateTransaction(tx);
  if (sim.error || !sim.result?.retval) {
    // The user-facing message stays one sentence; the reason belongs in the console, or a
    // live failure is indistinguishable from every other one.
    console.error("[smart wallet] simulation failed:", sim.error ?? sim);
    throw new Error(PREPARE_FAILED);
  }

  const signed = await Promise.all((sim.result.auth ?? []).map((e) => deps.signAuthEntry(e)));

  await deps.relay(
    op.body().invokeHostFunctionOp().hostFunction().toXDR("base64"),
    signed.map((e) => e.toXDR("base64")),
  );

  return sim.result.retval;
}
