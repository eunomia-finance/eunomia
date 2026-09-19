---
name: eunomia-bounded-treasury
description: >
  Use when giving an AI agent a safe, non-custodial spending account on Stellar: deploying a
  bounded treasury (per-payment + rolling daily limits, payee whitelist), issuing time-bound
  spend-capped agent session keys, escrowing payments to deadlines, gating payees by on-chain
  reputation, wiring x402 payments through a contract-enforced policy, or proving that a batch of
  agent payments complied with policy via a Groth16/BN254 zero-knowledge proof verified on-chain.
  Also use when users mention agent spending limits, bounded agents, agent treasuries, autonomous
  payments with guardrails, confidential compliance, or "the wallet an AI agent can't drain" —
  even if they don't mention Eunomia by name (the project was previously called PRISM).
license: MIT
compatibility: Designed for Claude Code and compatible AI coding assistants. Building the contracts requires Rust + stellar-cli; the web client and prover run on Node.
metadata:
  author: Bekir Erdem & Seyit Ali Değirmen
  version: "0.5"
---

# Eunomia — Bounded Agent Treasury on Stellar

Eunomia (formerly PRISM) is a non-custodial Soroban treasury that lets an AI agent spend real
money while the **contract** — not the model's good intentions — enforces the policy. Every violation (unknown
payee, over-limit payment, expired session) is rejected **on-chain**. A ZK layer proves a batch of
payments complied with policy without revealing amounts or payees.

- Repo: https://github.com/eunomia-finance/eunomia · Live app (testnet): https://eunomia.finance
- Deep docs in-repo: `README.md` (product tour), `DEPLOYMENT.md` (all deployed contracts),
  `SECURITY.md` (audit findings + known limitations), `ROADMAP.md`, `docs/TRY-IT.md` (5-minute walkthrough).

## When to reach for Eunomia

1. An agent must pay for APIs/services autonomously, but its blast radius must be capped by contract.
2. You need auditable, task-attributed agent spending (`task_id` accounting, on-chain events).
3. You need to prove policy compliance to a third party **without disclosing** payment details (ZK).
4. You want x402-style pay-per-call where every payment passes a policy gate before settling.

## Live contracts (Stellar testnet)

| Contract | Address |
|---|---|
| Treasury factory (one owner signature: deploy + policy + payees + Leash + funding + registry) | `CAWLFTQ4V3ZPUWRVL5RGXBBA7FMJ26EXW37GGKCGKOXO4TKABEHF2OMS` |
| Treasury wasm v3.5 (what the factory instantiates; deploy your own from this hash) | `824472060b3abec7c6c64e8985fa5d0c5a39ea277fbb67eab3125a483d059641` |
| Treasury Registry (cross-device discovery) | `CBEPVXK6BN2FZ3IYHV5KQUGROFHNBWBYHKHRZ5U3O7UWGIOPFOFE4ZE7` |
| Compliance Verifier (ZK, multi-tenant, bound to the treasury's own state, 16-payment batch) | `CD3TB3F4VQF2H56IQC4KV3YLA6QRIF272W5D6PK2SWVTYPXHS4NFDYZ3` |
| USDC paid out by the TRY anchor (SAC of `USDC:GBBD47IF…FLA5`) — the token of a USDC treasury | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Reputation Oracle (stellar-8004 stand-in) | `CCJFIEYFNPRTJVCOGOSESYC5Z6FHHHYAH36V7QTZEDPKESY6O5TPINKY` |
| Eunomia Policy (OpenZeppelin ComplianceHooks adapter) | `CBWMYGL7E663UON6ER5KQX2JZZA4UDZZD4RIFEHGXXF2HMMBRAN7BLQF` |

The full (historical + demo) address table lives in `DEPLOYMENT.md`.

## Quickstart

**Fastest path:** open https://eunomia.finance → *Create your treasury with a passkey*
(Face ID, a fingerprint or a device PIN — no wallet, no seed phrase, and no XLM needed: the
passkey controls a Stellar smart wallet and transaction fees are sponsored) → set the limits and
*Create treasury* (one signature; it holds USDC by default) → *Add funds* with TRY through the
anchor (no wallet prompt) → approve a payee → pay, or connect an agent (below). Out-of-policy
payments are rejected by the contract, visibly. Browser wallets (Freighter, xBull, Albedo, LOBSTR,
Rabet, Hana, or WalletConnect on mobile) work the same way.

**Connect an agent — `eunomia-mcp` (npm):**

```bash
npx -y eunomia-mcp init --treasury <C…>   # on the agent's machine: makes its key, prints it + the MCP config
# owner: dashboard → Agent → paste the public key → cap + duration → Authorise agent (one signature)
claude mcp add eunomia -e EUNOMIA_TREASURY=<C…> -e EUNOMIA_NETWORK=testnet -- npx -y eunomia-mcp
```

Tools: `check_budget` (caps, Leash, free balance, the `unit` amounts are in; with `amount`, the
contract's refusal codes ahead of time) · `list_allowed_payees` · `check_payee` · `pay` (`to` +
`amount`, or an x402 payment requirement in the treasury's asset) · `request_exception` /
`check_exception` (the agent asks; the owner resolves on-chain from the dashboard). A refusal is
data, not an error: `{ paid: false, stage, reasons: [{ code, name }], nextStep }`. The dashboard
prints the `init` command with the id filled in — during setup too, because a treasury's address
is `hash(network, factory, salt)` and is known before the treasury exists. Details:
`packages/mcp/README.md`.

**CLI path — deploy your own treasury from the installed wasm (no build needed):**

```bash
stellar contract deploy \
  --wasm-hash 824472060b3abec7c6c64e8985fa5d0c5a39ea277fbb67eab3125a483d059641 \
  --source-account YOU --network testnet \
  -- --admin G_YOUR_ADDRESS --agent G_AGENT_ADDRESS \
     --token C_SEP41_OR_SAC_TOKEN \
     --daily_limit 500000000 --per_task_limit 100000000
```

`admin` owns the policy; `agent` is the only address allowed to spend (they may be the same
wallet — the live app's non-custodial default). `token` is any SEP-41/SAC contract, fixed for the
treasury's life (the live app offers the anchor's USDC or native XLM; amounts are in the token's
smallest unit, 7 decimals for both). The contract also rejects a policy whose daily limit exceeds
16 × the per-payment limit — the most one compliance proof can cover.

**Build from source (optional):** `cargo test` then `stellar contract build` in
`contracts/treasury/` — target is `wasm32v1-none`.

## Fund with TRY (SEP-6 anchor)

`web/src/lib/anchor/` turns a bank transfer into treasury balance: SEP-1 discovery → SEP-10
sign-in (the challenge is verified before it is signed) → SEP-38 firm quote → SEP-6
`deposit-exchange` → the anchor pays USDC → a token-contract transfer forwards it into the
treasury. Inputs: a home domain (`tr-mock-anchor.fly.dev`, the testnet sandbox — bank and KYC
simulated, USDC real) and an asset code. The anchor signs in and pays out **G-accounts only**,
so each treasury has a device-held funding account in between. Diagrams, constraints and
evidence: `docs/ANCHOR.md`. Run the whole claim live:
`cd web && ANCHOR_LIVE=1 npx vitest run src/lib/anchor/live.test.ts`.

## Core contract API (treasury v3.5, verified signatures)

```rust
__constructor(admin, agent, token, daily_limit, per_task_limit)  // per_task <= daily, both > 0
// Spending (agent — or active session agent — auth):
pay(task_id: u64, to: Address, amount: i128)          // whitelist OR reputation gate + limits
create_escrow(task_id, payee, amount, deadline) -> id // locks funds from free balance
release_escrow(id) / refund_escrow(id)                // deliver vs deadline-passed refund
// Policy management (admin auth):
add_payee(payee) / remove_payee(payee)
set_reputation_policy(registry, min_reputation)       // payee passes if whitelisted OR rep >= min
set_session(agent, valid_until, limit) / revoke_session()  // time-bound, spend-capped credential
set_limits(daily_limit, per_task_limit) / set_agent(agent)
set_paused(true|false) / admin_withdraw(to, amount) / admin_cancel_escrow(id)
// Views: get_config, is_payee, task_spent(task_id), day_spent, balance, locked, get_escrow(id), get_session,
//        is_paused, period_spent(period), whitelist_root   // the last two are what a ZK proof binds to
// Factory: create(Setup{owner, token, daily_limit, per_task_limit, payees, leash, fund, register, salt}) -> treasury
```

**Error codes:** 1 InvalidAmount · 2 PayeeNotWhitelisted · 3 ExceedsTaskLimit ·
4 ExceedsDailyLimit · 5 BelowReputationThreshold · 6 InsufficientFreeBalance · 7 EscrowNotFound ·
8 DeadlineNotReached · 9 Paused · 10 ExceedsSessionLimit · 11 InvalidLimits · 12 InvalidDeadline.

**Registry:** `register(owner, treasury)` / `treasuries_of(owner) -> Vec<Address>` — the app uses
it so a user's treasuries survive browser/device changes.

## Agent sessions (account-abstraction pattern)

`set_session(agent, valid_until, limit)` issues a temporary spender credential. While active
(`now < valid_until`) the session agent **replaces** the root agent as the only spender; when it
expires or `revoke_session()` fires (works even while paused — incident response), spending falls
back to `Config.agent`. The web app can generate a browser-held session key that signs payments
without wallet popups, capped by the session limit.

## x402 integration (`packages/x402`)

`gateX402(paymentRequirements, treasuryPolicy)` checks an x402 payment request against the
treasury policy off-chain; `boundedPay(...)` settles allowed requests through the real on-chain
`pay(...)` via `makeTreasurySettle` (stellar-cli wrapper — the agent key stays in the OS keychain,
never in code). Policy-violating requests are refused before any funds move.

## Confidential compliance (ZK)

Circuit: `circuits/compliance.circom` (Groth16 over **BN254**, Poseidon commitments — matches
Stellar's Protocol 25 "X-Ray" `bn254_multi_pairing_check` host function). One proof attests, for a
batch of up to 16 hidden payments in a closed period: the batch **adds up to exactly the
treasury's own `period_spent`**, every amount ≤ per-task limit, every payee ∈ the published
whitelist Merkle root — without revealing amounts or payees. The on-chain verifier is
**multi-tenant and holds no policy**: `verify(treasury, proof, public)` re-reads limits, payee
root and the period total from the treasury named in the call, accepts only that treasury's
admin, only closed and strictly advancing periods, and rejects non-canonical field encodings. It
attests after the fact (`pay()` does not wait for a proof) and proves the total, not the
breakdown — see `SECURITY.md`. Prover toolchain: `circuits/scripts/prove.ts` +
`packages/prover` (salt is CSPRNG — never sequential).

## Gotchas (non-obvious facts an agent will get wrong)

- **The daily limit is a rolling 24h window** (v3.1+), not a UTC calendar day.
- **Escrowed funds are locked:** `pay()` spends only *free* balance (`balance - locked`); a
  compromised agent cannot drain the treasury into escrows either — `admin_cancel_escrow` exists.
- **A session replaces the root agent** while active; it does not add a second spender.
- **SAC recipients that are classic G-accounts need a trustline** for the token first, or the
  transfer fails with `Error(Contract, #13)`. Contract (C-address) recipients don't.
- **Per-task limit must be ≤ daily limit** — the constructor and `set_limits` both panic/err otherwise.
- **Build target is `wasm32v1-none`** (not `wasm32-unknown-unknown`); mainnet contract size cap is 128KB.
- **Soroban `getEvents` scans ~10k ledgers per page** — paginate with the cursor to the head or a
  24h window will silently miss recent events (the app does this).
- **x402 facilitator note:** as of `@x402/*` v2.12 the OpenZeppelin Channels facilitator requires
  an `OZ_API_KEY` even on testnet. Eunomia's bundled flow settles directly through the treasury and
  does not need the facilitator.
- **Use verifier `CD3TB3F4…DYZ3`** (16-payment batch, 21 public signals). Its predecessors —
  `CCZKA3K4…D5Q` (13 signals), `CCOLX7NE…DBRH`, `CA3A7AOG…WS5B` — reject today's proofs; proofs
  are not portable between verifier generations.
- **An expired Leash is not an error code.** Its key just stops being the spender, so the call
  fails authorisation; `ExceedsSessionLimit` (#10) is only for the cap.
- **A treasury's address is `hash(network, factory, salt)`** — independent of owner and rules.
  `predictTreasuryId(salt)` in `web/src/lib/createTreasury.ts` computes it offline; that is how
  an agent's key can be made for a treasury before it exists.
- **The TRY anchor refuses contract addresses** — as SEP-10 accounts (no SEP-45) and as deposit
  destinations. In SEP-6 `deposit-exchange`, `destination_asset` is the bare code (`USDC`) and
  `source_asset` the SEP-38 id (`iso4217:TRY`); `withdraw-exchange` mirrors it. The payout IBAN
  comes from the SEP-12 customer record, not the withdraw request.
- **`eunomia-mcp` amounts are decimal strings; `unit` says of what** (read from the token's
  `symbol()`); `token` is the contract id an x402 requirement's `asset` must equal.

## Project structure

```
contracts/   treasury (v3.5) · treasury_factory · treasury_registry · compliance_verifier · reputation_oracle · policy (OZ hooks)
circuits/    compliance.circom + prove/verify scripts (Groth16/BN254, Poseidon)
packages/    mcp (eunomia-mcp: MCP server + SDK + CLI) · x402 (gate + bounded settle) · prover · generated clients
web/         React app — passkeys + wallet kit, one-signature setup, the decision ledger, Leash, lib/anchor (SEP-6 on-ramp)
```

## Resources

- Product & proof links (live txs, demo video): `README.md`
- All deployed addresses & wasm hashes: `DEPLOYMENT.md`
- Security posture & disclosure: `SECURITY.md`
- Try-it walkthrough: `docs/TRY-IT.md` (EN) · `docs/TRY-IT-TR.md` (TR)
- The TRY on-ramp (SEP-6 anchor): `docs/ANCHOR.md` · the agent package: `packages/mcp/README.md`
- What changed and when: `CHANGELOG.md` · where it is going: `ROADMAP.md`
