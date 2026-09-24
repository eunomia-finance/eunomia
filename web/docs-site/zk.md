# Confidential compliance (ZK)

A business can't publish who it pays and how much on a public ledger — but its owner,
auditor, or counterparty still needs to know the spending stayed inside the rules.
Eunomia's answer: **prove compliance, reveal nothing.**

## What is proven

A Groth16 (BN254) proof, verified **on-chain** by the Compliance Verifier contract,
attests that a closed period's agent payments (a batch of up to 16) obeyed policy:

- every payment ≤ the per-payment cap,
- the batch total ≤ the daily cap,
- every payee ∈ the treasury's published payee list (a Poseidon Merkle root),
- the batch total **equals** what the treasury actually moved in that period —

**without revealing a single amount or payee.** Payments are committed as
`Poseidon(amount, payee, salt)`; only the commitments and the proof go on-chain.
Public signals: `[dailyLimit, perTaskLimit, whitelistRoot, periodId, periodSpent, commitments[16]]`.

## Why the verifier is "hardened", not just a math check

- **Bound to chain state, not to a copy.** The verifier holds no policy of its own. For the
  treasury named in the call it re-reads the limits, the published payee root and the
  period's on-chain total, and every public signal must match them (`#4 PolicyMismatch`,
  `#9 SpendMismatch`). A proof about a self-chosen policy, or about a batch that never
  happened, cannot attest. Only that treasury's admin can submit one.
- **Periods close and only move forward.** A period must be over before it can be attested
  (`#6`), and each treasury's periods strictly advance (`#8`) — a compliant proof can't be
  replayed to mask a later period. The replay (`#8`) and the fabricated batch (`#9`) are
  both rejected live on testnet.
- **Fail-closed input validation.** Malformed proof or signal lengths and non-canonical
  field encodings trap with typed errors instead of undefined behavior.

## Honest scope

- The ZK layer attests **after the fact** today: `pay()` does not yet require a proof.
  Wiring confidential compliance into the payment flow (confidential-by-default) is
  roadmap work — see [Roadmap](/roadmap).
- If settlement moves real tokens to revealed payees, those transfers stay visible at the
  token-contract layer; transfer-level privacy is the shielded-pool track.
- The Groth16 setup is a single-party dev setup; a multi-party ceremony is a mainnet
  prerequisite.

## Composability: Eunomia as a policy for confidential tokens

Eunomia's payee gate is also packaged as an OpenZeppelin Confidential Token `Policy`
(`is_authorized(account, token) → bool`). Wired as a confidential token's compliance
policy, every *private-amount* transfer is still bounded to Eunomia-approved payees:
**the confidential token hides the amount; Eunomia bounds the payee.**

## Toolchain

Circom + snarkjs (Groth16/BN254) · Poseidon commitments · public Hermez powers-of-tau ·
on-chain verifier generated with `soroban-verifier-gen`, verified via Soroban's native
`bn254_multi_pairing_check` host functions.
