# eunomia-mcp

Connect any MCP-capable AI agent (Claude Code, Claude Desktop, …) to a [Eunomia](https://eunomia.finance) treasury on Stellar.

The agent gets a **scoped, revocable credential**. The treasury contract enforces the owner's budget **on-chain** — per-payment cap, rolling 24h limit, approved payees, a time-bound session cap — and refuses anything outside it. The agent never holds the funds and never sees the owner's key.

> Week 2 of the Instawards sprint: the agent now **pays** (direct or from an x402 payment requirement), reads every refusal as the **contract's own error code**, and can **ask the owner for an exception** that the dashboard shows. Live **testnet** only; npm publish lands in Week 3. Nothing here touches mainnet.

## Connect your agent

**1. Create the agent's credential** (on the machine that runs the agent):

```bash
npx eunomia-mcp init --treasury <C…treasury id>
```

This generates an Ed25519 key, funds it on testnet (it pays its own transaction fees), stores it at `~/.eunomia/testnet/<treasury>.json` (mode 0600) and prints the **agent public key**. The secret never leaves this machine.

**2. The treasury owner authorises that key** — Eunomia dashboard → your treasury → **Agent** → paste the public key, choose a spending cap and a duration → **Start Leash**. That signs one `set_session` transaction with the owner's passkey or wallet. The owner revokes it from the same page at any time (`revoke_session`), instantly.

**3. Add the server to your MCP client** — `init` prints the snippet; `eunomia-mcp config` prints it again:

```bash
# Claude Code
claude mcp add eunomia -e EUNOMIA_TREASURY=<C…> -e EUNOMIA_NETWORK=testnet -- npx -y eunomia-mcp
```

```json
// Claude Desktop (claude_desktop_config.json) or any JSON-configured client
{ "mcpServers": { "eunomia": { "command": "npx", "args": ["-y", "eunomia-mcp"],
  "env": { "EUNOMIA_TREASURY": "<C…>", "EUNOMIA_NETWORK": "testnet" } } } }
```

**4. Check it:** `eunomia-mcp status --treasury <C…>` prints what the agent may spend right now — `canSpend: true` with `session.isThisAgent: true` means the handshake worked.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `check_budget` | `amount?` (e.g. `"2.5"`) | Per-payment cap, rolling 24h limit and remainder, free balance, the Leash session (agent, cap, spent, expiry, whether it is *this* agent), pause state, `canSpend`, `spendableNow`, human-readable `blockers`. With `amount`: a pre-flight `decision` carrying the **contract's own error codes** (`ExceedsTaskLimit`, `ExceedsDailyLimit`, `ExceedsSessionLimit`, …). |
| `list_allowed_payees` | — | Owner-approved payees, each **re-verified on-chain** with `is_payee`, plus the reputation gate if the owner set one, and a `coverage` block saying how the list was built. |
| `check_payee` | `address` | The exact on-chain answer to "will this treasury pay this address?". |
| `pay` | `to` + `amount` (+ `taskId?`), **or** `x402` (one element of a 402 response's `accepts[]`) | Signs `pay(task_id, to, amount)` with the Leash key and submits it. `paid: true` + `txHash` + explorer link, or `paid: false` with the `stage` the refusal came from (`preflight` / `simulation` / `onchain`) and `reasons[]` in the contract's codes. A refusal is not an error — it is the policy working. |
| `request_exception` | `to`, `amount` (+ `taskId?`) | Files a request the owner sees on the dashboard's Agent page (see below); returns its `id`, the request `txHash`, the `reasons` and what the owner can do about each. Refuses to file when the payment is already inside policy. |
| `check_exception` | `id` (+ `close?`) | `approved` when the treasury would now accept that payment (then call `pay`), `pending` while it would still refuse, `closed` when the entry is gone. `close: true` removes the entry. |

Every call reads the chain fresh. Amounts are decimal strings in the treasury's token (XLM or USDC — both 7 decimals), with raw stroops alongside where an agent would compute with them.

### Refusals are coded, at every stage

`pay` never guesses. Blockers the chain cannot express (no credential, a Leash for another key, an expired one) are named before anything is signed. Then the contract itself runs in simulation and its `Error(Contract, #N)` becomes `{ code, name, detail }` — `3 ExceedsTaskLimit`, `2 PayeeNotWhitelisted`, `10 ExceedsSessionLimit`, … — with no fee spent. If state moves between simulation and apply (another spender, a revoke), the transaction lands as failed and the same code is read back out of its diagnostics, with the hash.

### x402

Stellar's x402 has one scheme, `exact`. Hand `pay` an `accepts[]` entry from a `402 Payment Required` response (or decode the `PAYMENT-REQUIRED` header with the SDK's `decodePaymentRequired`) and it is vetted — scheme, network, the treasury's asset — then settled through the treasury's on-chain `pay()` to `payTo`, under the same policy as any other payment. The facilitator handshake is **not** part of this package (Instawards scope): the funded-agent-account interop with the official `@x402/stellar` client lives in the repo's `packages/x402`.

### Exceptions, without a server

`request_exception` writes the request as a **data entry on the agent's own Stellar account** (`manageData`, 56-byte payload: payee, amount, task, the reason codes, time — name `eunomia.x.<treasury>.<id>`). Only the Leash key can write there, so the owner's dashboard reads it straight from Horizon and trusts nothing but the chain. The owner resolves it the way rules are always changed — approve the payee, raise a limit, resume, start a bigger Leash — and the request counts as **approved the moment the contract would accept the payment**; there is no off-chain approval flag to forge. A successful `pay` closes the request it satisfied; `check_exception` with `close: true` withdraws one. Each open request holds the account's 0.5 XLM base reserve until it is closed.

## CLI

```bash
eunomia-mcp pay --treasury <C…> --to <G…|C…> --amount 2.5 [--task 402]
```

Prints the same JSON the tool returns. Exit code `0` paid, `3` refused by policy, `1` error. Add `--record-rejection` to submit a refused payment anyway so the refusal is **recorded on the ledger** (a failed transaction with the contract's error in its diagnostics — costs the agent one fee). That is how the evidence in `DEPLOYMENT.md` was produced; the MCP tool never does it on its own.

## How the credential works

- The treasury's `set_session(agent, valid_until, limit)` makes one key the **only** spender while active, capped and time-bound; `revoke_session` ends it instantly. That is the whole credential — there is no API key, no server-side secret, nothing to leak but a bounded testnet key.
- Root agent, admin and owner keys are never on the agent's machine. The session key signs `pay` (and its own exception requests) locally; the owner only ever signs policy changes.
- `EUNOMIA_AGENT_SECRET` overrides the file (CI, containers). `EUNOMIA_HOME` moves the store.

## Limits, honestly

- **Payee listing is rebuilt from events.** The whitelist is not enumerable on-chain, so `list_allowed_payees` replays the contract's `payee_add` / `payee_rm` events (the public RPC keeps ~7 days) and a local cache, then confirms each address with `is_payee`. A payee approved before that window on a machine that never saw it will not be listed — `check_payee` is exact for any address.
- **Exception requests are visible while the Leash is.** The dashboard reads them from the session agent's account; after a revoke there is no agent to read. There is no "deny" signal yet — an unresolved request simply stays pending until the agent closes it (Week 3 folds requests into the activity feed).
- **Testnet only** in this release. `EUNOMIA_NETWORK=pubnet` requires `EUNOMIA_RPC_URL` and a key you fund yourself.
- `check_budget` is a pre-flight. The contract is the final word at payment time; the two use the same rules and the same error codes.

## SDK

Everything the server does is exported:

```ts
import { computeBudget, makeClient, readTreasury, resolveNetwork, payFromTreasury, contextFromEnv } from "eunomia-mcp";

const net = resolveNetwork(process.env);
const client = makeClient(net, treasuryId);
const snapshot = await readTreasury(client, treasuryId);
const budget = computeBudget(snapshot, agentPublicKey, Math.floor(Date.now() / 1000), 25_000_000n);

const ctx = contextFromEnv({ ...process.env, EUNOMIA_TREASURY: treasuryId });
const outcome = await payFromTreasury(ctx, { to, amount: 25_000_000n, taskId: 402n });
```

## Contracts

Deployed addresses, wasm hashes and the on-chain evidence for every claim above live in the repo's [`DEPLOYMENT.md`](../../DEPLOYMENT.md). Architecture and the ZK compliance layer: [eunomia.finance/docs](https://eunomia.finance/docs).

## Develop

```bash
npm install
npm test          # unit tests (node:test)
npm run build     # dist/
EUNOMIA_TREASURY=<C…> npm run smoke                 # read tools through the MCP protocol against testnet
EUNOMIA_TREASURY=<C…> SMOKE_WRITE=1 npm run smoke   # + pay / request_exception / check_exception (spends testnet XLM)
```

`src/bindings/treasury.ts` is a vendored copy of `packages/treasury-client/src/index.ts` and `src/exceptionCodec.ts` is copied verbatim into the dashboard (`web/src/lib/exceptionCodec.ts`); `npm run check:bindings` and `npm run check:codec` (both in CI) keep the copies byte-identical.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
