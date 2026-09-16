# Eunomia — Testnet Deployment

Network: **Stellar Testnet** (`Test SDF Network ; September 2015`)

## Identities

| Alias | Address | Role |
|-------|---------|------|
| alice | `GDPKXL6CNHUXBV4PM54CPTRZNQRYVTIMO4YGBW3M2MNSCMQ7TTNINXP6` | Admin + USDC issuer |
| agent | `GDAOXABLEOFZP2M4PRM7N6YKOKXWMPFOSLU35WL5ZQY4PQFHF3VCIDS6` | The bounded AI agent (signs `pay`) |
| service | `GDOMW4C36BUBBFJW3V4L22LUICOUKFVTPGOYU6UMZZ6D3ENEOCH4QCRT` | Whitelisted payee (has USDC trustline) |

## Contracts

| Contract | Address |
|----------|---------|
| USDC (SAC, issuer=alice) | `CDCEHPK4OJXVRA4JV7N56GR5SRD5KGGZ55BDSHKODGR72Y4KGS6A3Y2W` |
| **Eunomia Treasury** | `CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ` |
| Treasury wasm hash | `41c8bb1f0b4d9bd7b89c3a855ee87cb56971a256fe110cd2860d406dde040c2b` |
| **Compliance Verifier (ZK, hardened)** | `CCOLX7NEBDJRRVTPFVSK3UJLHMG3HO4UVYJW3NFBOTUG7Q7GOP63DBRH` |

## Policy (constructor)

- `daily_limit`  = `500000000`  (50 USDC, 7 decimals)
- `per_task_limit` = `100000000` (10 USDC)

## Verified on-chain (USDC has 7 decimals → 1 USDC = 10_000_000)

| Action | Result |
|--------|--------|
| Fund treasury (mint 500 USDC) | balance = `5000000000` ✅ |
| `is_payee(service)` | `true` ✅ |
| `is_payee(attacker)` | `false` ✅ |
| **Rogue pay → non-whitelisted** | `Error(Contract, #2)` PayeeNotWhitelisted ✅ rejected on-chain |

Full policy (legit pay + per-task `#3` / daily-limit `#4` rejection + per-task accounting +
day-rollover reset) is proven by the contract test suite — `cargo test` → **6/6 passing** —
and exercised live in the dashboard demo (6 core tests at v1; the suite has since grown — see the v3 section below). The treasury starts each demo clean at 500 USDC.

## Confidential compliance layer (ZK)

A Groth16 (BN254) proof, verified **on-chain** by the Compliance Verifier contract, attests that a
batch of agent payments obeyed policy — each ≤ per-task limit, Σ ≤ daily limit, every payee ∈ a
committed whitelist — **without revealing any amount or payee**. Payments are committed as
`Poseidon(amount, payee, salt)`; only the commitments + the proof go on-chain.

| Item | Value |
|------|-------|
| Compliance Verifier (hardened) | `CCOLX7NEBDJRRVTPFVSK3UJLHMG3HO4UVYJW3NFBOTUG7Q7GOP63DBRH` |
| Verifier wasm hash | `3afb9ef6ade22da54b7046f1dcb2a679a2dfd096d2de3dc863a3cd712e039c80` |
| **On-chain verify tx** | [`4438c949…cac2a`](https://stellar.expert/explorer/testnet/tx/4438c94952d6d06fbf6b205e07be1c28ea33c5e1422a5323e93572788b9cac2a) → emitted `ComplianceAttested` |
| **Replay rejected** | a 2nd verify of the same `periodId` traps (`already attested`) — replay guard live |

Verified statement (public signals `[dailyLimit, perTaskLimit, whitelistRoot, periodId, commitments[8]]`).

**Hardened (not just a math check).** The verifier anchors the owner's policy at deploy
(`__constructor(admin, daily_limit, per_task_limit, whitelist_root)`) and `verify()` requires the
proof's public `dailyLimit / perTaskLimit / whitelistRoot` to byte-match the anchor — so a valid
proof for some *self-chosen* policy can no longer attest. Each `periodId` is consumed once
(persistent guard), so a compliant proof can't be replayed to mask a later non-compliant period.
The verify call emitted `attested = { whitelist_root, period_id }` on-chain. Circuit witness tests
(`npm test` in `circuits/`) → **6/6**; contract tests (`cargo test -p compliance_verifier`) → **4/4**
(valid attest, tampered-proof trap, policy-mismatch trap, replay trap).

**Honesty note.** The ZK layer hides Eunomia's *compliance ledger* — Eunomia's storage and events carry
only commitments and a proof, never plaintext amounts or payees. If confidential mode also moves real
USDC via SAC transfers to revealed payees at settlement, those transfers stay visible at the
**token-contract layer**; transfer-level privacy is the shielded-pool roadmap. For the demo, real fund
movement is shown in the contrasting transparent treasury ("public mode"), while confidential mode
focuses on commitments + the on-chain-verified compliance proof.

**Toolchain:** Circom + snarkjs (Groth16 / BN254), public Hermez powers-of-tau; on-chain verifier
generated with `soroban-verifier-gen --curve bn254`, verified via Soroban's `bn254_multi_pairing_check`.

## Confidential Token policy — OpenZeppelin `ComplianceHooks` (live on testnet)

Eunomia's payee gate, packaged as an [OpenZeppelin + SDF Confidential Token](https://github.com/OpenZeppelin/stellar-contracts/tree/feat/confidential-verifier-ultrahonk)
`Policy` (`is_authorized(account, token) -> bool`). Wire it as a confidential token's
`compliance.policy` and every **private-amount** transfer is still bounded to authorized
payees by Eunomia — whitelist OR earned reputation. *The confidential token hides the amount;
Eunomia bounds the payee.*

| Item | Value |
|------|-------|
| **Eunomia Policy** (ComplianceHooks) | `CBWMYGL7E663UON6ER5KQX2JZZA4UDZZD4RIFEHGXXF2HMMBRAN7BLQF` |
| Deploy tx | [`8fb7f456…`](https://stellar.expert/explorer/testnet/tx/8fb7f45696f9d632596e960f61477654189dcc96f6af134843519958b9d13562) |
| `is_authorized(service)` — whitelisted | `true` ✅ (live) |
| `is_authorized(attacker)` — not whitelisted | `false` ✅ (live) |

Wiring at the confidential token's construction:

```rust
ComplianceConfig { policy: Some(EUNOMIA_POLICY), sac_passthrough: false }
```

Contract tests: `cargo test -p policy` → **2/2** (whitelist gate + reputation gate). The
end-to-end POC against a deployed OZ Confidential Token is the next step (their preview
needs Noir/UltraHonk + WSL2; tracked post-demo).

## Upgraded treasury v2 — reputation gate + escrow (live on testnet)

Deployed fresh (the original demo treasury keeps its addresses) to prove the two
Casper-adapted features on-chain. `zk-deployer` is admin + agent; token = native XLM SAC.

| Item | Value |
|------|-------|
| **Treasury v2** | `CDKQGDPLRX6DOCQTI5KVMZNGMPKMSRNGJRVCQ7LAAQGB2S5JKDCHXT5H` |
| Reputation Oracle (stellar-8004 stand-in) | `CCJFIEYFNPRTJVCOGOSESYC5Z6FHHHYAH36V7QTZEDPKESY6O5TPINKY` |

- **Reputation-gated payee** — a payee that is NOT whitelisted but scores ≥ threshold is paid on-chain: [tx `8d62132f…`](https://stellar.expert/explorer/testnet/tx/8d62132f4940f71758a351e68c8a7fe0f24b14207abf8c9c3eed6b3842c215cb)
- **Escrow release** — locked funds released to the payee on approval: [tx `df742d98…`](https://stellar.expert/explorer/testnet/tx/df742d987d85efb517a164b68e36c9302c4daf623c15dcaf416c73cbb26f6c4b)
- **Escrow refund** — an expired escrow unlocks back to free balance (`locked → 0`): [tx `b545aeb4…`](https://stellar.expert/explorer/testnet/tx/b545aeb489e8e36f73b195f299b5926f2387979cd71701bb428a8b099a718e46)

Contract tests at the v2 milestone: 14/14 (6 core + 3 reputation + 5 escrow); the current suite is larger — see the v3 section below.
The reputation source is an ERC-8004-style registry (`reputation_of(agent) → i128`); the
oracle above is a demo stand-in for trionlabs/stellar-8004, which is the production target.

## Treasury v3 + Treasury Registry — M2 agent infrastructure (live on testnet)

M2 ships agent
**sessions** (time-bound, spend-capped, instantly revocable — the ONLY spender while
active), the contract **lifecycle** (pause/resume, admin withdraw, limit updates, agent
rotation), and a **rolling 24h window** (hourly buckets — closes audit finding C2).
Deployed with the `seyit` identity; per-user deploys in the app instantiate v3.

| Item | Value |
|------|-------|
| **Treasury v3.4 wasm hash (current)** | `b813a1e7a3d2ddb1013dbaa11a41dcc1fbed984a30cfef9023dc199b12131a72` |
| v3.4 (2026-08-06, audit **H1**: `period_spent` + `whitelist_root` — the surfaces a compliance proof binds to) | [`901f0c39…f6c9`](https://stellar.expert/explorer/testnet/tx/901f0c390a63216a3eae842c306bf667f07f70c491258a05bbd1967bc0c3f6c9) |
| v3.4 smoke treasury (`daily=1000`, `per_task=300` stroops) | [`CBCBYWUM…JN36`](https://stellar.expert/explorer/testnet/contract/CBCBYWUMRD7L6GFTRJME232JUAEJ2B263N5O7MDGCMDFG4FI6GJ5JN36) |
| Treasury v3.3 wasm hash (previous) | `56a4d92660256b939433b51f35618515f4e77290f0978f72dcf64be719936795` |
| v3.3 upload tx (2026-08-05 audit: **M1** window holds a full 24h · **M3** daily limit bounds committed value) | [`71899b55…963c`](https://stellar.expert/explorer/testnet/tx/71899b55dd20d56b00bbdf09735736cc2b8f619d8f64482c92429b77ddcd963c) |
| v3.3 smoke treasury | [`CBGPB5JG…7OZK`](https://stellar.expert/explorer/testnet/contract/CBGPB5JGKGVGLY3HHTR6Z2G4OC6PI3NOWSE7WGBCHGIEC5MALCDZ7OZK) |
| Treasury v3.2 wasm hash (previous) | `475cfbe2ca79d7977c8e4d29438ae70b9d95a12cb2bfcd9fed4e4f7a26d798b2` |
| v3.2 upload tx (audit **C3** closure: instance-storage TTL auto-extended on every mutation) | [`d97fc74f…7ab1`](https://stellar.expert/explorer/testnet/tx/d97fc74fe0c2f750b27669690c9b7c58caffe4532501c7b98ed63afd5cbe7ab1) |
| Treasury v3.1 wasm hash (previous) | `7e103d8c177f3b46d4f7ccee695e7c9a92f5d3e5e55b96324173f923db9f9ae7` |
| v3.1 upload tx (audit hardening: `admin_cancel_escrow` + deadline validation + escrow TTL + whitelist/rep-gate events) | [`e12e748b…43b3c`](https://stellar.expert/explorer/testnet/tx/e12e748bdaafa39a08c2bfe56e009fa507f951d93af16455cb7ece019a243b3c) |
| Treasury v3 wasm hash | `2e6ab69e964b85a1954443d067d809c8519a20eb909fd16ac23abab318f184b8` |
| v3 upload tx | [`aa81495d…90bef`](https://stellar.expert/explorer/testnet/tx/aa81495db875d28715acb056614614bd04094b4aaf67f80b05ffefd0ec590bef) |
| v2.1 wasm hash (previous: escrow + free-balance guard) | `3f01e85ddf344e9f9298f828a43fe6acbb2666e5f36f6899d197a47021290280` |
| **Treasury Registry** | [`CBEPVXK6…4ZE7`](https://stellar.expert/explorer/testnet/contract/CBEPVXK6BN2FZ3IYHV5KQUGROFHNBWBYHKHRZ5U3O7UWGIOPFOFE4ZE7) |
| v3.2 smoke treasury | [`CAV6JJLD…BEAH`](https://stellar.expert/explorer/testnet/contract/CAV6JJLDKIGUFVU4MGYJH6VO7GALJKLT4I3DMDUU3TO2IDO2ERUCBEAH) |
| M2 smoke treasury (v3) | [`CCXC3DSK…XR7K`](https://stellar.expert/explorer/testnet/contract/CCXC3DSKCURJ76P3GNVCATBO572ZCZG6PHRPC22FTTGI7O3GFAHIXR7K) |

Verified live on the smoke treasury:

- **Rolling window** — a `pay` executes with the 24-bucket read footprint well inside tx
  limits; `day_spent` reports the rolling sum.
- **Pause** — `pay` while paused → `Error(Contract, #9)`; `admin_withdraw` still works
  while paused (exit paths never lock).
- **Limits** — `set_limits(100, 200)` → `Error(Contract, #11)`; after `set_limits`
  lowered per-task, an over-limit `pay` → `Error(Contract, #3)` immediately.
- **Session single-spender** — after `set_session`, the session key paid on-chain; the
  ROOT agent's signature could no longer authorise `pay` (auth requires the session
  agent); over-cap → `Error(Contract, #10)`; after `revoke_session` the root agent paid
  again and `get_session` → `None`.
- **Registry** — `register` + duplicate no-op + `treasuries_of` returning the treasury.

Contract tests: `cargo test -p treasury` → **59/59** · `cargo test -p treasury_registry` → **3/3** ·
`cargo test -p compliance_verifier` → **17/17**.

### v3.3 live verification (2026-08-05)

Proved on the smoke treasury above (`daily_limit = per_task_limit = 100` stroops), because
"the tests pass" is not the same claim as "the chain enforces it":

| Step | Result |
|---|---|
| `create_escrow(100)` | ✅ escrowed · `day_spent() = 100` — **the fix**: on v3.2 this read `0`, because only `release` charged the window |
| `locked()` | `100` |
| `create_escrow(1)` — a second commitment | ❌ `Error(Contract, #4)` ExceedsDailyLimit |
| `pay(1)` — a direct payment | ❌ `Error(Contract, #4)` |
| `admin_withdraw` | ✅ still succeeds — the owner's exit is never blocked by what the agent committed |

M1 (the 24h window boundary) is covered by `window_never_frees_before_a_full_24h` rather than
on-chain: proving it live would mean waiting out a real 23-25h window on testnet.

### H1 — proofs bound to chain state (2026-08-06)

The verifier redeploy that was held back for this is done. It is now multi-tenant and keeps
no policy of its own: `verify(treasury, proof, public)` re-reads the limits, the payee root
and the period's total from the treasury itself, and the circuit forces the proved batch to
equal that total (public signals 12 → 13, new `.zkey`, new verifier address).

| Item | Value |
|------|-------|
| **Compliance verifier (current)** | [`CCZKA3K4…D5Q`](https://stellar.expert/explorer/testnet/contract/CCZKA3K4SPIFWG7UBIY2CE7LPKPMCWROCHXZO2JAMYVVGU6TUKOWMD5Q) |
| verifier wasm hash | `84bdc367ff9abfcc00994b7480653135367a26b2a6ffee7e1a52650bad88a00d` |
| deploy tx | [`7e9ca5e5…115c`](https://stellar.expert/explorer/testnet/tx/7e9ca5e50d4e623a96904ea21651e13d373d5e970a16e05d4cf50bd26b53115c) |
| live attestation (`attested`, period 20670) | [`426e55d6…4606`](https://stellar.expert/explorer/testnet/tx/426e55d6ce0a9157c156190cee39dc2a1d302cf4c7f4f98cc930da5ad63b4606) |

Verified on chain against the v3.4 smoke treasury — the rejections matter more than the
acceptance, because H1 was precisely that nothing got rejected:

| Step | Result |
|---|---|
| a valid proof of a **fabricated** 350-unit batch, on a period the chain says was quiet | ❌ `Error(Contract, #9)` SpendMismatch — **the fix**: this is the 08-05 audit's attack, refused |
| attesting the current, still-open period | ❌ `Error(Contract, #6)` PeriodNotClosed |
| the period's real total (`period_spent` = 0) for a closed day | ✅ `attested` emitted · `last_period` → `20670` |
| the same period a second time | ❌ `Error(Contract, #8)` PeriodNotAdvancing |

An attestation over a period with **non-zero** spend needs that period to close first: the
smoke treasury spent 350 in period 20671, so
`npx tsx scripts/prove-and-submit.ts --treasury CBCBYWUM…JN36 --period 20671 --payments 100:11,200:22,50:33`
produces it once 20671 is over.

## Error codes

`1` InvalidAmount · `2` PayeeNotWhitelisted · `3` ExceedsTaskLimit · `4` ExceedsDailyLimit ·
`5` BelowReputationThreshold · `6` InsufficientFreeBalance · `7` EscrowNotFound · `8` DeadlineNotReached ·
`9` Paused · `10` ExceedsSessionLimit · `11` InvalidLimits · `12` InvalidDeadline

## Funding rail — muxed attribution

Pool account (classic G): `GD2NZKSMQW367OIFXRM4NP7RIW6YLDZLJ4C7253MDOKCFC4Q4IOO3427`

Each agent budget is a **zero-cost muxed (M...) sub-address** of the pool, derived by id
(1 = Research, 2 = Marketing, 3 = Ops). A client pays the M-address; Horizon attributes the
deposit via `to_muxed_id` — no memos, no new accounts. Verified live (5 XLM → budget #1,
tx `a13fdb5b…`). Funder in the demo = the `agent` key (stands in for a client wallet).

## ERC-8004 (trionlabs/stellar-8004) — testnet registries to integrate

| Registry | Testnet address |
|----------|-----------------|
| Identity | `CDE3K4COIAGWNNJQQLL26SYI3KBJF5FUDHXG5FA6GYDJCG7T5V7FIWZH` |
| Reputation | `CBZEAGIEI3HXMDRLF44KLQJQQOH6LCYWWSGJVSYQYQO2HQ6DDGZ7HT55` |
| Validation | `CC5USZRO26MOIAVNYTTJDS63C2OBBLREOAOET4CPF2EZWO3YFKLMO3SL` |

SDK: `@trionlabs/8004-sdk` · Agent id format: `stellar:testnet:{identityRegistry}#{agentId}`

## eunomia-mcp — Week-1 smoke (2026-09-14)

The MCP surface (`packages/mcp`, npm `eunomia-mcp`) read against a fresh v3.5 treasury and
the agent-credential handshake exercised end to end. The owner's signature is the `alice`
CLI identity here; the dashboard's Agent page signs the same `set_session` with a passkey
or wallet.

| Step | Value |
|---|---|
| **W1 treasury** (v3.5 wasm `82447206…9641`, admin = agent = alice, XLM, daily 100 / per-payment 10) | [`CDVCLLGG…YNJ2`](https://stellar.expert/explorer/testnet/contract/CDVCLLGGMV6MJSJZYCPJI36BG6SGKSWVD44PORHVVFRBTSACEABBYNJ2) |
| deploy tx | [`e40120a9…ffe8`](https://stellar.expert/explorer/testnet/tx/e40120a9f67214355e929e5b9c30062e28c4347605bfd20771d581593ca4ffe8) |
| fund 20 XLM (SAC transfer) | [`5998358a…6ee8`](https://stellar.expert/explorer/testnet/tx/5998358ae35efc934d748c166b606fd10256fdfe34e3fe3ddfb6216bc7266ee8) |
| `add_payee(service)` | [`3ed29c9a…27b2`](https://stellar.expert/explorer/testnet/tx/3ed29c9a5580d6dfecdc1640ba88a149c8159aadf93cb984b3c506e2e57027b2) |
| agent credential (`eunomia-mcp init`, key generated locally, friendbot-funded) | `GB4GJNEZ6KLZNU3TE2CHQFNPOEQL5SHPQ246OMRZRLKVVQNLZCDX2QXZ` |
| owner starts the Leash — `set_session(agent, +24h, 30 XLM)` | [`542b2f25…5c92`](https://stellar.expert/explorer/testnet/tx/542b2f253b0f5133c9d93c489bd887da9d0b8db2da51288c14332c7267455c92) |
| owner revokes — `revoke_session` | [`f2e95670…2286`](https://stellar.expert/explorer/testnet/tx/f2e95670cbea720f07a27e08aa9d513a959203f37f4107cfed3a1d3bb65e2286) |

`npm run smoke` (an MCP client spawning the built server over stdio) between those two
transactions, then after the revoke:

| Tool | Leash active | After revoke |
|---|---|---|
| `check_budget` | `canSpend: true` · `session.isThisAgent: true` · `spendableNow: "10"` · `decision(2.5).allowed: true` | `session: null` · `canSpend: false` · blocker *"No active Leash for this treasury — the owner must start one…"* |
| `list_allowed_payees` | `["GDOMW4C3…QCRT"]` (from `payee_add` events, confirmed by `is_payee`) | same, now also from the local cache (`cachedKnown: 1`) |
| `check_payee(attacker GAKSMBN6…)` / `(service)` | `allowed: false` | `allowed: true` |

Found and fixed on the way: the public RPC's `getEvents` scans at most ~10 000 ledgers per
call and returns an empty page **with a cursor**; a listing that stopped at "fewer events
than the limit" missed every payee older than the last slice. The listing now walks the
cursor to the tip (unit-tested with a fake pager).

## eunomia-mcp — Week-2 live run (2026-09-15)

`eunomia-mcp` 0.2.0 paying from the W1 treasury above with the Leash key, refused with the
contract's own codes, and asking the owner for an exception — every step on testnet. The
owner's signature is again the `alice` CLI identity; the dashboard's Agent page does the same
with a passkey or wallet ("Approve payee" on the request card).

| Step | Value |
|---|---|
| owner starts the Leash — `set_session(agent, +24h, 30 XLM)` | [`099dd99d…9206`](https://stellar.expert/explorer/testnet/tx/099dd99ddb88db95594c118d3cfcf55145119fd74ac29e596c7264ee20329206) |
| **first autonomous in-budget payment** — `pay` 2.5 XLM → `service`, signed by the agent key over MCP | [`e8d564ba…c8ba`](https://stellar.expert/explorer/testnet/tx/e8d564ba222324b1633df25f259d9c7ea57f1836c07e3215b20fd66e5d7dc8ba) |
| `pay` 15 XLM → `service` (per-payment cap 10) | refused in simulation, no fee: `stage: "simulation"`, `reasons: [{ code: 3, name: "ExceedsTaskLimit" }]` |
| `pay` 1 XLM → `supplier` (not whitelisted) | refused in simulation: `reasons: [{ code: 2, name: "PayeeNotWhitelisted" }]` |
| **first on-chain policy rejection** — `eunomia-mcp pay … --amount 15 --record-rejection` | [`24da989e…9055`](https://stellar.expert/explorer/testnet/tx/24da989ed9afe7739df315982c63523bec7cbe6124e5a1baf5ca7396ea9f9055) — ledger 4691756, **FAILED**, diagnostics `Error(Contract, #3)` |
| `request_exception` 1 XLM → `supplier` — `manageData` on the agent account, id `CDVCLLGG.mu2rj4ft` | [`56317111…80be`](https://stellar.expert/explorer/testnet/tx/56317111675026de28a298c3ec0bd531efa89b6204c7780d1f4c7e604e0d80be) |
| `check_exception` | `status: "pending"` · dashboard Agent page lists it with **Approve payee** |
| owner approves — `add_payee(supplier)` | [`46db1da9…3f16`](https://stellar.expert/explorer/testnet/tx/46db1da953ccf48722c82d395d97dd45fa6f5ca31a4629852ec87fc4f6983f16) |
| `check_exception` | `status: "approved"` — derived from the chain now accepting the payment |
| `pay` 1 XLM → `supplier` | [`abd31c1c…6603`](https://stellar.expert/explorer/testnet/tx/abd31c1ce92bb9106736914e22a31003d1071f7f75a10f0c8f03249d92856603) |
| `pay` closes the request it satisfied (`manageData` delete) | [`0cc83226…03c1`](https://stellar.expert/explorer/testnet/tx/0cc832263383f5925bbab2c4a9f2887c8d66186569016cac0c560283aeab03c1) · `check_exception` → `closed` |

How the rejection got on the ledger: the RPC's simulation already refuses an over-limit
`pay` (the contract runs in the host), so there is nothing to submit. `--record-rejection`
borrows the footprint and resource fee from a passing 1-stroop probe, attaches the invoker
auth entry bound to the real arguments, and submits — the transaction is included, fails
with the contract's error, and the same `Error(Contract, #3)` is read back out of its
diagnostic events. The MCP tool never does this on its own; it costs the agent a fee.

Found and fixed on the way: the binding's `Err` for a refused simulation carries an empty
message (the contract's error enum has no doc comments), so codes are read from the
simulation's error text — the same `Error(Contract, #N)` the CLI prints.

## Treasury factory — one signature from zero to a Leashed treasury (2026-09-16)

Creating a treasury used to be five owner-signed transactions (deploy, register, fund,
approve payee, start the Leash): seven passkey prompts for a new user. `treasury_factory`
does all of it in one `create(setup)` call under a single owner authorisation; its tests
assert exactly one root auth with four sub-invocations. It has no admin: the treasury wasm
(v3.5 `82447206…9641`) and the registry are pinned at deploy.

| Item | Value |
|---|---|
| **Factory** (wasm `14c205cb…7d4f`) | [`CAWLFTQ4…2OMS`](https://stellar.expert/explorer/testnet/contract/CAWLFTQ4V3ZPUWRVL5RGXBBA7FMJ26EXW37GGKCGKOXO4TKABEHF2OMS) |
| upload · deploy | [`64c76a7e…2561`](https://stellar.expert/explorer/testnet/tx/64c76a7e368172026288d891d0fbc1d83f5a60f94249cc356176601ed7d32561) · [`82044bfc…eb00`](https://stellar.expert/explorer/testnet/tx/82044bfc697f8141604184d6415098f3e9e8caba98483fa2ba46f4358f3beb00) |
| **wallet path** — `alice` (G-address) creates with policy 100/10, payee `service`, Leash for `GB4G…2QXZ` (24h, 30 XLM), 5 XLM funding, registry | one tx [`f20587e5…2004`](https://stellar.expert/explorer/testnet/tx/f20587e568eb16c2c01a067943f6f8392c67168fa6de0c420dff958fcf612004) → treasury [`CAIH6DW5…M4AT`](https://stellar.expert/explorer/testnet/contract/CAIH6DW5MBTPRBPJHISLVJJCDHKSD4AXEQW327IBM2K67ZHROQ76M4AT) — events `payee_add`, `session`, `transfer`, `regd`, `created` in that transaction |
| **passkey path** — a new smart wallet `CAW4DEJP…JKRV` on eunomia.finance (live Playwright run, virtual authenticator, relay-sponsored): policy 50/10, payee, Leash (25 XLM/24h), 5 XLM | one tx [`a24f01a1…f637`](https://stellar.expert/explorer/testnet/tx/a24f01a15ec6606d63e406b3fcd5efd597074513e188d97c17e9b8badabaf637) → treasury [`CBA6WVNB…QILT`](https://stellar.expert/explorer/testnet/contract/CBA6WVNBH7ECHQFVEYL6SY6SAEQKQVTUM4FXMLN5BJ5BJBVR74WKQILT); the authenticator's signature counter moved by **exactly one** across the create step |

`web/tests/e2e/passkey.live.spec.ts` (`npx playwright test --config playwright.live.config.ts passkey.live`)
drives that passkey path against production and reads policy, payee, Leash, balance, registry
entry and the running wasm hash back from the chain. Red since 08-07, green from this run.
The relay admits the factory by address (`web/src/lib/treasuryWasm.ts`), so the treasury it
deploys inside the call needs no separate sponsorship.
