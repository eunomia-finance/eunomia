# Instawards evidence — Eunomia

Evidence for the Instawards Statement of Work (submitted 1 September 2026, sprint started
upon approval on 14 September), laid out in the order of the SOW's section 6.1. Every
transaction is on **Stellar testnet** and opens on stellar.expert; nothing needs a wallet
or any tooling to look at.

**Five-minute check:** open the [npm package](https://www.npmjs.com/package/eunomia-mcp),
the [docs](https://eunomia.finance/docs), and the four transactions in
[the loop](#the-loop-on-28-29-september) — three payments inside the budget, one refused by
the contract, and the period closed with a zero-knowledge attestation.

---

## Deliverable 1 — `eunomia-mcp`

> *Planned evidence: npm package + GitHub repo (Apache-2.0) + docs URL + short screen
> recording.*

| Evidence | Link |
| --- | --- |
| npm package, installable | [`eunomia-mcp`](https://www.npmjs.com/package/eunomia-mcp) — `npx -y eunomia-mcp --help` |
| Source (Apache-2.0) with CI | [`packages/mcp`](https://github.com/eunomia-finance/eunomia/tree/main/packages/mcp) · [CI runs](https://github.com/eunomia-finance/eunomia/actions/workflows/ci.yml) |
| "Connect your agent" quickstart | [eunomia.finance/docs/connect-your-agent](https://eunomia.finance/docs/connect-your-agent) |
| Tools | `check_budget` · `list_allowed_payees` · `check_payee` · `pay` (incl. x402 requirements) · `request_exception` · `check_exception` |
| Scoped, revocable agent credential | the agent makes its own key; the owner authorises its public half with a cap and an expiry: [`set_session`](https://stellar.expert/explorer/testnet/tx/542b2f253b0f5133c9d93c489bd887da9d0b8db2da51288c14332c7267455c92) · [`revoke_session`](https://stellar.expert/explorer/testnet/tx/f2e95670cbea720f07a27e08aa9d513a959203f37f4107cfed3a1d3bb65e2286) |
| Short recording: an MCP client listing and calling the tools | *link added on submission* |

## Deliverable 2 — "Agent on a leash"

> *Planned evidence: recorded demo + testnet tx hashes + live walkthrough URL; a one-command
> check of the ZK attestation.*

### The loop on 28–29 September

Treasury [`CDVCLLGG…YNJ2`](https://stellar.expert/explorer/testnet/contract/CDVCLLGGMV6MJSJZYCPJI36BG6SGKSWVD44PORHVVFRBTSACEABBYNJ2)
(XLM; per-payment cap 10, rolling 24h cap 100). The agent pays with the published
`eunomia-mcp` 0.2.1 from npm, signing with its own Leash key — no prompt to the owner.

| Step | Transaction |
| --- | --- |
| Owner puts the agent on a Leash (30 XLM, 7 days) | [`37ee3c6f…`](https://stellar.expert/explorer/testnet/tx/37ee3c6f123339cbbcae4308213b5e0539f5f9e236821a17e2c5067628e69ea7) |
| Agent pays 2.5 XLM → `service` | [`54deb8b7…`](https://stellar.expert/explorer/testnet/tx/54deb8b7b21fdd6e45ed3b6591a1758a4f53f248749bde84f591f7f5b51645ea) |
| Agent pays 4 XLM → `supplier` | [`0935cb2e…`](https://stellar.expert/explorer/testnet/tx/0935cb2e85afd10427f918e22b56f39ce8e85d4a32b2a2c789352442fdf31401) |
| Agent pays 1.5 XLM → `service` | [`b6b4ea45…`](https://stellar.expert/explorer/testnet/tx/b6b4ea452400166924e60ba1bbf697817c676c226d920196aafe677990e4c235) |
| Agent tries 15 XLM — **refused by the contract** (`Error(Contract, #3)` ExceedsTaskLimit), recorded on the ledger as a failed transaction; no funds moved | [`d48e7ff8…`](https://stellar.expert/explorer/testnet/tx/d48e7ff8fdc0f93a5972d0d783e3861f29a3baebb96c5f82b2c9ff545e00f3b5) |
| Owner publishes the payee root the proof is checked against — rebuilt from the two payees' real addresses, each confirmed by the treasury | [`714ed902…`](https://stellar.expert/explorer/testnet/tx/714ed9028d1b4674bc7f14db3b8719887e2039ae166aecf2a7a92b94621261b2) |
| **The period closes with a ZK attestation**: the day's payments were each ≤ 10, totalled ≤ 100, went only to payees in the root, and add up to exactly the 8 XLM the treasury recorded — amounts and payees not revealed | [`4abba703…`](https://stellar.expert/explorer/testnet/tx/4abba7034041f956e417cd3c6b180d170439033f0e09afd0ddca702b67944940) — 29 Sept, ledger 4933698, `attested` (period 20724) |

**Check the attestation yourself** — one command, no keys, no ZK tooling:

```bash
git clone https://github.com/eunomia-finance/eunomia && cd eunomia/packages/prover && npm install
npx tsx src/check-attestation.ts --tx 4abba7034041f956e417cd3c6b180d170439033f0e09afd0ddca702b67944940
```

It asks the on-chain verifier to re-run the Groth16 check on the proof inside the
transaction and compares every public input with the treasury's own on-chain limits, payee
root and recorded total, then prints `attested`. Payee root members, to rebuild the root:
`GDOMW4C36BUBBFJW3V4L22LUICOUKFVTPGOYU6UMZZ6D3ENEOCH4QCRT` (service),
`GAF74ROXHKLAW4JKHJQVYR3O27VTQJF7QA4GLWDBTZACWEPKMPCAVCEZ` (supplier).

### More of the same loop

| | |
| --- | --- |
| First autonomous in-budget payment (15 Sept) | [`e8d564ba…`](https://stellar.expert/explorer/testnet/tx/e8d564ba222324b1633df25f259d9c7ea57f1836c07e3215b20fd66e5d7dc8ba) |
| First on-chain policy rejection (15 Sept, `#3`) | [`24da989e…`](https://stellar.expert/explorer/testnet/tx/24da989ed9afe7739df315982c63523bec7cbe6124e5a1baf5ca7396ea9f9055) |
| Exception: agent files a request → owner approves the payee → agent pays → request closed | [request](https://stellar.expert/explorer/testnet/tx/56317111675026de28a298c3ec0bd531efa89b6204c7780d1f4c7e604e0d80be) → [approve](https://stellar.expert/explorer/testnet/tx/46db1da953ccf48722c82d395d97dd45fa6f5ca31a4629852ec87fc4f6983f16) → [pay](https://stellar.expert/explorer/testnet/tx/abd31c1ce92bb9106736914e22a31003d1071f7f75a10f0c8f03249d92856603) → [close](https://stellar.expert/explorer/testnet/tx/0cc832263383f5925bbab2c4a9f2887c8d66186569016cac0c560283aeab03c1) |
| An agent started from an empty directory with the npm package pays from a TRY-funded USDC treasury; its payment to a stranger is refused (`#2`) | [`55e1d57a…`](https://stellar.expert/explorer/testnet/tx/55e1d57ac10b71b88f12f7403efadcc8c44a6b46209f86759293616f154a6bfe) |

| Evidence | Link |
| --- | --- |
| Live walkthrough | [eunomia.finance](https://eunomia.finance) → create a treasury (passkey, no wallet needed) → **Agent → Run the agent**: pays, is refused, files the request — three real transactions, visible in the activity feed and the ledger |
| Demo agent loop (source) | [`web/src/lib/agentLoop.ts`](https://github.com/eunomia-finance/eunomia/blob/main/web/src/lib/agentLoop.ts) · proof pipeline [`circuits/scripts/prove-and-submit.ts`](https://github.com/eunomia-finance/eunomia/blob/main/circuits/scripts/prove-and-submit.ts) |
| ~3-minute recorded demo | *link added on submission* |

## Deliverable 3 — Playbook + comparison

> *Planned evidence: repo docs (playbook + COMPARISON.md) + live docs page.*

| Evidence | Link |
| --- | --- |
| Developer playbook | [`docs/PLAYBOOK.md`](https://github.com/eunomia-finance/eunomia/blob/main/docs/PLAYBOOK.md) · [live](https://eunomia.finance/docs/playbook) |
| Sourced ecosystem comparison | [`COMPARISON.md`](https://github.com/eunomia-finance/eunomia/blob/main/COMPARISON.md) · [live](https://eunomia.finance/docs/comparison) |
| Deployed contract addresses | [eunomia.finance/docs/contracts](https://eunomia.finance/docs/contracts) · [`DEPLOYMENT.md`](https://github.com/eunomia-finance/eunomia/blob/main/DEPLOYMENT.md) |

---

## Honest scope

- **Testnet only**, as the SOW's out-of-scope list says; the TRY anchor is a sandbox.
- **The ZK layer attests after the fact.** `pay()` does not wait for a proof; the proof
  shows a closed period stayed inside the rules. It proves the total and each payment's
  bound, not which payment went where.
- **The payee root is published by the owner**, now rebuilt from real addresses each
  confirmed on-chain — checkable, but the contract cannot force it to list every approved
  payee ([`SECURITY.md`](https://github.com/eunomia-finance/eunomia/blob/main/SECURITY.md)).
- The Groth16 setup is single-party (a multi-party ceremony is a mainnet prerequisite);
  the contracts have had internal reviews, not an independent audit.
