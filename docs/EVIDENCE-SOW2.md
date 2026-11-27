# Instawards evidence — Eunomia, second Statement of Work (mainnet beta)

> **Draft.** Items marked _pending_ are filled in as the mainnet runs happen. Everything else
> below is live today and can be checked without a wallet.

Evidence for the second Instawards Statement of Work ("Mainnet beta"), laid out in the order of
the SOW's section 6.1. Every transaction is on **Stellar mainnet** and opens on stellar.expert.
The first SOW's evidence (testnet) stays in [`EVIDENCE.md`](EVIDENCE.md).

---

## Deliverable 1 — Mainnet beta

> *Planned evidence: mainnet contract IDs + stellar.expert links + repo release + live URL — v4
> contracts with the new limits (tests in CI); a tx where the contract refuses a payment above a
> per-payee or monthly cap; eunomia.finance served from Cloudflare; the indexer's weekly numbers
> for mainnet.*

| Evidence | Link |
| --- | --- |
| Treasury factory v4.1 (mainnet) | [`CBO5F4MR…FUPEB`](https://stellar.expert/explorer/public/contract/CBO5F4MRST2BH4W3SSXSQXKFBTK5Y5AWNTVDH47KO65MXJTBTYSFUPEB) — creates only XLM or USDC treasuries; deposit cap 500 XLM / 100 USDC per treasury while the contracts are unaudited |
| Treasury registry (mainnet) | [`CCQQBCR5…ZTNXB`](https://stellar.expert/explorer/public/contract/CCQQBCR55OZKAGHNIWOOX265XTYITLOAXITLTPJTZNYEOJYT2QDZTNXB) |
| The new v4 limits, in the contract | per-payee monthly cap (`set_payee_cap`, refusal `#14 ExceedsPayeeCap`) · calendar-month budget (`set_monthly_limit`, `#15 ExceedsMonthlyLimit`) · deposit cap (`#16 ExceedsDepositCap`) — [`contracts/treasury/src/lib.rs`](https://github.com/eunomia-finance/eunomia/blob/main/contracts/treasury/src/lib.rs) |
| Tests in CI | [CI runs](https://github.com/eunomia-finance/eunomia/actions/workflows/ci.yml) — contracts, web app, `eunomia-mcp` |
| **A payment refused above a per-payee cap, on mainnet** | [`4e222114…`](https://stellar.expert/explorer/public/tx/4e2221140ded4165694c0b5d38f71307d89ea85dfd752e0b4743cd058e2b5879) — a failed transaction (ledger 65631998, 23 November 2026): the agent asked the treasury for 0.2 USDC to an address the owner had capped at 0.35 USDC per month, with 0.3 already paid; the contract refused with `#14 ExceedsPayeeCap`. The cap itself was set in [`8a4d06ed…`](https://stellar.expert/explorer/public/tx/8a4d06ed587effa71fbbd7c16032f8bfd2d00a606844c706796f9273e95ed980). |
| App + relay on Cloudflare | [eunomia.finance](https://eunomia.finance) — the app, docs, RPC proxy and fee-sponsoring relay run as one Cloudflare Worker with static assets, with a strict Content-Security-Policy ([`web/scripts/headers.mjs`](https://github.com/eunomia-finance/eunomia/blob/main/web/scripts/headers.mjs)). The SOW said "Pages + Functions"; Workers with static assets is the same role on Cloudflare's current platform, and lets the relay keep its daily fee budget in a Durable Object. |
| npm releases with provenance | [`eunomia-mcp` 0.3.0 to 0.3.3](https://www.npmjs.com/package/eunomia-mcp?activeTab=versions) — published from GitHub Actions with SLSA provenance ([workflow](https://github.com/eunomia-finance/eunomia/blob/main/.github/workflows/publish-mcp.yml)) |
| Usage indexer on mainnet | [`workers/chain-indexer`](https://github.com/eunomia-finance/eunomia/tree/main/workers/chain-indexer) — reads treasury events from mainnet every 15 minutes into `chain_weekly` (treasuries, agent payments, refusals, repeat treasuries). Weekly numbers: _pending_ |

## Deliverable 2 — Agents pay real services

> *Planned evidence: short screen recording + mainnet tx hashes — an agent in Claude finds a
> service in the catalog, pays it from its task float and returns the result; the funding and
> the payment as mainnet tx hashes; the leftover swept back. Result of the direct-settlement test
> documented either way.*

| Evidence | Link |
| --- | --- |
| New MCP tools | `find_services` (the ROZO MPP Router catalog, Stellar mainnet USDC) · `fund_float` · `call_service` (pays x402 / MPP from the float) · `float_status` · `sweep_float` — [`packages/mcp`](https://github.com/eunomia-finance/eunomia/tree/main/packages/mcp) |
| Screen recording: agent in Claude finds a service, pays, returns the result | _pending_ |
| The run's treasury (USDC; 2/day, 0.5/payment, agent capped at 0.3/month) | [`CBZHAQ2V…NYQWR`](https://stellar.expert/explorer/public/contract/CBZHAQ2VFVIQR4ZY467ZK6KLEVVYX5ABGEUFEYXFOLG7NPIVIGXNYQWR) — created [`72efda9d…`](https://stellar.expert/explorer/public/tx/72efda9dd78197b6e0b3f7496428dc5c20e4c4901e057d1204d1b0ac3ee1b90f), funded with 2 USDC [`99077aba…`](https://stellar.expert/explorer/public/tx/99077aba376d44bd31cc5a8725558f9da3090e7518d7f3322035086761f78919) |
| Owner approves the agent's task budget once (0.5 USDC, 1 hour, payees: the agent's float + the catalog's address) | [`37927bdc…`](https://stellar.expert/explorer/public/tx/37927bdccc881b1a4e3dc37271679ec363341d85c03065c623d56a2555d57931) |
| Treasury funds the task float → agent's own account | 0.2 USDC — [`ec30a2be…`](https://stellar.expert/explorer/public/tx/ec30a2bec11aca3af437e1043a8cf78bdc3a4734fab0b55360d093d922011fb7) |
| Agent pays the service from the float | 10 paid calls, 0.027 USDC in total (23 November 2026): three page reads through `firecrawl_scrape` (0.002 each, e.g. [`2901921f…`](https://stellar.expert/explorer/public/tx/2901921fcde7dcdfb37d918f407cc7d3683458552bb6c50696f734c913719f65)) and seven images through `fal_flux_schnell` (0.003 each, e.g. [`87b04173…`](https://stellar.expert/explorer/public/tx/87b0417366fc3629713e4d0aa68af5cdd7d87748d23138418c2966188e030e5c)). No prompt after the one approval. |
| Leftover swept back to the treasury | 0.173 USDC — [`58a140de…`](https://stellar.expert/explorer/public/tx/58a140de63a1c3aa284cbaea1bf8adf785b370784cb05af28ab22fcc0516279d) |
| Direct-settlement test, documented | [`docs/MPP-DIRECT-SETTLEMENT.md`](MPP-DIRECT-SETTLEMENT.md) — **no**: today's MPP and x402 Stellar servers accept only a `G…` payer signing a plain token `transfer`, so a contract treasury cannot be the payer. The bounded float ships instead. |

## Deliverable 3 — Agent-requested task budgets + a simpler app

> *Planned evidence: screen recording + npm release + live app — the agent asks for a task
> budget, the owner approves once in the redesigned app, the agent completes the task without
> further popups; `eunomia-mcp init` writes the client config (shown on a clean machine).*

| Evidence | Link |
| --- | --- |
| Agent asks for a task budget | `request_budget` MCP tool → a signed link the owner opens; one approval sets amount, duration and allowed payees on-chain (`set_task_budget`) |
| npm release | [`eunomia-mcp`](https://www.npmjs.com/package/eunomia-mcp) 0.3.3 |
| Screen recording: ask → approve once in the redesigned app → task done without popups | _pending_ |
| `eunomia-mcp init` writes the client config on a clean machine | _pending_ |

---

## Builder beta — mainnet treasuries opened by builders

Each row is a builder outside the team who opened a capped treasury on mainnet with their own
wallet, funded it, and had their own agent buy from the service catalog. Setup blockers the
sessions exposed are listed underneath.

| Builder | Treasury | Funded | First paid task | Services paid | Leftover returned |
| --- | --- | --- | --- | --- | --- |
| 1 (27 November 2026) | [`CBIFWNBN…SPDJ`](https://stellar.expert/explorer/public/contract/CBIFWNBNEXMOTSDI3XCFW2TZ6F7MNVNLOKCWWD4CBNVZKBTLE5B5SPDJ) — created [`41235127…`](https://stellar.expert/explorer/public/tx/41235127585d4ae6c4958bd045d7b5deb6c98e1a413729c7108c67798ed2e7ff) | 2 USDC — [`d2825816…`](https://stellar.expert/explorer/public/tx/d2825816537031a97cabcaa707738380d0549f411f9f5a1787a88cb5ff925f51) | Float of 0.3 USDC to the agent's own account — [`2c7bf20f…`](https://stellar.expert/explorer/public/tx/2c7bf20f0197b80ee44a4bf561796977329449094a0f445a4bd4244e78bfca43) | Three services, 0.006 USDC: Soroban transaction history (`mercury_txs_by_contract`, 0.001 — [`846ae6e7…`](https://stellar.expert/explorer/public/tx/846ae6e709ebf25fe2cda99c3dc1acb34e94e5c800d2be190d28a8e52be0b846)), a page read (`firecrawl_scrape`, 0.002 — [`e90e1ee1…`](https://stellar.expert/explorer/public/tx/e90e1ee14bb5cef4c17f0101d56eeb90589005696c978e56d6f669b311da02ad)), an image (`fal_flux_schnell`, 0.003 — [`8f74a2a9…`](https://stellar.expert/explorer/public/tx/8f74a2a9a832a7e57a5cba16351aa094685dfe7114c04c61f6da0d2118955ee6)) | 0.294 USDC — [`4381fcc0…`](https://stellar.expert/explorer/public/tx/4381fcc09b70dfd88abf4794bd2333ca1b4173e346ba9d5a373c287fa196fa67) |
| 2 (27 November 2026, recorded session) | [`CD3D7ABH…EGGE`](https://stellar.expert/explorer/public/contract/CD3D7ABHDYLUPLLR3SDWX5VWSZZBNX4A2DFN2XJATMK4SKTEURFDEGGE) — created [`b84aab00…`](https://stellar.expert/explorer/public/tx/b84aab00854671fcd09de290146d047c4531c1531976174da52c16d624a79a6f) | 3 USDC — [`3b665dc1…`](https://stellar.expert/explorer/public/tx/3b665dc1ec4da4aac7b06518f600557a8e1561c76b8a8ac3c62eab374caec069) | Float of 0.1 USDC — [`f2488c86…`](https://stellar.expert/explorer/public/tx/f2488c86666ce0dcf06f0147b1fe93bd7dc4acefdccff2ec42bce3fe1409a71f) | Three paid calls, 0.007 USDC: two page reads (`firecrawl_scrape`, 0.002 each — [`7b2323c8…`](https://stellar.expert/explorer/public/tx/7b2323c8188507f65926f648e9494cd3a1d30c0bd2c64ed1e9ec2040d6087259), [`95c1e746…`](https://stellar.expert/explorer/public/tx/95c1e7469cefe8f486b85fdf29c93780d5ce9373a38d341ef072eebc0772f1cf)) and an image (`fal_flux_schnell`, 0.003 — [`8b3970ec…`](https://stellar.expert/explorer/public/tx/8b3970ec9337af37998dfe9806012ee1cf8bf8bdab11565b4b9edcae6620cb5a)) | _pending_ — 0.093 USDC still in the agent's account |
| 3 (27 November 2026) | [`CDMCRUTU…43ZO`](https://stellar.expert/explorer/public/contract/CDMCRUTUKTX5F25H642SIBYGIW3F7JKYGPCDQP2XBTP3C3GF5B6243ZO) — created [`27f842b7…`](https://stellar.expert/explorer/public/tx/27f842b761f5e8015b0f08b40288fba06252ce72bdd683834a63d2ef089ad5e3) | 3 USDC — [`3a1a0a69…`](https://stellar.expert/explorer/public/tx/3a1a0a6935cecedd8bea442426886b9d1d1e381eafe2e50b0a0d95ed78b7ef98) | Float of 0.1 USDC — [`f125bf65…`](https://stellar.expert/explorer/public/tx/f125bf65c92cbc0964ba179e81a5a99c3a9fdf60e0fe3593f7433f6ab69d8c86) | A page read (`firecrawl_scrape`, 0.002 — [`374690f5…`](https://stellar.expert/explorer/public/tx/374690f5f3dd939875d97d071269dd19f9456b732aaf42b9885967a9cda6820c)) | _pending_ — the sweep was refused for its fee (see blockers); 0.098 USDC still in the agent's account |

Builders 2 and 3 connected their agents with the one-button flow that came out of builder 1's
session: the account, the three payee approvals and the Leash were five signatures in forty
seconds (builder 2: [`b60ef852…`](https://stellar.expert/explorer/public/tx/b60ef85244aeea82f8f352a41b087794f8a384d391689437c173d06b4ec38745) to [`27cf4346…`](https://stellar.expert/explorer/public/tx/27cf4346737a6737d71fffc2305256a13760704d8ac86d717d05c824670ac951)), and each agent added its own USDC trustline on its first float.

**Setup blockers found in these sessions**

| Blocker | Status |
| --- | --- |
| Claude Desktop on Windows showed no Eunomia tools after `init --client claude-desktop` ran without an error: the app keeps its config in a folder `init` did not write to, and rewrites the file when it closes. Two builders lost about two hours here | A repair script found and fixed the file on both machines ([`scripts/fix-claude-desktop.js`](../scripts/fix-claude-desktop.js)); `init` writes the packaged install's folder too from 0.3.5. Still open: `init` should refuse to write while Claude Desktop is running |
| A sweep was refused with `txInsufficientFee` and then dropped: the agent bid the 100-stroop minimum while mainnet was at 79% of capacity and contract calls cleared at 200 | Fixed in 0.3.5 — the agent bids up to 0.001 XLM and is charged what the ledger clears at |
| The command was pasted into the Claude chat instead of a terminal; Node.js was not installed on one machine | Open — the Agent page should say "open PowerShell / Terminal" and check for Node |
| A builder connected an agent to a treasury that was still empty, and read the payee count as the balance | Open — the Agent page should say when the treasury holds nothing |
| Claude Code in auto mode blocks `fund_float` as a risky action until the user says they allow it | Not ours to remove; the agent says what to type |
| The app is English only, which slowed every Turkish-speaking builder | Open |
| No service could be paid after mainnet moved to protocol 30: the pinned Stellar SDK could not read the new ledger header, so the agent stopped before signing | Fixed the same day in `eunomia-mcp` 0.3.3 (SDK 16.4.1); the first paid call after the fix is builder 1's `846ae6e7…` |
| A request body the model sent as serialised JSON was refused by the service ("Request body must be a JSON object") | Fixed in 0.3.3 |
| Approving a task budget does not approve its payees: the builder approved the budget link and the agent still could not pay, until the two service addresses were added on the Payments page | Fixed the same day for the Leash path — **Connect agent** approves the payees in the same run of signatures. The budget-link card is unchanged |
| Moving to a new `eunomia-mcp` release has no path that keeps the agent's key: `init --force` makes a new key, which then needs XLM, a trustline and a new Leash | Fixed in 0.3.4 — `init` run again keeps the key |
| A fresh agent account needs XLM and a USDC trustline before it can hold a float; these are two separate manual steps | Fixed in 0.3.4 — **Connect agent** opens the account, the agent adds its own trustline |

**Short interviews (asked right after the session)**

| Builder | Approve each payment, or once per task? | Are the daily and per-payment limits enough? | What would you really use it for? |
| --- | --- | --- | --- |
| 1 | Each payment | Enough as they are | Buying international flight tickets |

## Security before real money

Before the first real-money runs a fifth review covered the contracts and everything off-chain;
the six off-chain findings were fixed and deployed on 17 November 2026 — see
[`SECURITY.md`](https://github.com/eunomia-finance/eunomia/blob/main/SECURITY.md) and
[`CHANGELOG.md`](https://github.com/eunomia-finance/eunomia/blob/main/CHANGELOG.md).

## Honest scope

- **Capped beta.** Deposits are capped per treasury (500 XLM / 100 USDC) because the contracts
  have had internal reviews, not an independent audit.
- **The float leaves the contract.** Sellers accept only a `G…` payer, so the agent spends from a
  small float in its own account; the contract bounds how much can reach it, and the rest is
  swept back.
- Out of scope, as the SOW says: audit, TRY ramp, Turkish bill pay, cross-chain.
