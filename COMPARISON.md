# Comparison — agent spending policy on Stellar

*As of **2026-09-24**. Every row links to the page or code it is based on, opened on that
date. Projects move fast; if a row is wrong or out of date, please open an issue or a PR —
corrections are welcome and will be merged.*

This page answers "how is Eunomia different?" by placing it among the platform pieces, the
funded projects and the 2026 hackathon work that deal with the same question: **how does
an AI agent spend money on Stellar without being able to overspend?** How to build it
yourself is in [`docs/PLAYBOOK.md`](https://github.com/eunomia-finance/eunomia/blob/main/docs/PLAYBOOK.md).

## The five questions every row is checked against

| | Question | Why it matters |
| --- | --- | --- |
| **A** | Is the limit enforced **by a contract** (fails closed), or by an SDK / app / backend (fails open)? | A check the agent's own software runs is skipped by a bug, a prompt injection or a hand-built transaction. |
| **B** | Which **dimensions**: approved payees · per-payment cap · rolling window · a session cap on the agent's key? | A single total cap still lets an agent pay the wrong party. |
| **C** | How does the agent **hold its authority** — its own revocable, expiring key, or the owner's account? | Decides what leaks if the agent's machine is compromised. |
| **D** | Is there an **agent surface** — MCP, SDK, x402? | Decides whether an agent can use it at all. |
| **E** | Can compliance be **proven without revealing amounts**, and is that proof bound to what actually happened on-chain? | Businesses can't publish who they pay and how much; an unbound proof can be fabricated. |

**Eunomia**, for reference: **A** a per-owner treasury contract, non-upgradeable ·
**B** payee list (or opt-in reputation gate) + per-payment cap + rolling 24h cap + session
cap · **C** the agent makes its own key; the owner authorises its public half with a cap
and an expiry, revocable instantly · **D** `eunomia-mcp` on npm (MCP server + SDK, x402
`exact` requirements) · **E** a Groth16/BN254 proof per closed period, verified on-chain
against the treasury's own limits, payee root and recorded total. Testnet.
[Architecture](https://eunomia.finance/docs/architecture) ·
[Contracts & proofs](https://eunomia.finance/docs/contracts)

---

## 1 · The platform layer — SDF, OpenZeppelin, Nethermind

*"Doesn't Stellar already do this?"* — partly, and Eunomia is built to sit on it.

| Piece | What it gives | A–E | Eunomia's relation |
| --- | --- | --- | --- |
| **OpenZeppelin smart accounts — `SpendingLimit` policy** ([source](https://github.com/OpenZeppelin/stellar-contracts/blob/main/packages/accounts/src/policies/spending_limit.rs), release `v0.8.0-rc.3`, 2026-06-16) | One rolling cap per (smart account, context rule), windowed in **ledgers**; matches `transfer`-shaped calls. Siblings `SimpleThreshold` / `WeightedThreshold` are multisig. A shared mainnet deployment is reused across wallets ([deployments, 2026-07-09](https://github.com/stellar/smart-account-kit/blob/main/docs/deployments-protocol-27-2026-07-09.md)). | **A** ✓ contract · **B** total cap only — no payee list, no separate per-payment cap in the stock policies ([`policies/mod.rs`](https://github.com/OpenZeppelin/stellar-contracts/blob/main/packages/accounts/src/policies/mod.rs)) · **E** — | Overlaps on the cap; Eunomia adds payee bounds, per-payment + rolling caps, a funds-apart treasury and the proof. The fastest way to *a* limit with zero Rust — see the playbook's §1. |
| **`smart-account-kit`** (SDF, [npm](https://www.npmjs.com/package/smart-account-kit) 0.8.0, 2026-09-08; [repo](https://github.com/stellar/smart-account-kit)) | TypeScript SDK for OZ smart accounts: passkeys, multiple signers, typed policy clients, fee-sponsored transactions. Labelled "unaudited integration software". | Client tooling for the row above | Complements. Eunomia's passkey owners use a smart wallet the same way; the treasury is a separate contract that wallet owns. |
| **x402 and MPP on Stellar** ([Agentic Payments docs](https://developers.stellar.org/docs/build/agentic-payments), [`@stellar/mpp`](https://www.npmjs.com/package/@stellar/mpp)) | Settlement: x402 `exact` (facilitator checks payee and price match) and MPP charge / channel. SDF's own [x402 page](https://stellar.org/x402) points programmable spending controls to smart-account contracts. | **D** ✓ · **A/B** — (a fixed-price check, not a budget) | Complements. Eunomia settles an x402 requirement *through* its treasury's `pay()`, so the budget still applies. |
| **Confidential Tokens** (OpenZeppelin + Nethermind; [`compliance/mod.rs`](https://github.com/OpenZeppelin/stellar-contracts/blob/main/packages/tokens/src/confidential/compliance/mod.rs)) | Private balances and transfer amounts (Noir / UltraHonk). Marked not production-ready. Its compliance hook is `fn is_authorized(e, account, token) -> bool` — **no amount reaches the policy**. | **E** hides amounts; the policy is amount-blind by design | Complements, and Eunomia plugs in: [`contracts/policy`](https://github.com/eunomia-finance/eunomia/tree/main/contracts/policy) implements that `Policy` trait, bounding a confidential token's transfers to Eunomia-approved payees. The token hides the amount; Eunomia bounds the payee. |
| **Stellar Private Payments** (Nethermind; [SDF preview, 2026-08-24](https://stellar.org/blog/developers/developer-preview-stellar-private-payments), [repo](https://github.com/NethermindEth/stellar-private-payments)) | A shielded pool (Circom / Groth16 / BN254 — Eunomia's proof stack too). Its policy is an association-set allow/block list over *who* may use the pool. Testnet, unaudited. | **E** hides amounts and counterparties · **B** — (no budgets) | Different problem. Transfer-level privacy is SPP's job; Eunomia proves a budget held. |
| **CAP-71** (Accepted, Protocol 27; [spec](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071.md)) · **CAP-72** (Draft) | Auth delegation for custom accounts; CAP-72 would add contract signers to classic accounts. | Protocol plumbing | Infrastructure for session-key designs like the Leash; CAP-72 is not live. |

---

## 2 · Funded projects (SCF and Instawards)

| Project | Funding | What it is | A–E |
| --- | --- | --- | --- |
| **Smart Treasury (STA)** — [SCF](https://communityfund.stellar.org/submissions/recmj5cqlrqKyd1Bc), [repo](https://github.com/Smart-Treasury-Account-STA/smart-contracts) | SCF #44 Build, $127,500 | A programmable multi-signer treasury for organisations — payroll, vendor payments — with a versioned PolicyEngine (asset / recipient / amount rules) on OpenZeppelin libraries, and an optional attestation-gated release (a signed external approval). | **A** ✓ contract · **B** ✓ rich · **C** human signers (wallet approvals) · **D** — · **E** — |
| **REAPP** — [SCF](https://communityfund.stellar.org/submissions/recrWPt0QGLHnbv5Z), [site](https://www.reapprotocol.com/), [repo](https://github.com/mks044/reapp-poc) | SCF #43 Build, $70,000 | An SDK (`agent.fetch()`) + a Soroban mandate registry, speaking Google's AP2 mandate format, for x402 payments. The public repo has no commits since 2026-04-28. | **A** contract (proposed) · **D** ✓ SDK + x402 · **E** — |
| **OZ policy builders** — [Gateway.fm](https://communityfund.stellar.org/submissions/recTFz7yIm9fWFHSx) ([repo](https://github.com/gateway-fm/oz-policy-builder)) · [CredioLabs](https://communityfund.stellar.org/submissions/recUpUVSNstKqoxlm) ([repo](https://github.com/untangledfinance/oz-policy-builder)) · [Policywright](https://communityfund.stellar.org/submissions/recdYirBtCwecAipc) ([repo](https://github.com/kunaldrall29/policywright)) | SCF #44 Build — $98,000 · $125,000 · $55,000 | Record a transaction → synthesise the minimal OpenZeppelin smart-account policy that allows it → review → install. CredioLabs and Policywright expose this as MCP tools and an agent skill. | **A** ✓ (the output is an on-chain policy) · **B** per-flow least privilege · **D** ✓ MCP (two of three) · **E** — |
| **Nirium** — [repo](https://github.com/Eras256/Nirium), [SDK](https://github.com/nirium-protocol/nirium-sdk) | Two Instawards (per its README) | A broad agent treasury: x402 on **mainnet** since 2026-07-09, MPP charge, a 25-tool MCP server, batch payouts, a DeFindex treasury node. A testnet vault caps a delegated agent per execution. Its README lists the pre-signing policy check ("Compliance Sentinel") as *"Not built … fails open by design … Do not rely on this as a control."* | **A** partial (testnet vault cap) · **D** ✓ MCP + SDK + x402 · **E** — |

*Checked and not listed as funded:* **Tael Protocol** ([site](https://taelprotocol.xyz/), [repo](https://github.com/rahulsainlll/tael-protocol)) — an agent payment gateway with per-call and rolling 24h card limits; no SCF record found, and its public repo is TypeScript-only, with the limit checked in the gateway before a transaction is built (**A** app-layer, **D** ✓).

---

## 3 · The 2026 hackathon wave

The idea is clearly in the air — which validates the category and means the question is
no longer "can this be done" but "what stays live and gets used".

| Project | Event | A | B | D | E |
| --- | --- | --- | --- | --- | --- |
| **Pera** — [repo](https://github.com/feyyazcigim/pera-wallet) | Stellar Pro Hackathon, Istanbul, Sept 2026 (1st place per its repo description) | ✓ OZ `SpendingLimit` on the user's smart account, daily + weekly caps, no custom Rust | total caps | ✓ MCP | — |
| **Koul** — [repo](https://github.com/atahanyild/koul) | Stellar Pro Hackathon, Sept 2026 | ✓ custom OZ `Policy`: call allowlist, recipient allowlist, rate limit, expiry; an off-chain keeper with no decision logic | ✓ payees + rate | MCP on roadmap | — |
| **NeuroChain** — [repo](https://github.com/stellarzerolab/Neurochain-DSL-Stellar) | [Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk/report), Jun–Jul 2026 | guardrail decision attested (RISC Zero → Groth16, verified on Soroban) | approve / require-approval / block | — | ✓ hides the policy rules |
| **Kage** — [repo](https://github.com/Venkat5599/kagezks) | Real-World ZK | shielded pool + a scoped session key for agent payments | session scope | — | ✓ hides transfers |
| **Cluster** — [repo](https://github.com/Oppia-Software-Labs/cluster) | Real-World ZK | multisig treasury with confidential-token transfers | multisig | — | ✓ hides amounts |
| **StellarSpend** — [contracts](https://github.com/stellarspend/stellarspend-contracts) | self-described Real-World ZK entry | ✓ spending-policy / limits contracts for personal budgets | ✓ categories + limits | — | a Noir [circuit](https://github.com/stellarspend/stellarspend-contracts/blob/main/circuits/spending_proof/src/main.nr) proving one payment ≤ a limit; not tied to on-chain totals |
| **SpendGuard** — [buidl](https://dorahacks.io/buidl/42759) | Stellar Hacks: Agents, Apr 2026 | ✓ contract: daily cap, per-tx cap, whitelist, kill switch | ✓ | — | — |
| **AgentCard** — [buidl](https://dorahacks.io/buidl/42668) | Stellar Hacks: Agents, Apr 2026 | ✓ OZ smart account + a custom per-tx policy | per-tx | skill file | — |
| **x402-autopilot** — [repo](https://github.com/Andy00L/x402-autopilot) | Apr 2026 | ✓ Soroban policy contract | caps | ✓ Claude Code + x402 / MPP | — |
| **OrbitSafe** — [repo](https://github.com/Zhekinmaksim/OrbitSafe) | Apr 2026 | ✓ "governed wallet for AI agents" — x402, MPP, policy controls | policy | x402 | — |
| **confidential-agent-commerce** — [repo](https://github.com/theboycoder/confidential-agent-commerce) | independent, active today | app + Soroban, encrypted on-chain amounts between two agents | — | 402-gated API | ✓ hides amounts |

Winners of the Real-World ZK hackathon, for context: Wraith, AnchorShield, Umbra Wallet,
zkProofofReserve, Tukar ([official results](https://dorahacks.io/hackathon/stellar-hacks-zk/report)) —
privacy, compliance credentials and proof-of-reserves, none of them agent spending policy.

---

## 4 · Where the treasury-policy layer sits

```
  owner ──sets rules──▶ ┌──────────────────────────────┐ ◀──attests── ZK proof (per period)
                        │  treasury-policy layer        │
  agent ──pays────────▶ │  payees · caps · session key  │ ──settles──▶ SEP-41 token / x402 / MPP
                        └──────────────────────────────┘
                          on top of: Soroban auth (CAP-71), OZ smart accounts,
                          confidential tokens (amount privacy), SPP (transfer privacy)
```

What the rows show, stated narrowly:

- **Contract-enforced agent limits are becoming a commodity.** OpenZeppelin's
  `SpendingLimit` is on mainnet, SDF's kit wraps it, three SCF #44 teams generate policies,
  and at least nine hackathon projects enforce caps in contracts. Eunomia does not claim to
  be the only way to cap an agent.
- **Among the projects on this page, none combines an owner-set on-chain budget with a
  zero-knowledge attestation that the budget held and that is bound to what the chain
  recorded.** The ZK work nearby hides transfers or amounts (SPP, Confidential Tokens,
  Kage, Cluster), attests a guardrail decision (NeuroChain), or proves a single payment
  against a limit it doesn't anchor on-chain (StellarSpend). The confidential-token
  standard deliberately leaves the amount out of its policy hook — the gap Eunomia's
  policy and proof are built for.
- **An MCP surface is table stakes, not a differentiator** — Pera, Nirium, CredioLabs and
  Policywright ship one too.

## 5 · What others do better

- **Zero Rust to a working limit** — OpenZeppelin smart accounts + `SpendingLimit` (Pera).
  If one total cap on the agent's own account is enough, use that.
- **Per-flow least privilege** — the SCF #44 policy builders generate exactly the
  permission a recorded transaction needs; Eunomia ships one budget model.
- **Organisational treasury features** — Smart Treasury's multi-signer governance and
  versioned policies.
- **Production traffic** — Nirium settles x402 on mainnet today; Eunomia is testnet-only.
- **Standards alignment** — REAPP's AP2 mandate format.
- **Transfer privacy** — SPP and Confidential Tokens hide what Eunomia's settlement still
  shows at the token layer.

And what Eunomia does not do yet — it proves compliance *after* a period closes (`pay()`
does not wait for a proof), its trusted setup is single-party, and it has had internal
reviews, not an independent audit. See
[`SECURITY.md`](https://github.com/eunomia-finance/eunomia/blob/main/SECURITY.md).
