import { describe, it, expect, vi } from "vitest";
import { Account, Address, Keypair, Operation, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import {
  RelaySubmitError,
  submitEnvelope,
  submitHostFunction,
  type SubmittingServer,
} from "./relaySubmit";

const PASSPHRASE = "Test SDF Network ; September 2015";
const WALLET = "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ";
const WASM = "475cfbe2ca79d7977c8e4d29438ae70b9d95a12cb2bfcd9fed4e4f7a26d798b2";
const keypair = Keypair.random();

const FUNC = Operation.createCustomContract({
  address: new Address(WALLET),
  wasmHash: Buffer.from(WASM, "hex"),
  salt: Buffer.alloc(32, 3),
  constructorArgs: [],
})
  .body()
  .invokeHostFunctionOp()
  .hostFunction();

/** A signed entry: address-bound credentials carrying a signature, the shape passkey-kit
 *  hands back. If anything replaces it, the user's signature is gone. */
function signedEntry(): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(WALLET).toScAddress(),
        nonce: xdr.Int64.fromString("777"),
        signatureExpirationLedger: 9999,
        signature: xdr.ScVal.scvSymbol("SIGNED"),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(WALLET).toScAddress(),
          functionName: "noop",
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  });
}

const sorobanData = () =>
  new xdr.SorobanTransactionData({
    ext: new xdr.SorobanTransactionDataExt(0),
    resources: new xdr.SorobanResources({
      footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
      instructions: 1000,
      diskReadBytes: 0,
      writeBytes: 0,
    }),
    resourceFee: xdr.Int64.fromString("25102"),
  });

function server(over: Partial<SubmittingServer> = {}): SubmittingServer {
  return {
    getAccount: vi.fn().mockResolvedValue({ sequenceNumber: () => "42" }),
    simulateTransaction: vi.fn().mockResolvedValue({
      transactionData: { build: () => sorobanData() },
    }),
    sendTransaction: vi.fn().mockResolvedValue({ hash: "HASH", status: "PENDING" }),
    getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
    ...over,
  };
}

const deps = (s: SubmittingServer) => ({
  server: s,
  keypair,
  networkPassphrase: PASSPHRASE,
  wait: () => Promise.resolve(),
});

describe("submitHostFunction", () => {
  it("submits the caller's signed auth entries untouched", async () => {
    // Simulation also reports auth entries, but they are freshly recorded and unsigned.
    // Taking those would silently discard the user's passkey signature.
    const s = server();
    const sent = (s.sendTransaction as ReturnType<typeof vi.fn>).mock;
    const entry = signedEntry();

    await submitHostFunction(deps(s), FUNC, [entry]);

    const tx = sent.calls[0][0] as { operations: Array<{ auth?: xdr.SorobanAuthorizationEntry[] }> };
    const submitted = tx.operations[0].auth ?? [];
    expect(submitted).toHaveLength(1);
    expect(submitted[0].toXDR("base64")).toBe(entry.toXDR("base64"));
  });

  it("counts the resource fee once, not twice", async () => {
    // rpc.assembleTransaction adds minResourceFee to the base fee and build() adds it again
    // (stellar-base >= 14.1.0), which overpays every transaction. Passing sorobanData to the
    // builder is what keeps it single-counted: inclusion fee + one padded resource fee.
    const s = server();
    await submitHostFunction(deps(s), FUNC, [signedEntry()]);

    const tx = (s.sendTransaction as ReturnType<typeof vi.fn>).mock.calls[0][0] as { fee: string };
    expect(Number(tx.fee)).toBe(100_000 + Math.floor((25102 * 130) / 100));
  });

  it("pads the quoted resource fee, because simulation prices a ledger that has moved on", async () => {
    // A deploy came back txInsufficientFee against an estimate that was correct when it was
    // made. The margin is refunded when unused — Soroban charges what execution consumed.
    const s = server();
    await submitHostFunction(deps(s), FUNC, [signedEntry()]);

    const tx = (s.sendTransaction as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      toEnvelope(): { v1(): { tx(): { ext(): { sorobanData(): { resourceFee(): unknown } } } } };
    };
    const charged = tx.toEnvelope().v1().tx().ext().sorobanData().resourceFee();
    expect(Number(String(charged))).toBeGreaterThan(25102);
  });

  it("signs with the fee account and submits under the account's own sequence", async () => {
    const s = server();
    await submitHostFunction(deps(s), FUNC, [signedEntry()]);

    const tx = (s.sendTransaction as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      signatures: unknown[];
      sequence: string;
    };
    expect(tx.signatures).toHaveLength(1);
    // Simulation and submission each build from a fresh Account, so the sequence advances once.
    expect(tx.sequence).toBe("43");
  });

  it("reports a rejected transaction rather than a hash", async () => {
    const s = server({
      sendTransaction: vi.fn().mockResolvedValue({ hash: "H", status: "ERROR", errorResult: { x: 1 } }),
    });
    await expect(submitHostFunction(deps(s), FUNC, [signedEntry()])).rejects.toBeInstanceOf(
      RelaySubmitError,
    );
  });

  it("reports a send the network would not queue rather than a pending hash", async () => {
    const s = server({
      sendTransaction: vi.fn().mockResolvedValue({ hash: "H", status: "TRY_AGAIN_LATER" }),
    });
    await expect(submitHostFunction(deps(s), FUNC, [signedEntry()])).rejects.toBeInstanceOf(
      RelaySubmitError,
    );
    expect(s.getTransaction).not.toHaveBeenCalled();
  });

  it("refuses to call an on-chain failure a success", async () => {
    // The caller shows the user a treasury on success; a FAILED ledger result must not
    // arrive looking like one.
    const s = server({ getTransaction: vi.fn().mockResolvedValue({ status: "FAILED" }) });
    await expect(submitHostFunction(deps(s), FUNC, [signedEntry()])).rejects.toThrow(/failed on chain/i);
  });

  it("surfaces a simulation error with its reason", async () => {
    const s = server({
      simulateTransaction: vi.fn().mockResolvedValue({ error: "HostError: auth invalid" }),
    });
    await expect(submitHostFunction(deps(s), FUNC, [signedEntry()])).rejects.toThrow(/auth invalid/);
  });

  it("says so when the footprint is archived instead of submitting a doomed transaction", async () => {
    const s = server({
      simulateTransaction: vi.fn().mockResolvedValue({
        restorePreamble: { transactionData: {} },
        transactionData: { build: () => sorobanData() },
      }),
    });
    await expect(submitHostFunction(deps(s), FUNC, [signedEntry()])).rejects.toThrow(/archived/i);
  });

  it("wraps an already-signed envelope in a fee bump instead of touching it", async () => {
    // passkey-kit signs the wallet deployment with its own inclusion fee, which the network
    // outbid. Re-signing would invalidate the kit's signature, so the fee is raised from the
    // outside and the inner transaction has to survive byte-for-byte.
    const s = server();
    const inner = new TransactionBuilder(new Account(keypair.publicKey(), "7"), {
      fee: "100",
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(Operation.invokeHostFunction({ func: FUNC, auth: [] }))
      .setTimeout(60)
      .build();
    inner.sign(keypair);
    const before = inner.toXDR();

    await submitEnvelope(deps(s), before);

    const sent = (s.sendTransaction as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      innerTransaction: { toXDR(): string };
      feeSource: { toString(): string };
    };
    expect(sent.innerTransaction.toXDR()).toBe(before);
    expect(sent.feeSource.toString()).toBe(keypair.publicKey());
  });

  it("stops polling as soon as the ledger has a verdict", async () => {
    const s = server();
    await submitHostFunction(deps(s), FUNC, [signedEntry()]);
    expect(s.getTransaction).toHaveBeenCalledTimes(1);
  });
});
