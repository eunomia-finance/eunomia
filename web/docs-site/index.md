---
title: What is Eunomia?
---

# Give your agent a budget — not your wallet.

Eunomia is a **bounded treasury** for autonomous agents on Stellar. You set the rules
once — a daily cap, a per-payment cap, an approved payee list — and every payment is
checked and enforced on Stellar. Anything outside the rules is blocked, automatically.

## How it works

1. **Create** a treasury — with a passkey (Face ID, fingerprint or device PIN) or with a
   Stellar wallet you already use. One signature; the rules are built into it at creation.
2. **Fund** it — with a bank transfer: TRY goes in through a SEP-6 anchor and lands in the
   treasury as USDC, with no wallet prompt. (Or hold XLM and fund it from your wallet.) The
   treasury pays from its own balance, never from your wallet.
3. **Approve payees** — payments can only go to addresses you've approved.
4. **Hand it to your agent on a Leash** — a spending cap and a time limit. Any MCP agent
   connects with one command (`npx eunomia-mcp`); it pays on its own, no popups; every
   payment is still checked against your rules, and you can revoke instantly.

Signing in with a passkey needs no wallet, no seed phrase and no XLM: the passkey
controls a Stellar smart wallet, and transaction fees are sponsored. It stays
self-custodial — the account paying the fee cannot move your funds or redirect a
payment.

When a payment breaks the rules, the network rejects it — that's the product working,
not a failure. The block is visible on-chain, so "my agent can't drain me" is something
you can verify, not something you have to trust.

## What makes it different

- **Rules are enforced on Stellar, not by promise** — no backend of ours can override them.
- **Self-custodial** — funds live in your own treasury contract. Never with us, never
  with the agent.
- **Pause, withdraw, revoke** — the owner's exits always work, even while spending is
  frozen.
- **Confidential compliance (ZK)** — spending can be *proven* in-policy without
  disclosing amounts or payees, via Groth16 proofs verified on-chain.

## Start here

- [Try it in 5 minutes](/try-it) — testnet, no real money, real contract.
- [Türkçe hızlı başlangıç](/try-it-tr)
- [Connect your agent](/connect-your-agent) — `eunomia-mcp`: one command, six tools.
- [The anchor leg](/anchor) — how TRY becomes a spendable agent budget.
- [Architecture](/architecture) — the contracts and how they fit.
- [Confidential compliance (ZK)](/zk) — prove the rules held, reveal nothing.
- [Playbook](/playbook) — how to build policy-bounded agent spending on Stellar, with or
  without Eunomia.
- [Ecosystem comparison](/comparison) — where Eunomia sits among the platform pieces, funded
  projects and 2026 hackathon work on the same problem, sourced.
- [Deployed contracts & addresses](/contracts) · [Security model](/security)
