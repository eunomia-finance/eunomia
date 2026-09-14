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




export const Errors = {
  1: {message:"InvalidAmount"},
  2: {message:"PayeeNotWhitelisted"},
  3: {message:"ExceedsTaskLimit"},
  4: {message:"ExceedsDailyLimit"},
  5: {message:"BelowReputationThreshold"},
  6: {message:"InsufficientFreeBalance"},
  7: {message:"EscrowNotFound"},
  8: {message:"DeadlineNotReached"},
  9: {message:"Paused"},
  10: {message:"ExceedsSessionLimit"},
  11: {message:"InvalidLimits"},
  12: {message:"InvalidDeadline"}
}


export interface Config {
  /**
 * Owner of the funds; the only one who can change the policy.
 */
admin: string;
  /**
 * The root agent allowed to trigger payments when no session is active.
 */
agent: string;
  /**
 * Max total spend allowed inside any rolling 24-hour window.
 */
daily_limit: i128;
  /**
 * Max spend allowed in a SINGLE payment (a per-PAYMENT cap, checked per call).
 * `TaskSpent` accumulates spend per `task_id` for attribution only — it is NOT
 * capped against this limit, so several sub-cap payments to the same task_id are
 * allowed; the real cumulative bound is the rolling 24h `daily_limit`.
 */
per_task_limit: i128;
  /**
 * SEP-41 / SAC token the treasury holds and spends (e.g. USDC).
 */
token: string;
}


/**
 * An outcome-bound payment: `amount` is reserved (locked) in the treasury for
 * `payee` against `task_id`, releasable on approval or refundable after `deadline`
 * (UNIX seconds). The funds never leave until release — refund just unlocks them.
 */
export interface Escrow {
  amount: i128;
  deadline: u64;
  payee: string;
  task_id: u64;
}

export type DataKey = {tag: "Config", values: void} | {tag: "Payee", values: readonly [string]} | {tag: "HourSpent", values: readonly [u64]} | {tag: "TaskSpent", values: readonly [u64]} | {tag: "RepRegistry", values: void} | {tag: "MinReputation", values: void} | {tag: "EscrowEntry", values: readonly [u64]} | {tag: "NextEscrowId", values: void} | {tag: "Locked", values: void} | {tag: "Session", values: void} | {tag: "Paused", values: void};


/**
 * A time-bound, spend-capped agent credential. While a session is active
 * (`now < valid_until`) it is the ONLY spender — the root agent is replaced,
 * not complemented, so authorisation stays unambiguous and auditable. When it
 * expires or is revoked, spending falls back to `Config.agent`.
 */
export interface Session {
  agent: string;
  limit: i128;
  spent: i128;
  valid_until: u64;
}

export interface Client {
  /**
   * Construct and simulate a pay transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The agent asks the treasury to pay `amount` to `to` for `task_id`.
   * The contract enforces the policy and rejects any violation on-chain.
   * Only the free (unlocked) balance is spendable — funds reserved by open
   * escrows cannot be paid out directly.
   */
  pay: ({task_id, to, amount}: {task_id: u64, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a locked transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Total funds currently reserved by open escrows (treasury balance minus this
   * is the spendable free balance).
   */
  locked: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  balance: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a is_payee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_payee: ({payee}: {payee: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a add_payee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whitelist a payee. Admin-only.
   */
  add_payee: ({payee}: {payee: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a day_spent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Spend inside the rolling 24-hour window (the "daily" allowance).
   */
  day_spent: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a is_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a set_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Rotate the root agent (the fallback spender when no session is active).
   * Admin-only — the recovery path if the root agent key is lost or leaked.
   */
  set_agent: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_config: (options?: MethodOptions) => Promise<AssembledTransaction<Config>>

  /**
   * Construct and simulate a get_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_escrow: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Escrow>>>

  /**
   * Construct and simulate a set_limits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the spending limits, effective immediately. Admin-only. If the new
   * daily limit is below what the window already holds, spending resumes once
   * the window drains — that is the intended behaviour.
   */
  set_limits: ({daily_limit, per_task_limit}: {daily_limit: i128, per_task_limit: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Freeze/unfreeze spending (pay, create_escrow, release_escrow). Admin-only.
   * Exit paths — refund_escrow, admin_withdraw, and every admin setter — keep
   * working while paused, so an incident can always be unwound.
   */
  set_paused: ({paused}: {paused: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a task_spent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cumulative spend recorded against `task_id` — an attribution ledger, not a cap.
   * (The per-call limit is `Config.per_task_limit`; the cumulative bound is the daily window.)
   */
  task_spent: ({task_id}: {task_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The stored session, if any — including an expired one (callers compare
   * `valid_until` to now; the contract itself ignores expired sessions).
   */
  get_session: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Session>>>

  /**
   * Construct and simulate a set_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Delegate spending to a session agent. Admin-only. While the session is
   * active it is the only spender (see `Session`); setting a new session
   * overwrites the old one and resets its spent counter (rotation).
   */
  set_session: ({agent, valid_until, limit}: {agent: string, valid_until: u64, limit: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a remove_payee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove a payee from the whitelist. Admin-only.
   */
  remove_payee: ({payee}: {payee: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a create_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Agent reserves `amount` for `payee` against a future-delivered task. The funds
   * stay in the treasury (locked, not transferred) until released on approval or
   * refunded after `deadline`. Subject to the same payee gate + per-task limit +
   * session cap as a direct payment; the rolling window is enforced at release.
   */
  create_escrow: ({task_id, payee, amount, deadline}: {task_id: u64, payee: string, amount: i128, deadline: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a refund_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * After the deadline, the agent reclaims an undelivered escrow — the lock is
   * released back to the treasury's free balance. No transfer, no spend recorded,
   * and the session budget is NOT restored (conservative: the cap bounds what a
   * session may commit). Deliberately works while paused (exit path).
   */
  refund_escrow: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a admin_withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner reclaims free (unlocked) funds with their own signature. Deliberately
   * exempt from pause, the payee gate, and the rolling window: those bound
   * *delegated* agent spending, and the exit path must work exactly when limits
   * are exhausted or spending is frozen. Escrow-locked funds stay locked (the
   * commitment to payees survives; refund is the escape hatch for those).
   */
  admin_withdraw: ({to, amount}: {to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a release_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin (the owner / hirer) approves delivery → release the locked funds to the
   * payee. The rolling window is enforced here, at the real moment of outflow, and
   * the spend is accounted per task exactly like a direct `pay`.
   */
  release_escrow: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a revoke_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Instantly revoke the session — spending falls back to the root agent.
   * Admin-only; deliberately works while paused (incident response).
   */
  revoke_session: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a admin_cancel_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin unilaterally cancels an open escrow — the lock returns to the free
   * balance, nothing is paid, no deadline needed. This is the incident-response
   * path: a compromised agent could otherwise tie up the whole treasury in
   * escrows it alone can refund. Deliberately works while paused (exit path);
   * the session budget is NOT restored (consistent with refund).
   */
  admin_cancel_escrow: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_reputation_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The active reputation gate, if any: `(registry, min_reputation)`.
   */
  get_reputation_policy: (options?: MethodOptions) => Promise<AssembledTransaction<Option<readonly [string, i128]>>>

  /**
   * Construct and simulate a set_reputation_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set (or update) the reputation gate. Admin-only. With `min_reputation > 0`,
   * a payee that is NOT on the whitelist can still be paid when its score from
   * `registry` is >= `min_reputation` — turning the static allowlist into an
   * earned-trust gate. Set `min_reputation = 0` to disable (whitelist-only).
   */
  set_reputation_policy: ({registry, min_reputation}: {registry: string, min_reputation: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, agent, token, daily_limit, per_task_limit}: {admin: string, agent: string, token: string, daily_limit: i128, per_task_limit: i128},
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
    return ContractClient.deploy({admin, agent, token, daily_limit, per_task_limit}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAADAAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAEAAAAAAAAAE1BheWVlTm90V2hpdGVsaXN0ZWQAAAAAAgAAAAAAAAAQRXhjZWVkc1Rhc2tMaW1pdAAAAAMAAAAAAAAAEUV4Y2VlZHNEYWlseUxpbWl0AAAAAAAABAAAAAAAAAAYQmVsb3dSZXB1dGF0aW9uVGhyZXNob2xkAAAABQAAAAAAAAAXSW5zdWZmaWNpZW50RnJlZUJhbGFuY2UAAAAABgAAAAAAAAAORXNjcm93Tm90Rm91bmQAAAAAAAcAAAAAAAAAEkRlYWRsaW5lTm90UmVhY2hlZAAAAAAACAAAAAAAAAAGUGF1c2VkAAAAAAAJAAAAAAAAABNFeGNlZWRzU2Vzc2lvbkxpbWl0AAAAAAoAAAAAAAAADUludmFsaWRMaW1pdHMAAAAAAAALAAAAAAAAAA9JbnZhbGlkRGVhZGxpbmUAAAAADA==",
        "AAAAAAAAAPVUaGUgYWdlbnQgYXNrcyB0aGUgdHJlYXN1cnkgdG8gcGF5IGBhbW91bnRgIHRvIGB0b2AgZm9yIGB0YXNrX2lkYC4KVGhlIGNvbnRyYWN0IGVuZm9yY2VzIHRoZSBwb2xpY3kgYW5kIHJlamVjdHMgYW55IHZpb2xhdGlvbiBvbi1jaGFpbi4KT25seSB0aGUgZnJlZSAodW5sb2NrZWQpIGJhbGFuY2UgaXMgc3BlbmRhYmxlIOKAlCBmdW5kcyByZXNlcnZlZCBieSBvcGVuCmVzY3Jvd3MgY2Fubm90IGJlIHBhaWQgb3V0IGRpcmVjdGx5LgAAAAAAAANwYXkAAAAAAwAAAAAAAAAHdGFza19pZAAAAAAGAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAABQAAADtPd25lciBvZiB0aGUgZnVuZHM7IHRoZSBvbmx5IG9uZSB3aG8gY2FuIGNoYW5nZSB0aGUgcG9saWN5LgAAAAAFYWRtaW4AAAAAAAATAAAARVRoZSByb290IGFnZW50IGFsbG93ZWQgdG8gdHJpZ2dlciBwYXltZW50cyB3aGVuIG5vIHNlc3Npb24gaXMgYWN0aXZlLgAAAAAAAAVhZ2VudAAAAAAAABMAAAA6TWF4IHRvdGFsIHNwZW5kIGFsbG93ZWQgaW5zaWRlIGFueSByb2xsaW5nIDI0LWhvdXIgd2luZG93LgAAAAAAC2RhaWx5X2xpbWl0AAAAAAsAAAEvTWF4IHNwZW5kIGFsbG93ZWQgaW4gYSBTSU5HTEUgcGF5bWVudCAoYSBwZXItUEFZTUVOVCBjYXAsIGNoZWNrZWQgcGVyIGNhbGwpLgpgVGFza1NwZW50YCBhY2N1bXVsYXRlcyBzcGVuZCBwZXIgYHRhc2tfaWRgIGZvciBhdHRyaWJ1dGlvbiBvbmx5IOKAlCBpdCBpcyBOT1QKY2FwcGVkIGFnYWluc3QgdGhpcyBsaW1pdCwgc28gc2V2ZXJhbCBzdWItY2FwIHBheW1lbnRzIHRvIHRoZSBzYW1lIHRhc2tfaWQgYXJlCmFsbG93ZWQ7IHRoZSByZWFsIGN1bXVsYXRpdmUgYm91bmQgaXMgdGhlIHJvbGxpbmcgMjRoIGBkYWlseV9saW1pdGAuAAAAAA5wZXJfdGFza19saW1pdAAAAAAACwAAAD1TRVAtNDEgLyBTQUMgdG9rZW4gdGhlIHRyZWFzdXJ5IGhvbGRzIGFuZCBzcGVuZHMgKGUuZy4gVVNEQykuAAAAAAAABXRva2VuAAAAAAAAEw==",
        "AAAAAQAAAO5BbiBvdXRjb21lLWJvdW5kIHBheW1lbnQ6IGBhbW91bnRgIGlzIHJlc2VydmVkIChsb2NrZWQpIGluIHRoZSB0cmVhc3VyeSBmb3IKYHBheWVlYCBhZ2FpbnN0IGB0YXNrX2lkYCwgcmVsZWFzYWJsZSBvbiBhcHByb3ZhbCBvciByZWZ1bmRhYmxlIGFmdGVyIGBkZWFkbGluZWAKKFVOSVggc2Vjb25kcykuIFRoZSBmdW5kcyBuZXZlciBsZWF2ZSB1bnRpbCByZWxlYXNlIOKAlCByZWZ1bmQganVzdCB1bmxvY2tzIHRoZW0uAAAAAAAAAAAABkVzY3JvdwAAAAAABAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAhkZWFkbGluZQAAAAYAAAAAAAAABXBheWVlAAAAAAAAEwAAAAAAAAAHdGFza19pZAAAAAAG",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACwAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAQAAAAAAAAAFUGF5ZWUAAAAAAAABAAAAEwAAAAEAAADcU3BlbmQgYnVja2V0ZWQgcGVyIGhvdXIgKGB0aW1lc3RhbXAgLyAzNjAwYCkg4oCUIHRoZSByb2xsaW5nIDI0aCB3aW5kb3cgc3Vtcwp0aGUgbGFzdCAyNCBidWNrZXRzLiBPbGQgYnVja2V0cyBhcmUgc2ltcGx5IG5ldmVyIHJlYWQgYWdhaW47IHBlcnNpc3RlbnQKbWluLVRUTCBmYXIgZXhjZWVkcyAyNGgsIHNvIGFuIGluLXdpbmRvdyBidWNrZXQgY2FuIG5ldmVyIGJlIGFyY2hpdmVkLgAAAAlIb3VyU3BlbnQAAAAAAAABAAAABgAAAAEAAAAAAAAACVRhc2tTcGVudAAAAAAAAAEAAAAGAAAAAAAAAAAAAAALUmVwUmVnaXN0cnkAAAAAAAAAAAAAAAANTWluUmVwdXRhdGlvbgAAAAAAAAEAAAAAAAAAC0VzY3Jvd0VudHJ5AAAAAAEAAAAGAAAAAAAAAAAAAAAMTmV4dEVzY3Jvd0lkAAAAAAAAAAAAAAAGTG9ja2VkAAAAAAAAAAAAAAAAAAdTZXNzaW9uAAAAAAAAAAAAAAAABlBhdXNlZAAA",
        "AAAAAQAAAR1BIHRpbWUtYm91bmQsIHNwZW5kLWNhcHBlZCBhZ2VudCBjcmVkZW50aWFsLiBXaGlsZSBhIHNlc3Npb24gaXMgYWN0aXZlCihgbm93IDwgdmFsaWRfdW50aWxgKSBpdCBpcyB0aGUgT05MWSBzcGVuZGVyIOKAlCB0aGUgcm9vdCBhZ2VudCBpcyByZXBsYWNlZCwKbm90IGNvbXBsZW1lbnRlZCwgc28gYXV0aG9yaXNhdGlvbiBzdGF5cyB1bmFtYmlndW91cyBhbmQgYXVkaXRhYmxlLiBXaGVuIGl0CmV4cGlyZXMgb3IgaXMgcmV2b2tlZCwgc3BlbmRpbmcgZmFsbHMgYmFjayB0byBgQ29uZmlnLmFnZW50YC4AAAAAAAAAAAAAB1Nlc3Npb24AAAAABAAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAVsaW1pdAAAAAAAAAsAAAAAAAAABXNwZW50AAAAAAAACwAAAAAAAAALdmFsaWRfdW50aWwAAAAABg==",
        "AAAAAAAAAGtUb3RhbCBmdW5kcyBjdXJyZW50bHkgcmVzZXJ2ZWQgYnkgb3BlbiBlc2Nyb3dzICh0cmVhc3VyeSBiYWxhbmNlIG1pbnVzIHRoaXMKaXMgdGhlIHNwZW5kYWJsZSBmcmVlIGJhbGFuY2UpLgAAAAAGbG9ja2VkAAAAAAAAAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAHYmFsYW5jZQAAAAAAAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAIaXNfcGF5ZWUAAAABAAAAAAAAAAVwYXllZQAAAAAAABMAAAABAAAAAQ==",
        "AAAAAAAAAB5XaGl0ZWxpc3QgYSBwYXllZS4gQWRtaW4tb25seS4AAAAAAAlhZGRfcGF5ZWUAAAAAAAABAAAAAAAAAAVwYXllZQAAAAAAABMAAAAA",
        "AAAAAAAAAEBTcGVuZCBpbnNpZGUgdGhlIHJvbGxpbmcgMjQtaG91ciB3aW5kb3cgKHRoZSAiZGFpbHkiIGFsbG93YW5jZSkuAAAACWRheV9zcGVudAAAAAAAAAAAAAABAAAACw==",
        "AAAAAAAAAAAAAAAJaXNfcGF1c2VkAAAAAAAAAAAAAAEAAAAB",
        "AAAAAAAAAJFSb3RhdGUgdGhlIHJvb3QgYWdlbnQgKHRoZSBmYWxsYmFjayBzcGVuZGVyIHdoZW4gbm8gc2Vzc2lvbiBpcyBhY3RpdmUpLgpBZG1pbi1vbmx5IOKAlCB0aGUgcmVjb3ZlcnkgcGF0aCBpZiB0aGUgcm9vdCBhZ2VudCBrZXkgaXMgbG9zdCBvciBsZWFrZWQuAAAAAAAACXNldF9hZ2VudAAAAAAAAAEAAAAAAAAABWFnZW50AAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAfQAAAABkNvbmZpZwAA",
        "AAAAAAAAAAAAAAAKZ2V0X2VzY3JvdwAAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAD6AAAB9AAAAAGRXNjcm93AAA=",
        "AAAAAAAAAMlVcGRhdGUgdGhlIHNwZW5kaW5nIGxpbWl0cywgZWZmZWN0aXZlIGltbWVkaWF0ZWx5LiBBZG1pbi1vbmx5LiBJZiB0aGUgbmV3CmRhaWx5IGxpbWl0IGlzIGJlbG93IHdoYXQgdGhlIHdpbmRvdyBhbHJlYWR5IGhvbGRzLCBzcGVuZGluZyByZXN1bWVzIG9uY2UKdGhlIHdpbmRvdyBkcmFpbnMg4oCUIHRoYXQgaXMgdGhlIGludGVuZGVkIGJlaGF2aW91ci4AAAAAAAAKc2V0X2xpbWl0cwAAAAAAAgAAAAAAAAALZGFpbHlfbGltaXQAAAAACwAAAAAAAAAOcGVyX3Rhc2tfbGltaXQAAAAAAAsAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAANRGcmVlemUvdW5mcmVlemUgc3BlbmRpbmcgKHBheSwgY3JlYXRlX2VzY3JvdywgcmVsZWFzZV9lc2Nyb3cpLiBBZG1pbi1vbmx5LgpFeGl0IHBhdGhzIOKAlCByZWZ1bmRfZXNjcm93LCBhZG1pbl93aXRoZHJhdywgYW5kIGV2ZXJ5IGFkbWluIHNldHRlciDigJQga2VlcAp3b3JraW5nIHdoaWxlIHBhdXNlZCwgc28gYW4gaW5jaWRlbnQgY2FuIGFsd2F5cyBiZSB1bndvdW5kLgAAAApzZXRfcGF1c2VkAAAAAAABAAAAAAAAAAZwYXVzZWQAAAAAAAEAAAAA",
        "AAAAAAAAAKxDdW11bGF0aXZlIHNwZW5kIHJlY29yZGVkIGFnYWluc3QgYHRhc2tfaWRgIOKAlCBhbiBhdHRyaWJ1dGlvbiBsZWRnZXIsIG5vdCBhIGNhcC4KKFRoZSBwZXItY2FsbCBsaW1pdCBpcyBgQ29uZmlnLnBlcl90YXNrX2xpbWl0YDsgdGhlIGN1bXVsYXRpdmUgYm91bmQgaXMgdGhlIGRhaWx5IHdpbmRvdy4pAAAACnRhc2tfc3BlbnQAAAAAAAEAAAAAAAAAB3Rhc2tfaWQAAAAABgAAAAEAAAAL",
        "AAAAAAAAAI1UaGUgc3RvcmVkIHNlc3Npb24sIGlmIGFueSDigJQgaW5jbHVkaW5nIGFuIGV4cGlyZWQgb25lIChjYWxsZXJzIGNvbXBhcmUKYHZhbGlkX3VudGlsYCB0byBub3c7IHRoZSBjb250cmFjdCBpdHNlbGYgaWdub3JlcyBleHBpcmVkIHNlc3Npb25zKS4AAAAAAAALZ2V0X3Nlc3Npb24AAAAAAAAAAAEAAAPoAAAH0AAAAAdTZXNzaW9uAA==",
        "AAAAAAAAAMtEZWxlZ2F0ZSBzcGVuZGluZyB0byBhIHNlc3Npb24gYWdlbnQuIEFkbWluLW9ubHkuIFdoaWxlIHRoZSBzZXNzaW9uIGlzCmFjdGl2ZSBpdCBpcyB0aGUgb25seSBzcGVuZGVyIChzZWUgYFNlc3Npb25gKTsgc2V0dGluZyBhIG5ldyBzZXNzaW9uCm92ZXJ3cml0ZXMgdGhlIG9sZCBvbmUgYW5kIHJlc2V0cyBpdHMgc3BlbnQgY291bnRlciAocm90YXRpb24pLgAAAAALc2V0X3Nlc3Npb24AAAAAAwAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAt2YWxpZF91bnRpbAAAAAAGAAAAAAAAAAVsaW1pdAAAAAAAAAsAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAC5SZW1vdmUgYSBwYXllZSBmcm9tIHRoZSB3aGl0ZWxpc3QuIEFkbWluLW9ubHkuAAAAAAAMcmVtb3ZlX3BheWVlAAAAAQAAAAAAAAAFcGF5ZWUAAAAAAAATAAAAAA==",
        "AAAAAAAAALdBdG9taWMgaW5pdCBhdCBkZXBsb3kgdGltZSAobm8gZnJvbnQtcnVubmFibGUgYGluaXRpYWxpemVgKS4KTGltaXRzIGFyZSB2YWxpZGF0ZWQgaGVyZSBzbyBhIHRyZWFzdXJ5IGNhbiBuZXZlciBleGlzdCB3aXRoIGEgcG9saWN5CnRoYXQgY29udHJhZGljdHMgaXRzZWxmIChlLmcuIHBlci10YXNrIGFib3ZlIGRhaWx5KS4AAAAADV9fY29uc3RydWN0b3IAAAAAAAAFAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABWFnZW50AAAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAtkYWlseV9saW1pdAAAAAALAAAAAAAAAA5wZXJfdGFza19saW1pdAAAAAAACwAAAAA=",
        "AAAAAAAAATRBZ2VudCByZXNlcnZlcyBgYW1vdW50YCBmb3IgYHBheWVlYCBhZ2FpbnN0IGEgZnV0dXJlLWRlbGl2ZXJlZCB0YXNrLiBUaGUgZnVuZHMKc3RheSBpbiB0aGUgdHJlYXN1cnkgKGxvY2tlZCwgbm90IHRyYW5zZmVycmVkKSB1bnRpbCByZWxlYXNlZCBvbiBhcHByb3ZhbCBvcgpyZWZ1bmRlZCBhZnRlciBgZGVhZGxpbmVgLiBTdWJqZWN0IHRvIHRoZSBzYW1lIHBheWVlIGdhdGUgKyBwZXItdGFzayBsaW1pdCArCnNlc3Npb24gY2FwIGFzIGEgZGlyZWN0IHBheW1lbnQ7IHRoZSByb2xsaW5nIHdpbmRvdyBpcyBlbmZvcmNlZCBhdCByZWxlYXNlLgAAAA1jcmVhdGVfZXNjcm93AAAAAAAABAAAAAAAAAAHdGFza19pZAAAAAAGAAAAAAAAAAVwYXllZQAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAIZGVhZGxpbmUAAAAGAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAAShBZnRlciB0aGUgZGVhZGxpbmUsIHRoZSBhZ2VudCByZWNsYWltcyBhbiB1bmRlbGl2ZXJlZCBlc2Nyb3cg4oCUIHRoZSBsb2NrIGlzCnJlbGVhc2VkIGJhY2sgdG8gdGhlIHRyZWFzdXJ5J3MgZnJlZSBiYWxhbmNlLiBObyB0cmFuc2Zlciwgbm8gc3BlbmQgcmVjb3JkZWQsCmFuZCB0aGUgc2Vzc2lvbiBidWRnZXQgaXMgTk9UIHJlc3RvcmVkIChjb25zZXJ2YXRpdmU6IHRoZSBjYXAgYm91bmRzIHdoYXQgYQpzZXNzaW9uIG1heSBjb21taXQpLiBEZWxpYmVyYXRlbHkgd29ya3Mgd2hpbGUgcGF1c2VkIChleGl0IHBhdGgpLgAAAA1yZWZ1bmRfZXNjcm93AAAAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAW5Pd25lciByZWNsYWltcyBmcmVlICh1bmxvY2tlZCkgZnVuZHMgd2l0aCB0aGVpciBvd24gc2lnbmF0dXJlLiBEZWxpYmVyYXRlbHkKZXhlbXB0IGZyb20gcGF1c2UsIHRoZSBwYXllZSBnYXRlLCBhbmQgdGhlIHJvbGxpbmcgd2luZG93OiB0aG9zZSBib3VuZAoqZGVsZWdhdGVkKiBhZ2VudCBzcGVuZGluZywgYW5kIHRoZSBleGl0IHBhdGggbXVzdCB3b3JrIGV4YWN0bHkgd2hlbiBsaW1pdHMKYXJlIGV4aGF1c3RlZCBvciBzcGVuZGluZyBpcyBmcm96ZW4uIEVzY3Jvdy1sb2NrZWQgZnVuZHMgc3RheSBsb2NrZWQgKHRoZQpjb21taXRtZW50IHRvIHBheWVlcyBzdXJ2aXZlczsgcmVmdW5kIGlzIHRoZSBlc2NhcGUgaGF0Y2ggZm9yIHRob3NlKS4AAAAAAA5hZG1pbl93aXRoZHJhdwAAAAAAAgAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAANtBZG1pbiAodGhlIG93bmVyIC8gaGlyZXIpIGFwcHJvdmVzIGRlbGl2ZXJ5IOKGkiByZWxlYXNlIHRoZSBsb2NrZWQgZnVuZHMgdG8gdGhlCnBheWVlLiBUaGUgcm9sbGluZyB3aW5kb3cgaXMgZW5mb3JjZWQgaGVyZSwgYXQgdGhlIHJlYWwgbW9tZW50IG9mIG91dGZsb3csIGFuZAp0aGUgc3BlbmQgaXMgYWNjb3VudGVkIHBlciB0YXNrIGV4YWN0bHkgbGlrZSBhIGRpcmVjdCBgcGF5YC4AAAAADnJlbGVhc2VfZXNjcm93AAAAAAABAAAAAAAAAAJpZAAAAAAABgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAIhJbnN0YW50bHkgcmV2b2tlIHRoZSBzZXNzaW9uIOKAlCBzcGVuZGluZyBmYWxscyBiYWNrIHRvIHRoZSByb290IGFnZW50LgpBZG1pbi1vbmx5OyBkZWxpYmVyYXRlbHkgd29ya3Mgd2hpbGUgcGF1c2VkIChpbmNpZGVudCByZXNwb25zZSkuAAAADnJldm9rZV9zZXNzaW9uAAAAAAAAAAAAAA==",
        "AAAAAAAAAWRBZG1pbiB1bmlsYXRlcmFsbHkgY2FuY2VscyBhbiBvcGVuIGVzY3JvdyDigJQgdGhlIGxvY2sgcmV0dXJucyB0byB0aGUgZnJlZQpiYWxhbmNlLCBub3RoaW5nIGlzIHBhaWQsIG5vIGRlYWRsaW5lIG5lZWRlZC4gVGhpcyBpcyB0aGUgaW5jaWRlbnQtcmVzcG9uc2UKcGF0aDogYSBjb21wcm9taXNlZCBhZ2VudCBjb3VsZCBvdGhlcndpc2UgdGllIHVwIHRoZSB3aG9sZSB0cmVhc3VyeSBpbgplc2Nyb3dzIGl0IGFsb25lIGNhbiByZWZ1bmQuIERlbGliZXJhdGVseSB3b3JrcyB3aGlsZSBwYXVzZWQgKGV4aXQgcGF0aCk7CnRoZSBzZXNzaW9uIGJ1ZGdldCBpcyBOT1QgcmVzdG9yZWQgKGNvbnNpc3RlbnQgd2l0aCByZWZ1bmQpLgAAABNhZG1pbl9jYW5jZWxfZXNjcm93AAAAAAEAAAAAAAAAAmlkAAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAEFUaGUgYWN0aXZlIHJlcHV0YXRpb24gZ2F0ZSwgaWYgYW55OiBgKHJlZ2lzdHJ5LCBtaW5fcmVwdXRhdGlvbilgLgAAAAAAABVnZXRfcmVwdXRhdGlvbl9wb2xpY3kAAAAAAAAAAAAAAQAAA+gAAAPtAAAAAgAAABMAAAAL",
        "AAAAAAAAASpTZXQgKG9yIHVwZGF0ZSkgdGhlIHJlcHV0YXRpb24gZ2F0ZS4gQWRtaW4tb25seS4gV2l0aCBgbWluX3JlcHV0YXRpb24gPiAwYCwKYSBwYXllZSB0aGF0IGlzIE5PVCBvbiB0aGUgd2hpdGVsaXN0IGNhbiBzdGlsbCBiZSBwYWlkIHdoZW4gaXRzIHNjb3JlIGZyb20KYHJlZ2lzdHJ5YCBpcyA+PSBgbWluX3JlcHV0YXRpb25gIOKAlCB0dXJuaW5nIHRoZSBzdGF0aWMgYWxsb3dsaXN0IGludG8gYW4KZWFybmVkLXRydXN0IGdhdGUuIFNldCBgbWluX3JlcHV0YXRpb24gPSAwYCB0byBkaXNhYmxlICh3aGl0ZWxpc3Qtb25seSkuAAAAAAAVc2V0X3JlcHV0YXRpb25fcG9saWN5AAAAAAAAAgAAAAAAAAAIcmVnaXN0cnkAAAATAAAAAAAAAA5taW5fcmVwdXRhdGlvbgAAAAAACwAAAAA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    pay: this.txFromJSON<Result<void>>,
        locked: this.txFromJSON<i128>,
        balance: this.txFromJSON<i128>,
        is_payee: this.txFromJSON<boolean>,
        add_payee: this.txFromJSON<null>,
        day_spent: this.txFromJSON<i128>,
        is_paused: this.txFromJSON<boolean>,
        set_agent: this.txFromJSON<null>,
        get_config: this.txFromJSON<Config>,
        get_escrow: this.txFromJSON<Option<Escrow>>,
        set_limits: this.txFromJSON<Result<void>>,
        set_paused: this.txFromJSON<null>,
        task_spent: this.txFromJSON<i128>,
        get_session: this.txFromJSON<Option<Session>>,
        set_session: this.txFromJSON<Result<void>>,
        remove_payee: this.txFromJSON<null>,
        create_escrow: this.txFromJSON<Result<u64>>,
        refund_escrow: this.txFromJSON<Result<void>>,
        admin_withdraw: this.txFromJSON<Result<void>>,
        release_escrow: this.txFromJSON<Result<void>>,
        revoke_session: this.txFromJSON<null>,
        admin_cancel_escrow: this.txFromJSON<Result<void>>,
        get_reputation_policy: this.txFromJSON<Option<readonly [string, i128]>>,
        set_reputation_policy: this.txFromJSON<null>
  }
}