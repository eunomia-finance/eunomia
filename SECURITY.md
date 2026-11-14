# Security

Eunomia runs on Stellar mainnet **in beta**. The code has had internal reviews, not an
external audit, so every treasury carries a deposit cap fixed at creation; use amounts you
are prepared to lose. What comes before the cap goes: [`ROADMAP.md`](ROADMAP.md) (M3).

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
- **No keys in the app.** Every owner action is signed by the user's own wallet or passkey,
  and the agent signs with its own key on its own machine. `npm run check:no-secrets` runs
  on every build and refuses a bundle that carries any secret seed, a test-network endpoint
  or the retired demo's addresses.
- **One-signature setup gives the factory no standing authority.** `treasury_factory.create`
  deploys the treasury with the owner as its admin and performs the rest of the setup (payees,
  Leash, funding, registry) as sub-invocations of the one call the owner authorised — the
  treasury's own `require_auth` checks still run, against that signature. Once the call
  returns the factory has no role: it is not the admin, holds no funds and cannot act on the
  treasury. Setup is atomic — any refusal aborts all of it. A treasury's address is the hash
  of (network, factory, salt); someone who saw a salt in flight and deployed to it first
  would make the owner's creation fail, and nothing more — no funds or authority move before
  the treasury exists under the owner's admin.
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
  field encodings are rejected. Proven on chain before mainnet, including a fabricated batch
  rejected (`Error(Contract, #9)`); not deployed in the mainnet beta (see the trusted-setup
  limitation below). What it still does **not** prove is the per-payment breakdown — see
  "Known limitations".

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
| H2 | High | `TreasuryRegistry.register` stores an **unverified** ownership claim and the app auto-adopts the newest entry → one signature on a zero-value "back up your treasury" call could hand a victim an attacker-administered treasury to fund | ✅ Fixed 2026-10-24 — the registry refuses a treasury whose `admin` is not the owner and has `unregister` (tests `a_treasury_someone_else_administers_cannot_be_listed`, `unregister_drops_only_that_entry`). The registry can only ask the contract, and a contract can claim any admin, so the app also refuses a treasury that does not run the shipped wasm (`runsTreasuryCode`, read from the instance entry) before it believes the admin it reports |
| D1 | High | `activity` rows are anon-insertable with no verification and publicly readable, while being cited as traction evidence | 🟡 Hardened — server-forced `created_at`, unique `tx_hash`, StrKey/hex shape checks (migration `0004`). Server-side ledger verification still open; treat the numbers as telemetry, not proof |
| W1 | Medium | Test-signer wallet bypass gated only on `VITE_ENABLE_TEST_SIGNER`, untied to the build; the global and key-reading code shipped as dead code in the public bundle | ✅ Fixed — gated on `import.meta.env.DEV` first; verified absent from the built bundle |
| W2 | Medium | The embedded-demo-key guard compares two literals in the file it protects, so a cutover edit can delete it | ✅ Fixed — `npm run check:no-secrets` runs on every build, reads the network the bundle was built for from `dist/build-info.json` and shipped keys from `dist`; verified in both directions. Since 2026-10-23 the network is a build mode, not an edit, and a mainnet bundle carries no demo code at all (DEPLOYMENT.md, "Mainnet web build") |
| C1 | Medium | The `testnet-e2e` environment referenced by the E2E workflow **did not exist**, so it gated nothing | ✅ Created (the repo currently holds no Actions secrets) |
| C3 | Med-High | Playwright traces record `addInitScript` arguments verbatim — the funded wallet secret — and CI uploads them from a **public** repo | ✅ Fixed — traces/videos off on CI, screenshots kept |
| C4 | Medium | Third-party Actions referenced by mutable tag | ✅ Fixed — pinned to commit digests (same versions) |
| C5 | Low-Med | No `permissions:` block; jobs inherited the repository default token scope | ✅ Fixed — `contents: read` on both workflows |
| C2′ | Medium | `main` had no required review/status checks and admins were exempt from what protection existed | 🟡 `enforce_admins` enabled; required reviews deliberately **not** enabled on a solo repo — that is a workflow decision, not a silent default |
| M4 | Medium | With the reputation gate on, whoever controls the registry can authorize payees without the owner's signature, at the same limits as a whitelisted one | ⏳ Open — needs a separate, lower cap for reputation-authorized payees |
| H1 | High | ZK attestation is **not bound to the treasury**: no public signal identifies it, none derives from chain state, the witness is prover-chosen and `verify` needs no auth → anyone can mint a valid `ComplianceAttested` for any period | ✅ Fixed 2026-08-06 — the verifier is now multi-tenant and reads limits, payee root and the period total from the treasury itself; the circuit binds the batch to that total (`total === periodSpent`); only the treasury admin can attest; periods must be closed and strictly advancing. Proven on testnet: a valid proof of a fabricated batch is rejected with `Error(Contract, #9)` |

A fourth round (agent-assisted, **2026-10-20 → 22**, before mainnet) took in what had shipped
since: the treasury factory, `eunomia-mcp`, the relay, the passkey signing path, the
Supabase layer and the Cloudflare headers. **No critical findings and no path to drain a
treasury.** Its IDs restart at H1/M1/L1; the commits name them as "review M1" and so on.

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| H1 | High | A budget-request link could be signed by any key, and the card approved what it asked for | ✅ Fixed 2026-10-21 — an unfamiliar key is approved only after the owner pastes the key their agent printed; full addresses; no payees approved from a link; a signed 24h expiry |
| M1 | Medium | The passkey signs auth entries that come from RPC simulation, which the prompt cannot show: a hostile RPC could add one | ✅ Fixed 2026-10-22 — every passkey path holds the entries to the host function the app built before signing (`authCheck.ts`) |
| M2 | Medium | Nothing bounded what the relay spends on fees | ✅ Fixed 2026-10-22 — per-transaction cap, balance floor, a daily budget held in one Durable Object, a per-wallet limiter |
| M3 | Medium | The relay admitted any auth entry, including delegates and ones authorising as the relay key | ✅ Fixed 2026-10-21 — address credentials only, never the relay's own |
| M4 | Medium | `call_service` could be pointed at private and loopback hosts (SSRF) | ✅ Fixed 2026-10-21 (https public hosts only, no redirects); rechecked at connect time 2026-10-23 |
| M5 | Medium | The network was chosen by editing a file, and the demo agent key could ship in a mainnet bundle | ✅ Fixed 2026-10-23 — the build chooses the network; since 2026-10-24 there is only mainnet and the demo is gone |
| L1 | Low | `Payee`, `PayeeCap` and `TaskSpent` are never TTL-extended after a write | 🟡 Accepted for the beta — since protocol 23 an archived entry in a call's footprint is restored by that call, for a fee, so nothing is lost or stuck. `extend_ttl` on write and a public `bump()` go into the next treasury version |
| L2 | Low | `create_escrow` extends the entry's TTL to `MAX_TTL_LEDGERS`, which can exceed the network maximum: an escrow about six months out traps (refused, nothing lost) | 🟡 Open for the next treasury version (clamp to `max_ttl()`). Neither the app nor `eunomia-mcp` creates escrows |
| L3 | Low | The deposit cap bounds the balance, not deposits: anyone can transfer tokens in directly and push the owner's `deposit` over the cap | 🟡 Documented below; the owner makes room with `admin_withdraw` |
| L4 | Low | The factory salt is not bound to the owner: someone who sees a salt first can take that treasury address | 🟡 Open for the next factory (`sha256(owner ‖ salt)`). Refusal only — the victim's `create` aborts as a whole, nothing was funded in advance, a new salt works |
| L5 | Low | A mainnet relay admitted testnet-era treasury hashes | ✅ Fixed 2026-10-21 |
| L6 | Low | The reputation gate trusts an admin-chosen oracle; a farmed score admits a non-whitelisted payee | 🟡 Same as M4 above: the gate is off unless the owner turns it on, and the mainnet app does not offer it |
| L7 | Low | The agent credential's `0600` applied only at creation; `init`'s client config (which carries `EUNOMIA_RPC_URL`) and its `.bak` were world-readable | ✅ Fixed 2026-10-24 — chmod `0600` after every write. Windows ignores POSIX modes; the profile ACL protects the files there |
| L8 | Low | `activity` is anon-insertable and publicly readable, so it is forgeable and links wallets to treasuries | 🟡 By design, documented: it is the app's own log, not evidence; usage is counted from the chain (`chain_events`, service-role only). The wallet–treasury link is public on chain anyway (`get_config`). All its check constraints are validated |
| L9 | Low | The CSP allowed `*.supabase.co` and `*.stellar.org` | ✅ Fixed 2026-10-24 — exact hosts from the build (the app's own RPC, Horizon, the Supabase project) and `Cross-Origin-Opener-Policy`. `img-src https:` and inline styles stay: wallet icons come from the WalletConnect registry, and React writes style attributes |
| L10 | Info | Semantics: the window holds spend 24–25h; refunded escrows do not give back window or cap allowance; old month buckets may need a restore | ℹ️ Conservative by design; documented |

A fifth round (agent-assisted, **2026-11-14**, before the first real-money runs on mainnet)
read the three contracts as deployed — treasury v4, factory v4.1 and the registry, including
what the fourth round had not yet seen — and, separately, everything off chain: the relay,
the passkey signing path and `eunomia-mcp`. **Nothing was found in the contracts, and no path
to drain a treasury.** What it found was off chain, and the worst of it was not theft but an
owner locked out: the relay is a passkey owner's only way to the chain, and anyone could
switch it off for the day.

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| F1 | High | The relay's daily fee budget could be emptied in about a minute by anyone, for free: a signed envelope was admitted on its first host function alone, charged to the day before it was sent, and the charge stayed when the network refused it. With the day gone, no passkey owner could revoke a Leash, pause or withdraw until 00:00 UTC | ✅ Fixed 2026-11-14 — a refused transaction's charge is given back; an envelope is admitted only as one signed deployment of the wallet code for this network; calls nobody signed are not paid for; a wallet's limiter counts only signatures the chain accepted; exit calls (`revoke_session`, `set_paused`, `admin_withdraw`, `admin_cancel_escrow`, `remove_payee`) have a reserve and a lower floor of their own |
| F2 | Medium | `call_service` went on spending the float after the owner revoked the Leash, paused the treasury or the deadline passed — and with the task budget expired, its payee list no longer applied | ✅ Fixed 2026-11-14 (`eunomia-mcp` 0.3.1) — the float is spent only under an active Leash for this agent on a treasury that is not paused; a pause state that cannot be read counts as paused |
| F3 | Medium | The exception card showed the payee as `GABC…WXYZ` and approved it for good in one click — the shape address poisoning imitates | ✅ Fixed 2026-11-14 — the whole address, and the owner pastes the address they mean to pay before the button works |
| F4 | Medium | The model chose the URL and `maxPrice` of every `call_service`, and one catalog address covers hundreds of services: text returned by a service could talk the agent into emptying the float through it | ✅ Fixed 2026-11-14 (0.3.1) — hosts and a per-call ceiling come from the server's environment (`EUNOMIA_SERVICE_HOSTS`, default the catalog only; `EUNOMIA_MAX_PRICE`, default 1). The float remains the outer bound: a service on an allowed host that overcharges inside the ceiling is still paid |
| F5 | Low | A signed x402 payment stayed collectable for as long as the service asked (months), and "not paid" after a missing settlement invited another signature on every retry | ✅ Fixed 2026-11-14 (0.3.1) — at most 300 seconds, and no second payment to the same service until the first can no longer be collected |
| F6 | Low | Every start of the agent's MCP server ran `npx -y eunomia-mcp`: the newest release and freshly resolved dependencies, in the process that holds the agent's key | ✅ Fixed 2026-11-14 (0.3.1) — configs pin the exact version, the package ships a shrinkwrap, CI and publishing use `npm ci` with a named npm |
| N1 | Info | The relay sponsors a direct deployment of the treasury code from a smart wallet, which skips the factory and so its deposit cap — for the wallet's own treasury only | 🟡 Open — the app creates treasuries through the factory; the direct path goes when the legacy treasuries are retired |
| N2 | Info | A task budget names addresses, and nearly every catalog service settles to one: the contract bounds how much reaches the agent and until when, not which service it buys. Which service is decided on the agent's machine | ℹ️ By design, documented under "Known limitations" |
| N3 | Info | One Leash at a time: approving a budget replaces the one that is running | ℹ️ By design; the budget card says so before the owner signs |

Still open from this round's own notes, for a live test rather than a reading: whether a
wallet-scoped recovery signer can authorise anything beyond adding a signer in the deployed
wallet code, and what a fee bump with inflated declared resources really costs (bounded by
the per-transaction cap and the daily budget either way). Until an independent audit, the
beta's deposit caps stay.

## Known limitations (honest scope)

- **Contracts are immutable — deliberately.** M2 shipped the lifecycle (pause/resume,
  admin withdraw, limit updates, agent rotation, revocable agent sessions) but **no
  upgrade entrypoint**: an upgradeable treasury would turn "the contract enforces the
  rules" into "trust the admin". The exit story is pause + withdraw + deploy a new
  treasury (v3 wasm).
- **The deposit cap bounds the balance, not what was deposited** (fourth round, L3). No
  contract can refuse an incoming token transfer, so anyone can send tokens straight to a
  treasury: they count toward the cap, and can push it to the point where the owner's own
  `deposit` is refused. Nothing is lost — the owner `admin_withdraw`s the excess to make
  room. The cap is a bound on what the beta holds, not a filter on who funds it.
- **The agent's key is a file on the agent's machine.** `eunomia-mcp` keeps it under
  `~/.eunomia/` (mode 0600) — bounded by design (spend cap + expiry + instant revoke), so a
  leak is survivable, but whoever holds it can spend up to the Leash's cap until the owner
  revokes it. The key pays its own fees; sponsoring agent accounts is open (M3). The browser
  never holds an agent key: the in-browser Leash key was retired at the mainnet cutover.
- **The float is outside the contract, and which service is bought is decided off chain.**
  Stellar's x402 and MPP facilitators settle from a regular account only, so the agent pays
  services from a float on its own account, topped up by the treasury's `pay()`. The contract
  bounds how much can reach that account and until when — the Leash or task budget, the
  per-payment, daily and monthly limits, a cap on the agent's own address — and nothing after
  that. A task budget names addresses, and nearly every catalog service settles to one router
  address, so "only these services" is kept by `eunomia-mcp` on the agent's machine (allowed
  hosts, a per-call ceiling, the approved payees, the running Leash), not by the chain. The
  worst case is the budget the owner approved, spent on something they did not mean; revoking
  stops further top-ups on chain at once, and stops the float through `eunomia-mcp`. Someone
  holding the key itself can still spend what the float already holds.
- **The web app is the soft spot.** The contracts need no trust in us; the page that builds
  the transactions does. Whoever controls what `eunomia.finance` serves can put a harmful call
  in front of an owner — a withdrawal to the wrong address, an attacker approved as a payee, an
  oversized Leash — and a passkey prompt shows no transaction detail to catch it (a wallet's
  own confirmation screen shows more). What bounds it today: every such call still needs the
  owner's signature, one at a time, and nothing can be taken without one. What mainnet needs:
  a strict `script-src`/`connect-src` policy, reproducible builds a third party can compare
  with what is served, and a human-readable summary of what is being signed.
- **The published package is a supply-chain surface.** A poisoned `eunomia-mcp` release could
  read the agent keys it manages. The damage is bounded by each Leash — cap, deadline, approved
  payees, instant revoke — but the trust would not be. Publishing requires 2FA; release
  provenance and pinned versions in the printed MCP config are the next steps.
- **The ZK layer attests after the fact, and proves the total rather than the breakdown.**
  `pay()` does not require a proof; confidential compliance and the payment flow are not
  wired together (M4). Since H1 the proof is bound to the chain — the batch must equal the
  treasury's own `period_spent` for a closed day — so the honest claim is: *"this treasury
  moved exactly this much in this period, no single payment exceeded the per-task limit,
  and every payee was a member of the published root."* It is **not** proof of the
  individual amounts and payees: a different split of the same total also satisfies the
  circuit. Two gaps remain behind that:
  - The payee root is **published by the owner, not derived on-chain** — but it is now
    **checkable**. Since 2026-09-28 a payee's field element is a fixed function of its
    Stellar address (`packages/prover/src/payeeField.ts`: SHA-256 of the StrKey, top 248
    bits), the tree is built over the sorted set, and the pipeline refuses any member the
    treasury does not confirm with `is_payee`. Anyone given the member addresses can
    rebuild the root and compare it with `whitelist_root`. What stays open: the contract
    cannot enforce that the root covers *every* approved payee (the whitelist is a
    key-per-payee map with no on-chain enumeration, and Poseidon has no host function to
    rebuild a tree with). A root that omits a payee only makes proofs harder, never
    easier — a payment to an omitted payee cannot be proven. Root changes emit an event.
  - Proving the breakdown itself would require `pay()` to publish a commitment per payment,
    which runs into the same missing Poseidon primitive.
  The Groth16 setup is also a single-party dev setup — a multi-party ceremony comes before
  the verifier is deployed on mainnet (M3).
- **The treasury registry records claims, not facts.** `register` does not check that the
  registered contract is one the caller administers, and there is no `unregister`. The app
  now refuses any treasury whose on-chain `admin` is not the connected wallet, so a poisoned
  entry cannot become your session — but the registry itself remains an unverified index.
- **The reputation oracle is a stand-in**, not deployed on mainnet; production targets the [trionlabs/stellar-8004](https://github.com/trionlabs/stellar-8004) registries (M4).

## Reporting a vulnerability

- Preferred: **GitHub private vulnerability reporting** on this repository
  (Security → Report a vulnerability).
- Or email **l3ekirerdem@gmail.com** with details and reproduction steps.

There is no bug bounty yet. Reports are acknowledged as fast as possible and fixes are
prioritized ahead of feature work. Please do not open public issues for exploitable
vulnerabilities before a fix ships.
