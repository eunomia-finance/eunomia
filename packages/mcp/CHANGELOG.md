# eunomia-mcp Changelog

Notable changes to the `eunomia-mcp` package, separated from the main Eunomia application changelog.

## [Unreleased]

- **Added** — `find_services` to discover paid APIs from the ROZO MPP Router catalog.
- **Added** — `fund_float` and `sweep_float` to fund the agent's account from the treasury and return unused funds.
- **Added** — `call_service` to pay HTTP 402 payment requirements through the official x402 client, subject to token, price, payment-cap, approved-payee and task-budget restrictions.
- **Added** — `float_status` to inspect the agent's balance and recorded service purchases.
- **Added** — `request_budget` to request a task-specific budget that the treasury owner can approve with one signature.
- **Added** — `init --client claude-desktop|cursor|claude-code` to merge MCP client configuration while preserving a backup.
- **Added** — `trustline` to prepare an agent account for USDC on mainnet.
- **Verified** — End-to-end float spending on testnet. Direct settlement of MPP charges was not supported by the tested facilitator; see [`docs/MPP-DIRECT-SETTLEMENT.md`](https://github.com/eunomia-finance/eunomia/blob/main/docs/MPP-DIRECT-SETTLEMENT.md).

## [0.2.2] — 2026-10-10

- **Fixed** — Refuse payment to a payee without the treasury token's trustline before paying; `check_payee` reports `canReceive`, and no unapprovable exception is filed (`a64d20e`).
- **Fixed** — A config that still contains the docs' `<C…>` placeholder reports the invalid value and where to find the real treasury ID, rather than a generic "Invalid contract ID" (`a01bfa3`).

## [0.2.1] — 2026-09-18

- **Added** — Amounts include their token unit.

## [0.2.0] — 2026-09-18

- **Added** — Initial MCP package with treasury payment and exception-request workflows.
