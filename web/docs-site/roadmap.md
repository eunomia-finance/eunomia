# Roadmap

Eunomia is moving from a proven testnet product to **mainnet agent-payments infrastructure
on Stellar**. Milestones are sequenced, not dated — each unlocks the next, and each is
verifiable on-chain or in the repo.

## M1 — Traction on testnet *(shipped)* ✅

Bounded treasury + per-user product + ZK compliance layer live on testnet · analytics,
in-app feedback and on-chain activity logging (proof of usage) · 10+ real user wallets
with on-chain interactions · published feedback summary.

## M2 — Agent infrastructure *(shipped)* ✅

- **Leash sessions** — time-bound, spend-capped agent keys per treasury, zero-popup
  signing, instant revocation; the only spender while active.
- **Lifecycle** — pause/resume, admin withdraw, live limit updates, agent rotation
  (the contract stays deliberately non-upgradeable).
- **Treasury Registry** — on-chain discovery & recovery by owner wallet.
- **Rolling 24h window** — closed the fixed-UTC-day 2× boundary spend.

## M2.5 — Anyone can start, any agent can connect, money can come in *(shipped)* ✅

- **Passkey onboarding** — create and run a treasury with Face ID, a fingerprint or a
  device PIN: no wallet to install, no seed phrase, no XLM to find first. The passkey
  controls a Stellar smart wallet and fees are sponsored, without giving up custody.
- **One-signature setup** — the treasury factory deploys, sets the rules, approves payees,
  starts the Leash, funds and registers, atomically.
- **[`eunomia-mcp`](/connect-your-agent) on npm** — any MCP agent checks its budget, pays,
  settles x402 requirements and asks the owner for exceptions; refusals arrive with the
  contract's own error codes.
- **[Fiat ramp through a SEP-6 anchor, both ways](/anchor)** — TRY in at a locked rate, USDC
  out into the treasury, with no wallet prompt; unspent USDC back out to an IBAN as TRY,
  with one owner signature. Against the testnet sandbox anchor today.
- **Proofs bound to chain state** and a **third, full-scope security review**.

## M3 — Mainnet

A **security review of what shipped since the last round** (the factory, `eunomia-mcp`, the
anchor leg) comes first and gates the rest · a **production SEP-6 anchor** in place of the
sandbox · **SEP-45** on the anchor's side, so the per-treasury funding account goes away ·
mainnet **USDC** · hardened
key storage for agent session keys · multi-party **trusted-setup ceremony** for the ZK
circuit · mainnet deployment with conservative default policies.

## M4 — Ecosystem integrations

Production **ERC-8004 reputation** (trionlabs/stellar-8004), with a lower cap for
reputation-admitted payees · **x402 at scale** — paying real, USDC-priced agent-facing APIs
from a treasury · agent activity made through `eunomia-mcp` in the owner's decision ledger ·
agent-platform skills (OpenClaw / ClawHub) on top of `eunomia-mcp` · ZK compliance wired
into the payment flow, composing with OpenZeppelin Confidential Tokens · more on-ramps: the
same SEP-6 client against anchors in other currencies.

## M5 — Growth & sustainability

50+ active user wallets · revenue model validated with real users (decided by usage
data, not assumption) · ecosystem partnerships formalized.

---

**Where we are:** M1, M2 and M2.5 are shipped and live on testnet; M3 (mainnet path) is
next, and it starts with a security review of the three things built since the last one. Progress
is tracked in the [commit history](https://github.com/eunomia-finance/eunomia/commits/main) and
[`CHANGELOG.md`](https://github.com/eunomia-finance/eunomia/blob/main/CHANGELOG.md).
