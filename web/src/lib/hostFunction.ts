// What the relay is actually being asked to do, read out of the transaction itself.
//
// The proxy must not trust a caller-supplied "this call goes to contract X" claim: anyone can
// post a permitted address alongside a different payload. Decoding the host function here means
// the admission check in relayGuard sees what the chain will see.
import { Address, Keypair, TransactionBuilder, xdr } from "@stellar/stellar-sdk";

export type HostCall =
  | { kind: "invoke"; contractId: string; fn: string }
  | { kind: "deploy"; wasmHash: string }
  | { kind: "other" };

const OTHER: HostCall = { kind: "other" };

/** Decode a base64 host function into the facts the relay needs to admit or reject it.
 *  Anything we don't explicitly recognise — a raw wasm upload above all — comes back "other",
 *  which the caller rejects. */
export function classifyHostFunction(funcXdr: string): HostCall {
  let fn: xdr.HostFunction;
  try {
    fn = xdr.HostFunction.fromXDR(funcXdr, "base64");
  } catch {
    return OTHER;
  }

  switch (fn.switch().name) {
    case "hostFunctionTypeInvokeContract": {
      const call = fn.invokeContract();
      return {
        kind: "invoke",
        contractId: Address.fromScAddress(call.contractAddress()).toString(),
        fn: call.functionName().toString(),
      };
    }
    case "hostFunctionTypeCreateContractV2":
    case "hostFunctionTypeCreateContract": {
      const args = fn.switch().name === "hostFunctionTypeCreateContractV2"
        ? fn.createContractV2()
        : fn.createContract();
      const executable = args.executable();
      if (executable.switch().name !== "contractExecutableWasm") return OTHER;
      return { kind: "deploy", wasmHash: executable.wasmHash().toString("hex") };
    }
    default:
      return OTHER;
  }
}

/** The host function of a signed smart-wallet deployment, or null for anything else.
 *
 *  passkey-kit's `createWallet` returns a fully signed deploy transaction rather than a bare
 *  host function, and that is the one envelope the relay wraps in a fee bump. An envelope is
 *  not simulated here and carries no wallet to rate-limit by, so everything it could smuggle
 *  is ruled out by its shape instead (fifth review, F1 — the gate used to read only the first
 *  host function, and a caller could book a whole transaction's fee against the day with an
 *  envelope the network was never going to accept):
 *
 *    - a plain transaction, never a fee bump of somebody else's;
 *    - exactly one operation, a contract deployment, with no source of its own;
 *    - of wallet code this deployment sponsors (`walletWasm`), nothing else — not a treasury,
 *      which is created through the factory and its deposit cap;
 *    - signed by its own source account for this network, so a transaction nobody signed
 *      never reaches the fee account. */
export function walletDeployFromEnvelope(
  envelopeXdr: string,
  networkPassphrase: string,
  walletWasm: string[],
): string | null {
  try {
    const tx = TransactionBuilder.fromXDR(envelopeXdr, networkPassphrase);
    if ("innerTransaction" in tx) return null;
    if (tx.operations.length !== 1) return null;
    const op = tx.operations[0];
    if (op.type !== "invokeHostFunction" || op.source) return null;

    const func = op.func.toXDR("base64");
    const call = classifyHostFunction(func);
    if (call.kind !== "deploy") return null;
    const seen = call.wasmHash.toLowerCase();
    if (!walletWasm.some((h) => h.toLowerCase() === seen)) return null;

    // A muxed (M…) source has no key of its own to check against: refused by the throw.
    const source = Keypair.fromPublicKey(tx.source);
    const hash = tx.hash();
    if (!tx.signatures.some((s) => source.verify(hash, s.signature()))) return null;
    return func;
  } catch {
    return null;
  }
}
