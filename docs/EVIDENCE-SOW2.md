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
| **A payment refused above a per-payee cap, on mainnet** | _pending_ |
| App + relay on Cloudflare | [eunomia.finance](https://eunomia.finance) — the app, docs, RPC proxy and fee-sponsoring relay run as one Cloudflare Worker with static assets, with a strict Content-Security-Policy ([`web/scripts/headers.mjs`](https://github.com/eunomia-finance/eunomia/blob/main/web/scripts/headers.mjs)). The SOW said "Pages + Functions"; Workers with static assets is the same role on Cloudflare's current platform, and lets the relay keep its daily fee budget in a Durable Object. |
| npm releases with provenance | [`eunomia-mcp` 0.3.0 and 0.3.1](https://www.npmjs.com/package/eunomia-mcp?activeTab=versions) — published from GitHub Actions with SLSA provenance ([workflow](https://github.com/eunomia-finance/eunomia/blob/main/.github/workflows/publish-mcp.yml)) |
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
| Treasury funds the task float → agent's own account | _pending_ |
| Agent pays the service from the float | _pending_ |
| Leftover swept back to the treasury | _pending_ |
| Direct-settlement test, documented | [`docs/MPP-DIRECT-SETTLEMENT.md`](MPP-DIRECT-SETTLEMENT.md) — **no**: today's MPP and x402 Stellar servers accept only a `G…` payer signing a plain token `transfer`, so a contract treasury cannot be the payer. The bounded float ships instead. |

## Deliverable 3 — Agent-requested task budgets + a simpler app

> *Planned evidence: screen recording + npm release + live app — the agent asks for a task
> budget, the owner approves once in the redesigned app, the agent completes the task without
> further popups; `eunomia-mcp init` writes the client config (shown on a clean machine).*

| Evidence | Link |
| --- | --- |
| Agent asks for a task budget | `request_budget` MCP tool → a signed link the owner opens; one approval sets amount, duration and allowed payees on-chain (`set_task_budget`) |
| npm release | [`eunomia-mcp`](https://www.npmjs.com/package/eunomia-mcp) 0.3.1 |
| Screen recording: ask → approve once in the redesigned app → task done without popups | _pending_ |
| `eunomia-mcp init` writes the client config on a clean machine | _pending_ |

---

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
