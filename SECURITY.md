# Security

Eunomia is **testnet-only** today. Do not use it with real funds. The path to mainnet is
security-gated — see [`ROADMAP.md`](ROADMAP.md) (M2/M3) for what must land first.

> Eunomia was called PRISM until the 2026-08 rebrand; older entries below keep the
> original name where they describe work done under it.

## Security model

- **Non-custodial.** Funds live in the owner's own Soroban contract. Eunomia code cannot move
  value outside the on-chain policy (payee whitelist / reputation gate · per-payment limit ·
  rolling 24h limit). Policy violations are rejected **by the contract**, on-chain. The daily
  limit bounds what the agent **commits** as well as what it settles: escrow reservations are
  charged to the same window (2026-08-05 audit, M3).
- **Checks-effects-interactions.** Accounting is written before the token transfer; a failed
  or re-entrant transfer reverts the whole call atomically. Soroban additionally forbids
  host-level reentrancy.
- **No front-runnable initialization.** Policy is set atomically in the constructor at
  deploy time — there is no separate `initialize` to race.
- **Overflow-checked arithmetic.** `overflow-checks = true` in the workspace release profile;
  spend accounting panics (reverts) rather than wrapping.
- **Testnet-only demo key.** The spectator demo embeds a worthless testnet agent key on
  purpose (the contract, not a human click, is the safety). A build-time guard refuses to
  load it on any non-testnet network. The per-user product embeds no keys — every owner
  action is signed by the user's own wallet or passkey.
- **One-signature setup gives the factory no standing authority.** `treasury_factory.create`
  deploys the treasury with the owner as its admin and performs the rest of the setup (payees,
  Leash, funding, registry) as sub-invocations of the one call the owner authorised — the
  treasury's own `require_auth` checks still run, against that signature. Once the call
  returns the factory has no role: it is not the admin, holds no funds and cannot act on the
  treasury. Setup is atomic — any refusal aborts all of it. A treasury's address is the hash
  of (network, factory, salt); someone who saw a salt in flight and deployed to it first
  would make the owner's creation fail, and nothing more — no funds or authority move before
  the treasury exists under the owner's admin.
- **The anchor never gets a useful signature.** The SEP-6 anchor is named by a home domain
  pinned in source. Its `stellar.toml` must declare this network and https endpoints, and a
  SEP-10 challenge is signed only after it is proven unsubmittable (sequence 0, manage-data
  operations only), addressed to this account and this home domain, and signed by the key
  that toml publishes. A payment dressed up as a challenge is refused
  (`web/src/lib/anchor/auth.test.ts`). The key that signs is the funding account's, never
  the owner's.
- **Agent credentials stay on the agent's machine.** `eunomia-mcp init` generates the Leash
  key locally and stores it under `~/.eunomia/` with mode 0600; only the public half reaches
  the dashboard. What the key can do is bounded by the Leash the owner signed — cap, deadline,
  the treasury's limits and payee list — and ends the moment the owner revokes it.
- **ZK verifier — bound to chain state.** The on-chain Groth16/BN254 verifier holds no
  policy of its own. Every claim in a proof is re-read from the treasury named in the call:
  its limits (`get_config`), its published payee root (`whitelist_root`), and the total it
  actually moved in that period (`period_spent`). The circuit forces the proved batch to
  equal that total, so a batch the prover invented no longer verifies. Only the treasury's
  admin can attest, periods must be closed and can only move forward, and non-canonical
  field encodings are rejected. Live on testnet, including a fabricated batch rejected
  on-chain (`Error(Contract, #9)`). What it still does **not** prove is the per-payment
  breakdown — see "Known limitations".

## Audit history

An internal security audit (agent-assisted, CSO-style: contract + frontend + dependency/
supply-chain review) was performed on **2026-06-03**, before the ZK layer and the per-user
product shipped. No critical findings. Status of every finding:

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| F1 | High | Embedded demo agent key had no mainnet guard | ✅ Fixed — build-time network guard refuses non-testnet |
| C1 | Medium | CEI ordering in `pay()` (transfer before accounting) | ✅ Fixed — effects recorded before transfer |
| C2 | Medium | Daily limit resets on the UTC **calendar day**, not a rolling 24h window — up to 2× the limit can be spent across a day boundary | ⚠️→✅ Fixed (M2), **incompletely** — see M1 (2026-08-05): the rolling window summed 24 buckets while spend is charged to the bucket it lands in, so the doubling moved to a 23h00m01s offset rather than going away. Closed properly on 2026-08-05 |
| C6 | Info | Narrow test coverage (single test) | ✅ Fixed — 14 contract tests (core + reputation + escrow) + 4 verifier tests + circuit & web suites, all in CI |
| F3 | Medium | Missing client-side input validation (latent) | ✅ Largely fixed — contract-id checksum validation, amount guards; the contract remains the real gate |
| C4 | Info | No admin withdraw/sweep — funds can strand if the agent key is lost or the whitelist is empty | ✅ Fixed (M2) — `admin_withdraw` (free balance, owner-signed, works while paused) + `set_paused` + `set_agent` rotation |
| C3 | Low | No storage TTL management (`extend_ttl`) — long-idle entries can be archived | ✅ Fixed (v3.2) — every mutation auto-extends the instance-storage TTL (`bump_instance`); persistent escrow entries were already TTL-managed (R2); proof test `mutation_extends_instance_ttl` |
| C5 | Info | No constructor bounds on limits (e.g. per-task > daily) | ✅ Fixed (M2) — constructor and `set_limits` validate `0 < per_task ≤ daily` (`InvalidLimits` #11) |
| F4 | Low | No CSP / security headers on the static site | 🟡 Partly closed (2026-08-05) — `frame-ancestors 'none'` + `X-Frame-Options`, nosniff, Referrer-Policy, HSTS, Permissions-Policy shipped in `vercel.json`. `script-src`/`connect-src` still open: see [`web/docs/security-headers.md`](web/docs/security-headers.md) |
| — | Info | npm audit 0 CVEs · pinned lockfile · no postinstall scripts · clean git history | ✅ Verified at audit time |

A second fresh-eyes review (agent-assisted, **2026-07-07**, after M2 shipped) found and
fixed in **v3.1** the same day:

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| R1 | Medium | No admin path to reclaim escrow-locked funds — a compromised agent could tie up the whole treasury in escrows only it could refund | ✅ Fixed — `admin_cancel_escrow` (owner-signed, works while paused, pays nobody) |
| R2 | Medium | Escrow entries (persistent) could theoretically be archived before a far-future deadline while `Locked` (instance) kept counting them | ✅ Fixed — escrow TTL extended past its deadline at creation |
| R3 | Low | `create_escrow` accepted past deadlines (instant-refund no-op that still burned session budget) | ✅ Fixed — `InvalidDeadline` (#12) |
| R4 | Low | Whitelist / reputation-gate mutations emitted no events (monitoring blind spot) | ✅ Fixed — `payee_add` / `payee_rm` / `rep_gate` events |
| R5 | Low | Wallet-kit module selection reset to Freighter on page reload — a reconnected non-Freighter (incl. WalletConnect mobile) session would sign through the wrong wallet | ✅ Fixed — selected wallet persisted and restored |

A third round (agent-assisted, **2026-08-05**, full scope: contracts + data layer + web +
CI/CD + supply chain + git history) ran after the passkey and recovery work shipped. **No
critical findings — no path was found for a compromised agent key, a malicious payee or a
third party to drain a treasury.** Everything below except H1 was fixed the same day; H1
was a design change and landed 2026-08-06.

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| M1 | Medium | Rolling window summed 24 hourly buckets while spend is charged to the bucket it lands in → a spend at second 3599 aged out after **23h00m01s**, so 2× the daily limit was reachable inside one wall-clock day (C2 regression) | ✅ Fixed — 25 buckets (24–25h, never short); test `window_never_frees_before_a_full_24h` |
| M2 | Medium | Replay guard keys on raw `periodId` bytes while the pairing check reduces mod `r` → an unmodified, already-spent proof was accepted again under `periodId + r` (~5 encodings/period) | ✅ Fixed — all 12 public signals must be canonical (`< r`); test `rejects_non_canonical_period_id` |
| M3 | Medium | `create_escrow` never checked the rolling window (enforced only at release) → the agent could lock the whole balance in escrows with `day_spent()` at 0 and block the owner's `admin_withdraw` | ✅ Fixed — window charged at commitment, not charged twice at release |
| H2 | High | `TreasuryRegistry.register` stores an **unverified** ownership claim and the app auto-adopts the newest entry → one signature on a zero-value "back up your treasury" call could hand a victim an attacker-administered treasury to fund | 🟡 Client fixed — a treasury whose on-chain `admin` is not the connected wallet is refused. Contract-side `admin == owner` check + `unregister` still open |
| D1 | High | `activity` rows are anon-insertable with no verification and publicly readable, while being cited as traction evidence | 🟡 Hardened — server-forced `created_at`, unique `tx_hash`, StrKey/hex shape checks (migration `0004`). Server-side ledger verification still open; treat the numbers as telemetry, not proof |
| W1 | Medium | Test-signer wallet bypass gated only on `VITE_ENABLE_TEST_SIGNER`, untied to the build; the global and key-reading code shipped as dead code in the public bundle | ✅ Fixed — gated on `import.meta.env.DEV` first; verified absent from the built bundle |
| W2 | Medium | The embedded-demo-key guard compares two literals in the file it protects, so a cutover edit can delete it | ✅ Fixed — `npm run check:no-secrets` runs on every build, reads the intended network from source and shipped keys from `dist`; verified in both directions |
| C1 | Medium | The `testnet-e2e` environment referenced by the E2E workflow **did not exist**, so it gated nothing | ✅ Created (the repo currently holds no Actions secrets) |
| C3 | Med-High | Playwright traces record `addInitScript` arguments verbatim — the funded wallet secret — and CI uploads them from a **public** repo | ✅ Fixed — traces/videos off on CI, screenshots kept |
| C4 | Medium | Third-party Actions referenced by mutable tag | ✅ Fixed — pinned to commit digests (same versions) |
| C5 | Low-Med | No `permissions:` block; jobs inherited the repository default token scope | ✅ Fixed — `contents: read` on both workflows |
| C2′ | Medium | `main` had no required review/status checks and admins were exempt from what protection existed | 🟡 `enforce_admins` enabled; required reviews deliberately **not** enabled on a solo repo — that is a workflow decision, not a silent default |
| M4 | Medium | With the reputation gate on, whoever controls the registry can authorize payees without the owner's signature, at the same limits as a whitelisted one | ⏳ Open — needs a separate, lower cap for reputation-authorized payees |
| H1 | High | ZK attestation is **not bound to the treasury**: no public signal identifies it, none derives from chain state, the witness is prover-chosen and `verify` needs no auth → anyone can mint a valid `ComplianceAttested` for any period | ✅ Fixed 2026-08-06 — the verifier is now multi-tenant and reads limits, payee root and the period total from the treasury itself; the circuit binds the batch to that total (`total === periodSpent`); only the treasury admin can attest; periods must be closed and strictly advancing. Proven on testnet: a valid proof of a fabricated batch is rejected with `Error(Contract, #9)` |

**Not yet through an audit round:** the treasury factory (2026-09-16), `eunomia-mcp`
(2026-09-14 → 09-18) and the anchor leg (2026-09-18) all shipped after the third round.
They carry their own tests — including live runs against testnet and production — but no
independent review has looked at them yet. That round is a precondition for mainnet.

## Known limitations (honest scope)

- **Contracts are immutable — deliberately.** M2 shipped the lifecycle (pause/resume,
  admin withdraw, limit updates, agent rotation, revocable agent sessions) but **no
  upgrade entrypoint**: an upgradeable treasury would turn "the contract enforces the
  rules" into "trust the admin". The exit story is pause + withdraw + deploy a new
  treasury (v3 wasm).
- **Session secrets live in the browser (testnet scope).** An agent session key is
  stored in localStorage — acceptable precisely because the credential is bounded
  (spend cap + expiry + instant revoke). Mainnet needs hardened key storage and fee
  sponsorship for session accounts (M3).
- **So does the funding account's key.** The G-account between the anchor and a treasury is
  a device-held key in localStorage. It is a corridor: it holds USDC only from the anchor's
  payment to the forward that follows, seconds later — plus anything an interrupted transfer
  left behind, which the app looks for and offers to move in whenever the form opens. Whoever
  steals that key can take what is in the corridor at that moment, and nothing from the
  treasury. It exists because the anchor has no SEP-45 endpoint (a smart wallet cannot sign
  in) and pays G-accounts only; with SEP-45 on the anchor's side it disappears.
- **The anchor is a counterparty, and today it is a sandbox.** `tr-mock-anchor.fly.dev`
  simulates the bank and KYC; only its Stellar side is real. The TRY → USDC leg is not
  atomic and cannot be: between the bank transfer and the anchor's payment the owner holds a
  claim on the anchor, which no contract enforces. A production anchor's solvency, compliance
  and uptime sit outside everything the treasury guarantees. What the integration does
  guarantee is on our side of the line: a locked rate before any money moves, and no
  signature the anchor could misuse.
- **A `connect-src` policy is still open (F4)** — and the app now talks to one more origin,
  the anchor's. An allowlist has to include it.
- **The ZK layer attests after the fact, and proves the total rather than the breakdown.**
  `pay()` does not require a proof; confidential compliance and the payment flow are not
  wired together (M4). Since H1 the proof is bound to the chain — the batch must equal the
  treasury's own `period_spent` for a closed day — so the honest claim is: *"this treasury
  moved exactly this much in this period, no single payment exceeded the per-task limit,
  and every payee was a member of the published root."* It is **not** proof of the
  individual amounts and payees: a different split of the same total also satisfies the
  circuit. Two gaps remain behind that:
  - The payee root is **declared, not derived**. `set_whitelist_root` is written by the
    owner; nothing ties it to the treasury's actual `Payee` entries, and there is no
    mapping from a Stellar address to the circuit's payee field element. The whitelist is
    a key-per-payee map with no on-chain enumeration, and the circuit's Poseidon hash has
    no host implementation to rebuild a tree with — so deriving it is real work, not a
    config change. Root changes emit an event, which is what makes them auditable today.
  - Proving the breakdown itself would require `pay()` to publish a commitment per payment,
    which runs into the same missing Poseidon primitive.
  The Groth16 setup is also a single-party dev setup — a multi-party ceremony is a mainnet
  prerequisite (M3).
- **The treasury registry records claims, not facts.** `register` does not check that the
  registered contract is one the caller administers, and there is no `unregister`. The app
  now refuses any treasury whose on-chain `admin` is not the connected wallet, so a poisoned
  entry cannot become your session — but the registry itself remains an unverified index.
- **The reputation oracle is a stand-in.** Scores are admin-set on testnet; production
  targets the [trionlabs/stellar-8004](https://github.com/trionlabs/stellar-8004) registries (M4).

## Reporting a vulnerability

- Preferred: **GitHub private vulnerability reporting** on this repository
  (Security → Report a vulnerability).
- Or email **l3ekirerdem@gmail.com** with details and reproduction steps.

There is no bug bounty yet. Reports are acknowledged as fast as possible and fixes are
prioritized ahead of feature work. Please do not open public issues for exploitable
vulnerabilities before a fix ships.
