import { describe, it, expect } from "vitest";
import {
  Address,
  Contract,
  Keypair,
  Account,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  xdr,
} from "@stellar/stellar-sdk";
import { classifyHostFunction, walletDeployFromEnvelope } from "./hostFunction";

const TREASURY = "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ";
const WASM_HASH = "475cfbe2ca79d7977c8e4d29438ae70b9d95a12cb2bfcd9fed4e4f7a26d798b2";
// Derived from a fixed seed so the test stays deterministic; only its shape matters here.
const DEPLOYER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();

/** A real `invoke_contract` host function, built the way the contract client builds one. */
function invokeXdr(contractId: string): string {
  return new Contract(contractId).call("get_state").body().invokeHostFunctionOp().hostFunction().toXDR("base64");
}

/** A real `create_contract_v2` host function for deploying from an address. */
function createXdr(wasmHex: string): string {
  return xdr.HostFunction.hostFunctionTypeCreateContractV2(
    new xdr.CreateContractArgsV2({
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: Address.fromString(DEPLOYER).toScAddress(),
          salt: Buffer.alloc(32),
        }),
      ),
      executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(wasmHex, "hex")),
      constructorArgs: [],
    }),
  ).toXDR("base64");
}

/** Uploading arbitrary wasm through our fee quota must never be allowed. */
function uploadXdr(): string {
  return xdr.HostFunction.hostFunctionTypeUploadContractWasm(Buffer.from([0, 1, 2, 3])).toXDR("base64");
}

describe("classifyHostFunction", () => {
  it("reads the contract id and the function out of an invoke, rather than trusting the caller", () => {
    expect(classifyHostFunction(invokeXdr(TREASURY))).toEqual({ kind: "invoke", contractId: TREASURY, fn: "get_state" });
  });

  it("reads the wasm hash out of a deploy", () => {
    expect(classifyHostFunction(createXdr(WASM_HASH))).toEqual({ kind: "deploy", wasmHash: WASM_HASH });
  });

  it("refuses a raw wasm upload", () => {
    expect(classifyHostFunction(uploadXdr())).toEqual({ kind: "other" });
  });

  it("refuses input that is not a host function at all", () => {
    expect(classifyHostFunction("not-base64-xdr")).toEqual({ kind: "other" });
    expect(classifyHostFunction("")).toEqual({ kind: "other" });
  });
});

// passkey-kit's createWallet hands back a fully signed deploy transaction, not a bare host
// function — the one envelope the relay sponsors, and only when it is exactly that.
const PASSPHRASE = "Public Global Stellar Network ; September 2015";
const SIGNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));

function envelopeXdr(
  ops: xdr.Operation[],
  opts: { signer?: Keypair | null; passphrase?: string } = {},
): string {
  const builder = new TransactionBuilder(new Account(DEPLOYER, "1"), {
    fee: BASE_FEE,
    networkPassphrase: opts.passphrase ?? PASSPHRASE,
  });
  for (const op of ops) builder.addOperation(op);
  const tx = builder.setTimeout(60).build();
  const signer = opts.signer === undefined ? SIGNER : opts.signer;
  if (signer) tx.sign(signer);
  return tx.toXDR();
}

const deployOp = (wasmHex = WASM_HASH, source?: string) =>
  Operation.createCustomContract({
    address: Address.fromString(DEPLOYER),
    wasmHash: Buffer.from(wasmHex, "hex"),
    salt: Buffer.alloc(32),
    constructorArgs: [],
    ...(source ? { source } : {}),
  });

describe("walletDeployFromEnvelope", () => {
  const check = (envelope: string) => walletDeployFromEnvelope(envelope, PASSPHRASE, [WASM_HASH]);

  it("pulls the deployment out of a signed wallet-deploy envelope", () => {
    const found = check(envelopeXdr([deployOp()]));
    expect(found).not.toBeNull();
    expect(classifyHostFunction(found!)).toEqual({ kind: "deploy", wasmHash: WASM_HASH });
  });

  it("matches the wallet code whatever the case it was configured in", () => {
    expect(walletDeployFromEnvelope(envelopeXdr([deployOp()]), PASSPHRASE, [WASM_HASH.toUpperCase()])).not.toBeNull();
  });

  it("refuses a contract call, however permitted its target is elsewhere", () => {
    expect(check(envelopeXdr([new Contract(TREASURY).call("get_config")]))).toBeNull();
  });

  it("refuses other code, and everything when no wallet code is named", () => {
    expect(check(envelopeXdr([deployOp("ab".repeat(32))]))).toBeNull();
    expect(walletDeployFromEnvelope(envelopeXdr([deployOp()]), PASSPHRASE, [])).toBeNull();
  });

  it("refuses an envelope its source did not sign", () => {
    expect(check(envelopeXdr([deployOp()], { signer: null }))).toBeNull();
    expect(check(envelopeXdr([deployOp()], { signer: Keypair.random() }))).toBeNull();
    // Signed, but for another network: the hash it signed is not this network's.
    expect(check(envelopeXdr([deployOp()], { passphrase: "Test SDF Network ; September 2015" }))).toBeNull();
  });

  it("refuses more than one operation, and an operation with a source of its own", () => {
    expect(check(envelopeXdr([deployOp(), Operation.bumpSequence({ bumpTo: "2" })]))).toBeNull();
    expect(check(envelopeXdr([deployOp(WASM_HASH, Keypair.random().publicKey())]))).toBeNull();
  });

  it("refuses a fee bump wrapped around somebody else's transaction", () => {
    const inner = TransactionBuilder.fromXDR(envelopeXdr([deployOp()]), PASSPHRASE);
    const bump = TransactionBuilder.buildFeeBumpTransaction(SIGNER, "200", inner as never, PASSPHRASE);
    bump.sign(SIGNER);
    expect(check(bump.toXDR())).toBeNull();
  });

  it("returns null for an envelope carrying no contract call, and for input that is not an envelope", () => {
    expect(check(envelopeXdr([Operation.bumpSequence({ bumpTo: "2" })]))).toBeNull();
    expect(check("garbage")).toBeNull();
    expect(check("")).toBeNull();
  });
});
