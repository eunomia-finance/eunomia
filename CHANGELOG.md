# Changelog

Notable changes to Eunomia (PRISM until the 2026-08 rename — older entries keep the name
they were written under), grouped by release wave. Full detail lives in the
[conventional-commit history](https://github.com/eunomia-finance/eunomia/commits/main);
deployed addresses and on-chain proofs in [`DEPLOYMENT.md`](DEPLOYMENT.md).

## [0.9.0] — 2026-09-18 → 09-19 · Money in: the TRY on-ramp, USDC treasuries, `eunomia-mcp` on npm

The budget can now start as ordinary money, and any MCP agent can be connected with a
published package. Architecture and evidence: [`docs/ANCHOR.md`](docs/ANCHOR.md).

- **Added (anchor leg)** — `web/src/lib/anchor`: SEP-1 discovery, SEP-10 sign-in, SEP-38
  quotes, SEP-6 `deposit-exchange` / `withdraw-exchange`, SEP-12 payout IBAN, against the
  TRY ⇄ USDC sandbox anchor. Only inputs: a home domain and an asset code. The SEP-10
  challenge is verified before it is signed (sequence 0, manage-data only, this account,
  this home domain, the toml's key). A per-treasury **funding account** bridges what the
  anchor cannot do — it signs in and pays out G-accounts only — and forwards the USDC into
  the treasury; an interrupted transfer is found and finished the next time the form opens
- **Added (product)** — a treasury is created over **USDC or XLM** (the factory always took
  the token; only the web client pinned it). "Add funds" on a USDC treasury is the TRY flow:
  live price → bank details at a locked rate → each leg reported with its transaction. No
  wallet prompt on that path: a passkey owner reaches a funded treasury with one signature
  and without ever holding XLM (measured on the live site). Every amount label follows the
  treasury's token
- **Added (setup)** — "Connect an agent now" works: a treasury's address is the hash of
  (network, factory, salt), so the form settles it before the treasury exists and prints
  `eunomia-mcp init` with it — one signature creates the treasury *and* puts the agent on
  its Leash. The Agent page prints the same command for an existing treasury
- **Published** — `eunomia-mcp` **0.2.0 → 0.2.1** on npm. 0.2.1 names the `unit` of every
  amount ("USDC", "XLM"), read from the token contract's own `symbol()`; publish checks run
  on Windows (`cmp`/`cp` replaced by a node script)
- **Fixed** — starting funds of 0 never validated although the form promised "0 opens it
  empty" · the setup nudge rendered "Add funds" before the state loaded and turned into
  "Approve a payee" under the cursor · the smoke spec had been stale since the redesign
  (dead selector, unscoped button, an absolute balance expectation)
- **Tests** — `live.test.ts` (TRY in → USDC treasury → agent pays → stranger refused, on
  testnet), `try-funding.spec.ts`, `setup-agent.spec.ts` (runs the published package with
  the command read off the screen), `passkey-try.live.spec.ts` (production, virtual passkey:
  exactly one signature for setup, none for funding) · 378 web tests · 63 package tests
- **Docs** — README rewritten for the product as it stands (agent connection, anchor leg,
  current addresses, the ZK layer described by what it proves); architecture diagram redrawn;
  SECURITY.md brought to September; nine PRISM-era images removed; screenshots re-taken from
  a real run (`playwright.shots.config.ts`); the try-it guides (EN/TR), the demo script,
  SKILL.md and the roadmap rewritten for the current flow; the docs site gains *Connect your
  agent* and *The anchor leg*, current addresses, and a security page that lists what is
  still open instead of claiming everything is closed. README's policy-gate listing corrected
  against the contract (it named error codes that do not exist)
- **Fixed (testnet data)** — the app's sample vendor could not receive the anchor's USDC (no
  trustline), so "use the sample vendor" led a USDC treasury into a failed payment; trustline
  added

## [0.8.0] — 2026-09-16 → 09-17 · One-signature setup + the control-room dashboard

- **Added (contract)** — `treasury_factory`: deploy + policy + payees + Leash + funding +
  registry under **one owner signature**, atomically — replacing a five-transaction setup.
  The factory keeps no authority over what it creates
- **Added (web)** — sign in with an existing passkey (a return visit no longer mints a new
  wallet) · the dashboard rebuilt as a **ledger of what the rules did**: one dark panel for
  the latest verdict, the decision ledger, a rolling-24h meter, Leash, rules; phone layout
  keeps time · verdict · what. Design language in `web/docs/design/design-dna.md`
- **Fixed** — the Supabase `activity.action` constraint had been silently dropping the
  Leash-era verbs since the first agent week; migration `0005` + a guard test · wallet
  balance read until the faucet lands; setup never blocks on a displayed balance

## [0.7.0] — 2026-09-14 → 09-15 · `eunomia-mcp`: any MCP agent on a Leash

- **Added** — `packages/mcp`: stdio MCP server + TypeScript SDK + CLI (`init`, `status`,
  `pay`, `config`). The agent generates its own key; the owner authorises only the public
  half from the Agent page. Tools: `check_budget` (with pre-flight refusal reasons in the
  contract's own codes), `list_allowed_payees` (rebuilt from contract events, each address
  re-verified on-chain), `check_payee`, `pay` (address + amount, or an **x402** payment
  requirement), `request_exception` / `check_exception` — serverless: a request is a data
  entry on the agent's own account that the owner's dashboard reads and resolves with an
  on-chain action
- **Proven on testnet** — first autonomous payment and first on-chain recorded refusal,
  hashes in [`DEPLOYMENT.md`](DEPLOYMENT.md)

## [0.6.0] — 2026-08-05 → 08-12 · Third audit round, proofs bound to chain state, x402 v2

- **Security** — full-scope review (contracts, data layer, web, CI/CD, supply chain, git
  history); no path found to drain a treasury. Fixed: the rolling window freed spend after
  23h (25 buckets now), a replayable proof under `periodId + r` (canonical signals only),
  escrows bypassing the window, a test-signer bypass reachable in a build, Playwright traces
  leaking the funded test key from a public repo, unpinned Actions. Status of every finding
  in [`SECURITY.md`](SECURITY.md)
- **Changed (ZK)** — the attestation is **bound to the treasury**: the verifier is
  multi-tenant, holds no policy, and re-reads limits, payee root and the period total from
  the treasury named in the call; the circuit forces the batch to equal that total; only the
  admin attests, periods are closed and strictly advancing. Widened to a 16-payment batch
- **Changed (x402)** — requirements aligned with the v2 Stellar `exact` scheme; a real 402
  handshake with the bounded gate as client policy; interop proven with a funded agent
- **Changed** — the PRISM → Eunomia rename finished across docs, packages and tests; docs
  site gains search, edit links and a way back to the app; faucet allocations capped per day

## [0.5.0] — 2026-07-08 → 08-04 · The app shell, passkeys, and a new name

- **Added (app)** — the per-user product became an application: hash router, sidebar +
  mobile tabs, treasury switcher, Overview · Payments · Agent · Activity · Settings pages, a
  toast system, a durable activity ledger (Supabase history + Realtime merged with chain
  events) that survives the RPC retention window, anomaly notice, customer-language pass
- **Added (passkeys)** — sign up with Face ID / fingerprint / PIN: a WebAuthn passkey
  controls a Stellar smart wallet that deploys and owns the treasury. A fail-closed **relay**
  sponsors fees (admission by contract address or treasury wasm hash, host function decoded
  server-side) and a capped **faucet** gives smart wallets their first XLM; a `TxExecutor`
  seam keeps the wallet path exactly as it was
- **Changed (brand)** — PRISM became **Eunomia**: mark, Kalnia wordmark, cream/ink/green
  identity, redesigned landing, eunomia.finance
- **Added** — VitePress docs site at `/docs` · wallets offered by what works on the device
  in front of you (WalletConnect first on mobile, Stellar-speaking wallets only) · the
  architecture diagram
- **Fixed** — verifier rejects policy anchors wider than the circuit's comparator widths ·
  E2E wallets kept out of the registry and the user-count evidence · iOS zoom on form fields

## [0.4.1] — 2026-07-07 · Fresh-eyes review wave (treasury v3.1 + UX hardening)

A four-track independent review (contracts, web libs, UX flow, cross-consistency)
before the user-acquisition push; every confirmed finding fixed the same day.

- **Fixed (contract v3.1)** — `admin_cancel_escrow`: the owner can unilaterally unwind an
  open escrow (a compromised agent could previously tie up the whole treasury in escrows
  only it could refund) · escrow deadlines validated (`#12 InvalidDeadline`) · escrow
  entries get TTL extended past their deadline (archived-entry / stranded-`Locked` risk) ·
  whitelist + reputation-gate mutations now emit events (`payee_add`/`payee_rm`/`rep_gate`)
  · 48 tests
- **Fixed (web)** — selected wallet module persisted across reloads (a reconnected
  xBull/Lobstr/WalletConnect session no longer signs through Freighter) · `agentPay` stops
  labeling permanent failures as retryable (+ `TRY_AGAIN_LATER` now retried) · session
  start signs first, friendbot-funds after (declines no longer burn rate-limited friendbot
  calls) · corrupted session keys get a guided message · registry recovery StrKey-filters
  ids · per-action busy states (buttons show progress; no more frozen-app feel) · stale
  wallet state fully reset on account switch · persistent "back up your ID" hint (was a
  transient status message the next action erased) · XLM/USDC expectation set before
  deploy + two-approval flow explained upfront · `PayResult`/`PrismState`/`errText`
  single-sourced · `prism.ts` finally under test (92 web tests)
- **Docs** — circuit test count 6/6 · dated milestone counts in DEPLOYMENT · TRY-IT
  (EN/TR) covers agent sessions + owner controls · per-package READMEs
  (treasury-client/registry-client/prover) · prover on stellar-sdk v14 · SECURITY gains
  the review-wave findings table

## [0.4.0] — 2026-07-07 · M2 agent infrastructure (treasury v3 + registry)

The gap between "a human signs every payment" and "an agent spends autonomously,
safely" — closed ([design spec](docs/superpowers/specs/2026-07-07-prism-m2-design.md)).

- **Added (contract v3)** — agent **sessions**: time-bound, spend-capped, instantly
  revocable credentials that are the *only* spender while active (single-spender rule) ·
  lifecycle: `set_paused` (exit paths never lock), `admin_withdraw` (free balance,
  window-exempt), `set_limits` (validated, immediate), `set_agent` rotation ·
  **rolling 24h window** replaces the fixed UTC day (hourly buckets; audit finding C2
  closed with an on-chain-provable boundary test) · constructor limit validation (C5) ·
  new errors `#9 Paused`, `#10 ExceedsSessionLimit`, `#11 InvalidLimits` · 45 tests
- **Added (registry)** — permissionless `treasury_registry` contract (owner → treasuries)
  + best-effort registration on deploy + cross-device recovery in the Workspace
- **Added (app)** — Controls (pause/resume, withdraw, limit updates) · Agent session
  section with zero-popup **Run autonomous task** (browser session key signs; wallet
  popups only to start/revoke) · legacy-treasury detection (pre-M2 treasuries keep
  working, new sections hide) · friendly messages for #9–#11
- **Changed** — `day_spent()` now reports the rolling 24h window (UI label "Last 24h");
  the `DaySpent` calendar-day key is gone from v3; per-user deploys instantiate the v3
  wasm — earlier treasuries stay on their original immutable code
- **Decided** — the contract remains **non-upgradeable by design**: the exit is
  pause + withdraw + redeploy, not "trust the admin"

## [0.3.2] — 2026-07-06 · Hardening wave

- **Fixed (contract)** — `pay()` can no longer spend escrow-locked funds (free-balance
  invariant, `#6`); +10 hardening tests (auth-negatives, escrow lifecycle edges)
- **Fixed (web)** — head-based event paging (newest events never dropped; ~1 RPC per
  refresh) · multi-treasury localStorage schema (second deploy no longer overwrites the
  first id) · per-treasury monitor counters · friendly contract-error messages (#1..#8)
  from a single map · generated client regenerated from the v2.1 wasm (escrow +
  reputation callable; single-source `npm run generate` + CI byte-sync guard)
- **Docs** — stale claims synced (feedback → Google Form, test counts, DEMO wording);
  orphan in-app feedback modal removed

## [0.3.1] — 2026-07-02 · Onboarding & UX hardening

First-real-users wave: everything a cold wallet hits in its first five minutes.

- **Added** — testnet funding gate (friendbot one-click for empty wallets) · treasury-ID
  copy + save hint + contract-id validation · sample-vendor payee fill + spend prefill ·
  global wallet chip in a redesigned nav (connect / copy / disconnect, shared across
  landing and app) · hash routing (refresh keeps the current view) · Turkish quickstart
  ([`docs/TRY-IT-TR.md`](docs/TRY-IT-TR.md)) · [`ROADMAP.md`](ROADMAP.md) · [`SECURITY.md`](SECURITY.md)
- **Fixed** — activity feed now watches the connected user's own treasury and pages
  `getEvents` to the ledger head (day-wide windows span multiple RPC pages) · wallet view
  hydrates the shared connection · deploy/fund/whitelist/pay errors surface in human
  language · mobile nav no longer hides all links · fixed-width spend bars
- **Docs** — README refocused on the product (Level 1-3 requirement-proof sections removed,
  per-user product screenshots added) · honest testnet-USDC/XLM scope

## [0.3.0] — 2026-07-01 · Per-user product (Level 4)

From spectator demo to a product you can use with your own wallet.

- **Added** — connect any Stellar wallet → deploy **your own** bounded treasury
  (non-custodial, native XLM) → fund → whitelist payees → spend; policy violations rejected
  on-chain · analytics & monitoring (payments, totals, violations, errors from on-chain
  events) · in-app feedback (Supabase, insert-only RLS) · on-chain activity logging
  (proof-of-usage backbone)

## [0.2.0] — 2026-06-18 → 06-23 · Confidential ZK + open-economy trust layer

Built during Stellar Hacks: Real-World ZK; submitted to DoraHacks.

- **Added (ZK)** — Circom/BN254 compliance circuit (per-task range + daily-sum bounds +
  Poseidon commitments + Merkle whitelist membership) · Groth16 trusted setup (Hermez ptau) ·
  **on-chain BN254 verifier** with anchored-policy binding + replay guard, live on testnet
  with a replay-rejected proof · CSPRNG commitment salts
- **Added (trust)** — reputation-gated payees (whitelist OR earned ERC-8004-style trust) ·
  outcome-bound escrow (lock → release / refund) · bounded x402 buyer (policy gate before
  settle, live on-chain settle) · Treasury v2 on testnet
- **Added (app)** — multi-wallet support via StellarWalletsKit · real-time on-chain event
  feed · Vitest suites + 3-job CI (contracts / web / packages)

## [0.1.0] — 2026-06-03 · Bounded agent treasury (IBW 2026)

🏆 2nd place, AGENTIC category — Stellar Build On Hackathon (IBW 2026, Istanbul).

- **Added** — Soroban bounded treasury: payee whitelist · per-task limit · daily limit,
  enforced on-chain with per-task accounting (checks-effects-interactions, atomic
  constructor init) · autonomous-agent demo dashboard (prompt-injection rejected on-chain) ·
  muxed-account funding rail (zero-cost sub-address attribution) · spectral landing + pitch
  deck · build-time guard refusing the demo key off-testnet

[0.3.1]: https://github.com/eunomia-finance/eunomia/commits/main
[0.3.0]: https://github.com/eunomia-finance/eunomia/commits/main
[0.2.0]: https://github.com/eunomia-finance/eunomia/commits/main
[0.1.0]: https://github.com/eunomia-finance/eunomia/commits/main
