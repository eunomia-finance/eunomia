import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





/**
 * A time-bound, spend-capped agent credential to start the treasury with (the Leash).
 */
export interface Leash {
  agent: string;
  limit: i128;
  valid_until: u64;
}


/**
 * Everything a treasury needs to be useful on the first ledger it exists in.
 */
export interface Setup {
  daily_limit: i128;
  /**
 * Amount of `token` moved from the owner into the treasury (0 = unfunded).
 */
fund: i128;
  /**
 * Start a Leash for an agent key right away: empty = none, one entry = that agent.
 * (A `Vec` rather than an `Option`: the SDK's spec cannot carry an optional struct.)
 */
leash: Array<Leash>;
  /**
 * Owner of the funds: becomes the treasury's admin AND root agent (as the app did).
 */
owner: string;
  /**
 * Payees approved from the start (may be empty).
 */
payees: Array<string>;
  per_task_limit: i128;
  /**
 * Record the treasury under the owner in the registry (cross-device recovery).
 */
register: boolean;
  /**
 * Caller-chosen; the treasury address is derived from the factory and this salt.
 */
salt: Buffer;
  /**
 * SEP-41 / SAC token the treasury holds and spends.
 */
token: string;
}

export interface Client {
  /**
   * Construct and simulate a create transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deploy a treasury and set it up — one owner signature for the whole thing.
   * 
   * Order matters for atomicity only in the sense that any refusal (an incoherent
   * policy in the constructor, an invalid Leash, an unfunded owner) aborts the entire
   * transaction: no half-configured treasury can exist.
   */
  create: ({s}: {s: Setup}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  registry: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a treasury_wasm transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  treasury_wasm: (options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {treasury_wasm, registry}: {treasury_wasm: Buffer, registry: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({treasury_wasm, registry}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAFNBIHRpbWUtYm91bmQsIHNwZW5kLWNhcHBlZCBhZ2VudCBjcmVkZW50aWFsIHRvIHN0YXJ0IHRoZSB0cmVhc3VyeSB3aXRoICh0aGUgTGVhc2gpLgAAAAAAAAAABUxlYXNoAAAAAAAAAwAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAVsaW1pdAAAAAAAAAsAAAAAAAAAC3ZhbGlkX3VudGlsAAAAAAY=",
        "AAAAAQAAAEpFdmVyeXRoaW5nIGEgdHJlYXN1cnkgbmVlZHMgdG8gYmUgdXNlZnVsIG9uIHRoZSBmaXJzdCBsZWRnZXIgaXQgZXhpc3RzIGluLgAAAAAAAAAAAAVTZXR1cAAAAAAAAAkAAAAAAAAAC2RhaWx5X2xpbWl0AAAAAAsAAABIQW1vdW50IG9mIGB0b2tlbmAgbW92ZWQgZnJvbSB0aGUgb3duZXIgaW50byB0aGUgdHJlYXN1cnkgKDAgPSB1bmZ1bmRlZCkuAAAABGZ1bmQAAAALAAAAo1N0YXJ0IGEgTGVhc2ggZm9yIGFuIGFnZW50IGtleSByaWdodCBhd2F5OiBlbXB0eSA9IG5vbmUsIG9uZSBlbnRyeSA9IHRoYXQgYWdlbnQuCihBIGBWZWNgIHJhdGhlciB0aGFuIGFuIGBPcHRpb25gOiB0aGUgU0RLJ3Mgc3BlYyBjYW5ub3QgY2FycnkgYW4gb3B0aW9uYWwgc3RydWN0LikAAAAABWxlYXNoAAAAAAAD6gAAB9AAAAAFTGVhc2gAAAAAAABRT3duZXIgb2YgdGhlIGZ1bmRzOiBiZWNvbWVzIHRoZSB0cmVhc3VyeSdzIGFkbWluIEFORCByb290IGFnZW50IChhcyB0aGUgYXBwIGRpZCkuAAAAAAAABW93bmVyAAAAAAAAEwAAAC5QYXllZXMgYXBwcm92ZWQgZnJvbSB0aGUgc3RhcnQgKG1heSBiZSBlbXB0eSkuAAAAAAAGcGF5ZWVzAAAAAAPqAAAAEwAAAAAAAAAOcGVyX3Rhc2tfbGltaXQAAAAAAAsAAABMUmVjb3JkIHRoZSB0cmVhc3VyeSB1bmRlciB0aGUgb3duZXIgaW4gdGhlIHJlZ2lzdHJ5IChjcm9zcy1kZXZpY2UgcmVjb3ZlcnkpLgAAAAhyZWdpc3RlcgAAAAEAAABOQ2FsbGVyLWNob3NlbjsgdGhlIHRyZWFzdXJ5IGFkZHJlc3MgaXMgZGVyaXZlZCBmcm9tIHRoZSBmYWN0b3J5IGFuZCB0aGlzIHNhbHQuAAAAAAAEc2FsdAAAA+4AAAAgAAAAMVNFUC00MSAvIFNBQyB0b2tlbiB0aGUgdHJlYXN1cnkgaG9sZHMgYW5kIHNwZW5kcy4AAAAAAAAFdG9rZW4AAAAAAAAT",
        "AAAAAAAAASFEZXBsb3kgYSB0cmVhc3VyeSBhbmQgc2V0IGl0IHVwIOKAlCBvbmUgb3duZXIgc2lnbmF0dXJlIGZvciB0aGUgd2hvbGUgdGhpbmcuCgpPcmRlciBtYXR0ZXJzIGZvciBhdG9taWNpdHkgb25seSBpbiB0aGUgc2Vuc2UgdGhhdCBhbnkgcmVmdXNhbCAoYW4gaW5jb2hlcmVudApwb2xpY3kgaW4gdGhlIGNvbnN0cnVjdG9yLCBhbiBpbnZhbGlkIExlYXNoLCBhbiB1bmZ1bmRlZCBvd25lcikgYWJvcnRzIHRoZSBlbnRpcmUKdHJhbnNhY3Rpb246IG5vIGhhbGYtY29uZmlndXJlZCB0cmVhc3VyeSBjYW4gZXhpc3QuAAAAAAAABmNyZWF0ZQAAAAAAAQAAAAAAAAABcwAAAAAAB9AAAAAFU2V0dXAAAAAAAAABAAAAEw==",
        "AAAAAAAAAAAAAAAIcmVnaXN0cnkAAAAAAAAAAQAAABM=",
        "AAAAAAAAAJ1QaW5zIHRoZSB0cmVhc3VyeSBjb2RlIGFuZCB0aGUgcmVnaXN0cnkuIEltbXV0YWJsZSBhZnRlciBkZXBsb3kgKG5vIHNldHRlcnMpOiBhCmZhY3RvcnkgdGhhdCBjb3VsZCBiZSByZS1wb2ludGVkIHdvdWxkIGJlIGEgd2F5IHRvIGhhbmQgdXNlcnMgZGlmZmVyZW50IGNvZGUuAAAAAAAADV9fY29uc3RydWN0b3IAAAAAAAACAAAAAAAAAA10cmVhc3VyeV93YXNtAAAAAAAD7gAAACAAAAAAAAAACHJlZ2lzdHJ5AAAAEwAAAAA=",
        "AAAAAAAAAAAAAAANdHJlYXN1cnlfd2FzbQAAAAAAAAAAAAABAAAD7gAAACA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    create: this.txFromJSON<string>,
        registry: this.txFromJSON<string>,
        treasury_wasm: this.txFromJSON<Buffer>
  }
}