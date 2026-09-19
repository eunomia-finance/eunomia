# Eunomia Roadmap

Eunomia is moving from a proven testnet product to **mainnet agent-payments infrastructure on Stellar**. Milestones are sequenced, not dated — each one unlocks the next, and each is verifiable on-chain or in the repo.

## M1 — Traction on testnet *(shipped)*

- [x] Bounded treasury live on testnet — payee whitelist + per-task & daily limits enforced on-chain
- [x] Per-user product: connect a wallet → deploy your own treasury → fund → whitelist → spend
- [x] ZK compliance layer — Circom/Groth16 proofs, hardened on-chain BN254 verifier (policy binding + replay guard)
- [x] Analytics & monitoring + in-app feedback + on-chain activity logging (proof of usage)
- [x] 10+ real user wallets with on-chain interactions (risein Journey-to-Mastery Level 4) — 18 external testers, 16 with on-chain proof, 17 tester-deployed treasuries (as of 2026-09-19)
- [x] Published user-feedback summary — [README → Testers & traction](README.md#testers--traction)

## M2 — Agent infrastructure *(shipped 2026-07-07)*

Closing the gap between "a human signs every payment" and "an agent spends autonomously, safely":

- [x] **Session-key agent signing** — time-bound, spend-capped agent credentials per user treasury (`agent ≠ admin`), instant revocation; the browser session key signs payments with zero wallet popups
- [x] **Contract lifecycle** — pause/freeze switch, agent-key rotation, admin withdraw, limit updates (the contract stays deliberately non-upgradeable; the exit is pause + withdraw)
- [x] **On-chain treasury registry** — discovery & recovery by owner wallet (no client-side-only state)
- [x] **Rolling daily-limit window** — closed the fixed-UTC-day 2× boundary spend (hourly buckets)

## M2.5 — Anyone can start, any agent can connect, money can come in *(shipped 2026-08 → 09)*

What stood between a working contract and a product a stranger can use in one sitting:

- [x] **Passkey onboarding** — Face ID / fingerprint / PIN controls a Stellar smart wallet that owns the treasury; a fail-closed relay sponsors fees, so a new user needs no wallet, no seed phrase and no XLM
- [x] **One-signature setup** — the treasury factory deploys, sets the policy, approves payees, starts the Leash, funds and registers, atomically
- [x] **`eunomia-mcp` on npm** — an MCP server + SDK: any MCP agent (Claude included) checks its budget, pays, settles x402 payment requirements and asks the owner for exceptions; refusals arrive with the contract's own error codes. The agent's key is made on its own machine; the owner signs only a cap and a deadline — in the same signature that creates the treasury, if they wish
- [x] **Fiat ramp through a SEP-6 anchor, both ways** — TRY in at a locked rate, USDC out into a USDC-denominated treasury, with no wallet prompt; and unspent USDC back out to an IBAN as TRY, with one owner signature ([`docs/ANCHOR.md`](docs/ANCHOR.md)). Runs against the testnet sandbox anchor; the integration's only inputs are a home domain and an asset code
- [x] **Proofs bound to chain state** — the ZK attestation re-reads limits, payee root and the period total from the treasury itself; a fabricated batch is rejected on-chain
- [x] **Third security review** — full scope, every finding tracked in [`SECURITY.md`](SECURITY.md)
- [x] **The dashboard reports what the rules did** — latest verdict, decision ledger, budget meter, Leash

## M3 — Mainnet

The on-ramp and the agent side exist; what mainnet needs is for them to be safe with real money.

- [ ] **Security review of what shipped since the last round** — the treasury factory, `eunomia-mcp` and the anchor leg have tests, including live runs, but no independent review yet. This gates everything below
- [ ] **A production SEP-6 anchor** in place of the sandbox — real bank rails and real KYC. The integration is a configuration change; the counterparty is the work
- [ ] **SEP-45 (or its equivalent) on the anchor's side**, so a smart wallet signs in itself and the per-treasury funding account — a device-held key today — goes away
- [ ] Mainnet **USDC** — the treasury already holds any SEP-41 token; this is the issuer and the anchor, not the contract
- [ ] **Hardened key storage** for agent session keys, and fee sponsorship for session accounts
- [ ] Multi-party **trusted-setup ceremony** for the ZK circuit (replacing the single-party dev setup)
- [ ] Mainnet deployment with conservative default policies

## M4 — Ecosystem integrations

- [ ] Production **ERC-8004 reputation** ([trionlabs/stellar-8004](https://github.com/trionlabs/stellar-8004)) — earned reputation replaces the testnet stand-in oracle, with a separate, lower cap for reputation-admitted payees (SECURITY.md, M4)
- [ ] **x402 at scale** — the bounded buyer and `eunomia-mcp`'s `pay` settle x402 requirements today; next is the service side: paying real, USDC-priced agent-facing APIs from a treasury, and a directory of them
- [ ] **The agent's refusals in the owner's ledger** — payments made through `eunomia-mcp` already appear in the decision ledger (read from the treasury's own events); refusals met in simulation leave no trace on chain, so they need their own path, beside the exception requests
- [ ] **Agent-platform skills** (OpenClaw / ClawHub) — packaged on top of `eunomia-mcp`, so agents on those platforms pick a treasury up conversationally
- [ ] ZK compliance wired into the payment flow (confidential-by-default option), composing with OpenZeppelin Confidential Tokens via `ComplianceHooks`
- [ ] More on-ramps: the same SEP-6 client against anchors in other currencies

## M5 — Growth & sustainability

- [ ] 50+ active user wallets (risein Level 5-7 targets)
- [ ] Revenue model validated with real users (candidates: fee on treasury operations, premium policy features) — decided by usage data, not assumption
- [ ] Ecosystem partnerships formalized (Stellar Türkiye, Trion Labs, anchors, agent-platform integrations)

---

**Where we are:** M1, M2 and M2.5 are shipped and live — a stranger can sign up with a passkey, create a USDC treasury and connect an agent in one signature, fund it with TRY through an anchor, and watch the contract allow and refuse the agent's payments; all on testnet, the on-ramp against a sandbox anchor. M3 is next, and it starts with a security review of the three things built since the last one. Progress is tracked in the commit history, [`CHANGELOG.md`](CHANGELOG.md) and [`DEPLOYMENT.md`](DEPLOYMENT.md).
