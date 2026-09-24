# Playbook — policy-bounded agent spending on Stellar

How to let an AI agent spend real money on Stellar without handing it your wallet: the
agent pays on its own, and anything outside the owner's rules is refused by a contract,
not by the agent's good manners.

This is written for builders — the patterns carry over whether you use Eunomia, an
OpenZeppelin smart account, or your own contract. Every pattern below points at the code
and the testnet transaction that shows it working. Where Eunomia sits among the other
projects doing this is in [`COMPARISON.md`](https://github.com/eunomia-finance/eunomia/blob/main/COMPARISON.md).

---

## 0 · The one rule: the contract is the gate

An agent's spending limit is only a limit if the thing that moves the money enforces it.
A check in the agent's SDK, in a middleware, or in an app backend **fails open**: a bug, a
prompt injection, a different client, or a direct call to the account skips it, and the
money still moves.

So the test for any design is one question: **if the agent — or whoever controls its key —
builds the transaction by hand, does the chain still refuse it?** If yes, the off-chain
checks are a convenience (fast feedback, no wasted fee). If no, they are the only control
you have, and they are not one.

Everything below follows from that.

---

## 1 · Choose your base

Four ways to put a contract between an agent and the money, from least to most code of
your own. They are not rivals — pick by what you need to bound.

| Base | What the chain enforces | What you write | Pick it when |
| --- | --- | --- | --- |
| **OpenZeppelin smart account + `SpendingLimit`** (via SDF's [`smart-account-kit`](https://github.com/stellar/smart-account-kit)) | One rolling total cap per (account, context rule), windowed in ledgers, on `transfer`-shaped calls | No Rust — a shared policy contract is already deployed | One total cap on the agent's own account is enough |
| **OpenZeppelin smart account + your own `Policy`** | Whatever your `Policy` checks during authorization — call allowlists, recipient allowlists, rate limits | One policy contract | You want the account model but need rules the stock policies don't have (payees, functions) |
| **A generated policy** (SCF #44 policy builders) | The minimal permission a recorded transaction needs | Review what was generated | You want per-flow least privilege rather than a budget |
| **A dedicated treasury contract** (Eunomia) | Funds held apart from the owner's wallet; payee list + per-payment cap + rolling 24h + a session cap on the agent's key; typed refusals; a ZK attestation bound to its own state | Nothing to use it; fork it to change it | The agent's budget should be separate money, and you need to prove it held without revealing payments |

Details and sources for each: [`COMPARISON.md`](https://github.com/eunomia-finance/eunomia/blob/main/COMPARISON.md).
Most of the patterns below apply to all four; 2.7 and 2.8 assume the funds sit in a contract of their own.

---

## 2 · Nine patterns

### 2.1 Rules at creation, no upgrade path

The treasury's limits are **constructor arguments** — there is no separate `initialize` a
front-runner can call first, and no upgrade entrypoint. An upgradeable treasury turns
"the rules are enforced" into "trust whoever holds the upgrade key". The exit story is
pause → withdraw → create a fresh treasury.

Validate the bounds at creation — and in the same function every later `set_limits` goes
through, so a treasury can't be walked past them afterwards. Eunomia requires
`0 < per-payment ≤ daily ≤ 16 × per-payment` (`#11 InvalidLimits`): the last bound exists
because the ZK layer attests at most 16 payments a period, so spending capacity can never
outrun what can be proven. → [`contracts/treasury/src/lib.rs`](https://github.com/eunomia-finance/eunomia/blob/main/contracts/treasury/src/lib.rs) (`MAX_BATCH`)

**One signature for the whole setup.** A factory that deploys the treasury and runs the
setup (payees, agent session, funding, registry) as sub-invocations of the one call the
owner signed turns seven approvals into one — and keeps **no authority** afterwards: no
admin, no funds, no role on what it created.
→ factory [`CAWLFTQ4…2OMS`](https://stellar.expert/explorer/testnet/contract/CAWLFTQ4V3ZPUWRVL5RGXBBA7FMJ26EXW37GGKCGKOXO4TKABEHF2OMS)

### 2.2 Order of checks inside `pay()`

```rust
spender.require_auth();          // the Leash key while a session is active, else the root agent key
require_not_paused()?;           // #9
payee_allowed(&to)?;             // #2 whitelist, or #5 reputation gate (opt-in)
amount <= per_task_limit         // #3
session.spent + amount <= cap    // #10
rolling_24h + amount <= daily    // #4
free_balance >= amount           // #6 (escrow-locked funds don't count)
// effects first: record the spend, then transfer (checks-effects-interactions)
```

Every refusal is a **typed error code**, never a string or a bare panic — that is what
makes pattern 2.5 possible. Arithmetic is overflow-checked; the accounting is written
before the token transfer, so a failed transfer rolls it back atomically.

### 2.3 A rolling window, not a calendar day

A "daily limit" that resets at midnight lets 2× the limit through across the boundary
(spend at 23:59, spend again at 00:01). Eunomia keeps **hourly buckets** and sums the last
24; the same buckets later give the ZK layer its per-period total (`period_spent`).

Mind storage TTLs: a bucket that gets archived reads as zero and makes a window look
cheaper than it was. Keep buckets alive for longer than any window that reads them.

### 2.4 The agent's key: made by the agent, bounded by the owner

The credential that works without a backend:

1. The agent generates its own keypair **on its own machine** (`eunomia-mcp init`). The
   secret never leaves it.
2. The owner signs exactly one thing: `set_session(agent_public_key, valid_until, cap)`.
3. While the session is active it is the **only** key that can pay — the treasury's
   root agent key is refused too — and it stops on its own at `valid_until`.
   `revoke_session` ends it instantly.

There is no API key, no server-side secret, nothing to leak but a capped, expiring key.
The owner never pastes a secret anywhere; the agent never holds an owner key.
→ live: [`set_session`](https://stellar.expert/explorer/testnet/tx/099dd99ddb88db95594c118d3cfcf55145119fd74ac29e596c7264ee20329206)
→ [first autonomous payment](https://stellar.expert/explorer/testnet/tx/e8d564ba222324b1633df25f259d9c7ea57f1836c07e3215b20fd66e5d7dc8ba)
· a [`revoke_session`](https://stellar.expert/explorer/testnet/tx/f2e95670cbea720f07a27e08aa9d513a959203f37f4107cfed3a1d3bb65e2286)

### 2.5 Refusals the agent can read

An agent that gets "transaction failed" learns nothing. An agent that gets
`{ code: 2, name: "PayeeNotWhitelisted" }` can ask the right person for the right thing.
Refuse at three stages, with the **same codes** at each:

| Stage | Where the code comes from | Fee spent |
| --- | --- | --- |
| `preflight` | Things the chain can't express: no credential, a Leash for another key, an expired one | none |
| `simulation` | The contract runs in simulation; parse `Error(Contract, #N)` out of the error text | none |
| `onchain` | State moved between simulation and apply; read the code back out of the failed transaction's diagnostics | one fee |

→ [`packages/mcp/src/errors.ts`](https://github.com/eunomia-finance/eunomia/blob/main/packages/mcp/src/errors.ts)
· a refusal recorded on the ledger as a failed transaction: [`24da989e…`](https://stellar.expert/explorer/testnet/tx/24da989ed9afe7739df315982c63523bec7cbe6124e5a1baf5ca7396ea9f9055)

### 2.6 Exceptions without a server

When the rules say no, the agent should be able to ask — and the owner should be able to
trust the request without trusting a server. Eunomia writes the request as a
**data entry on the agent's own Stellar account** (`manageData`, a 56-byte payload:
payee, amount, task, reason codes, time). Only the Leash key can write there, so the
owner's dashboard reads it from Horizon and trusts nothing else.

The owner answers with an ordinary on-chain change — approve the payee, raise a limit,
resume, start a bigger Leash. The request counts as **approved the moment the contract
would accept the payment**: there is no approval flag to forge, because there is no flag.
→ [`packages/mcp/src/exceptionCodec.ts`](https://github.com/eunomia-finance/eunomia/blob/main/packages/mcp/src/exceptionCodec.ts)

### 2.7 x402 goes through the same gate

Stellar's x402 uses the `exact` scheme. Treat an `accepts[]` entry from a `402 Payment
Required` response as a payment *request*, not an instruction: check the scheme, the
network and that the asset is the treasury's own, then settle it through the treasury's
`pay()` to `payTo` — under the same policy as every other payment. Paying from a
treasury instead of from the agent's account is what keeps the budget binding.
→ [`packages/mcp/src/x402.ts`](https://github.com/eunomia-finance/eunomia/blob/main/packages/mcp/src/x402.ts)
· interop with the official `@x402/stellar` client: [`packages/x402`](https://github.com/eunomia-finance/eunomia/tree/main/packages/x402)

### 2.8 Prove the rules held, without showing the payments

A business can't publish who it pays and how much — but its owner, auditor or
counterparty still needs to know the spending stayed inside the rules. For a closed
period, a Groth16/BN254 proof shows that every payment was under the cap, every payee was
on the published list, and the batch **adds up to exactly what the treasury recorded** —
amounts and payees stay sealed. It is verified on-chain through Soroban's native BN254
pairing host function.

The lesson that cost us an audit finding: **bind the proof to chain state, not to a copy
of the policy.** Our first verifier checked proofs against a policy anchored at deploy
time and never tied the proved amounts to real payments, so a prover could invent a
compliant batch and mint a valid attestation. The fix: the verifier holds no policy; it
re-reads the limits, the payee root and the period's on-chain total from the treasury,
and the circuit forces the batch to equal that total.
→ [Confidential compliance](https://eunomia.finance/docs/zk) ·
[`circuits/circuits/compliance.circom`](https://github.com/eunomia-finance/eunomia/blob/main/circuits/circuits/compliance.circom)

### 2.9 The owner's exits never lock

`pause` freezes spending; `admin_withdraw` works **even while paused**; limits update
live; the agent key rotates. Test these paths as hard as the spending path — a treasury
the owner can't get money out of is worse than an agent that overspends.

---

## 3 · Integrate with Eunomia

Everything runs on **Stellar testnet**.

| You want to… | Do this |
| --- | --- |
| See it work in 5 minutes, no setup | [Try it](https://eunomia.finance/docs/try-it) · [Türkçe](https://eunomia.finance/docs/try-it-tr) |
| Put an MCP agent (Claude, …) on a Leash | `npx -y eunomia-mcp init --treasury <C…>` → owner authorises the printed key → `claude mcp add eunomia -e EUNOMIA_TREASURY=<C…> -e EUNOMIA_NETWORK=testnet -- npx -y eunomia-mcp` — [Connect your agent](https://eunomia.finance/docs/connect-your-agent) |
| Call it from your own TypeScript agent | `import { contextFromEnv, payFromTreasury, readTreasury, computeBudget } from "eunomia-mcp"` — [SDK](https://github.com/eunomia-finance/eunomia/blob/main/packages/mcp/README.md#sdk) |
| Fund with TRY instead of crypto | [The anchor leg](https://eunomia.finance/docs/anchor) (SEP-6, testnet sandbox) |
| Gate a confidential token's transfers by the same payee rule | Eunomia Policy — an OpenZeppelin Confidential Token `Policy` (`is_authorized(account, token)`) — [`contracts/policy`](https://github.com/eunomia-finance/eunomia/tree/main/contracts/policy) |

**Deployed contracts** (testnet)

| Contract | Address |
| --- | --- |
| Treasury factory | [`CAWLFTQ4V3ZPUWRVL5RGXBBA7FMJ26EXW37GGKCGKOXO4TKABEHF2OMS`](https://stellar.expert/explorer/testnet/contract/CAWLFTQ4V3ZPUWRVL5RGXBBA7FMJ26EXW37GGKCGKOXO4TKABEHF2OMS) |
| Treasury wasm (v3.5, what the factory instantiates) | `824472060b3abec7c6c64e8985fa5d0c5a39ea277fbb67eab3125a483d059641` |
| Treasury Registry | [`CBEPVXK6BN2FZ3IYHV5KQUGROFHNBWBYHKHRZ5U3O7UWGIOPFOFE4ZE7`](https://stellar.expert/explorer/testnet/contract/CBEPVXK6BN2FZ3IYHV5KQUGROFHNBWBYHKHRZ5U3O7UWGIOPFOFE4ZE7) |
| Compliance Verifier (ZK, 16-payment batch) | [`CD3TB3F4VQF2H56IQC4KV3YLA6QRIF272W5D6PK2SWVTYPXHS4NFDYZ3`](https://stellar.expert/explorer/testnet/contract/CD3TB3F4VQF2H56IQC4KV3YLA6QRIF272W5D6PK2SWVTYPXHS4NFDYZ3) |
| Eunomia Policy (Confidential Token `Policy`) | `CBWMYGL7E663UON6ER5KQX2JZZA4UDZZD4RIFEHGXXF2HMMBRAN7BLQF` |

Error codes, older versions and every on-chain proof: [Contracts & Addresses](https://eunomia.finance/docs/contracts)
· [`DEPLOYMENT.md`](https://github.com/eunomia-finance/eunomia/blob/main/DEPLOYMENT.md).

---

## 4 · Gotchas we paid for

- **`getEvents` scans a slice, not your range.** The public RPC looks at roughly 10,000
  ledgers per call and returns a cursor even when that slice held no events. "Fewer
  events than the limit" does not mean done — page until the cursor's ledger reaches the
  tip. (A 120,960-ledger window came back as 0 events + a cursor on the first call.)
- **The public RPC keeps about 7 days of events.** Anything you rebuild from events
  (Eunomia's payee list) needs a local cache and an exact on-chain check per item
  (`is_payee`) — the list is a convenience, the check is the truth.
- **Generated bindings can hand you an empty error.** A contract `Err` came back from the
  TypeScript bindings with an empty message; the code was only in the simulation error
  text as `Error(Contract, #N)`. Parse that, and test the refusal path against the live
  network, not a mock.
- **`xdr.ContractEventBody.v0` does not exist** in the JS SDK — construct
  `new xdr.ContractEventBody(0, …)`.
- **Upgrade the SDK on purpose.** `@stellar/stellar-sdk` v17 is a breaking release; Eunomia
  pins `^16` and will move deliberately, not through a caret range.
- **An open exception request holds 0.5 XLM** of the agent account's reserve (one data
  entry) until it is closed. Close what you open.

---

## 5 · What this playbook does not cover

- **Mainnet.** Everything here is testnet. The ZK trusted setup is a single-party
  development setup; a multi-party ceremony is a mainnet prerequisite.
- **Proof before payment.** The ZK layer attests *after* a period closes; `pay()` does not
  wait for a proof.
- **Transfer-level privacy.** Payments to revealed payees stay visible at the token layer;
  hiding them is the shielded-pool / confidential-token track.
- **An audit.** The contracts have had internal reviews with findings and fixes recorded in
  [`SECURITY.md`](https://github.com/eunomia-finance/eunomia/blob/main/SECURITY.md) — not an
  independent audit.
