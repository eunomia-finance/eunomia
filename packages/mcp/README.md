# eunomia-mcp

Connect any MCP-capable AI agent (Claude Code, Claude Desktop, …) to a [Eunomia](https://eunomia.finance) treasury on Stellar.

The agent gets a **scoped, revocable credential**. The treasury contract enforces the owner's budget **on-chain** — per-payment cap, rolling 24h limit, approved payees, a time-bound session cap — and refuses anything outside it. The agent never holds the funds and never sees the owner's key.

> Week 1 of the Instawards sprint: credential create/revoke + the read tools below, against the live **testnet** contracts. The `pay` tool (x402) and `request_exception` land next. Nothing here touches mainnet.

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

Every call reads the chain fresh. Amounts are decimal strings in the treasury's token (XLM or USDC — both 7 decimals), with raw stroops alongside where an agent would compute with them.

## How the credential works

- The treasury's `set_session(agent, valid_until, limit)` makes one key the **only** spender while active, capped and time-bound; `revoke_session` ends it instantly. That is the whole credential — there is no API key, no server-side secret, nothing to leak but a bounded testnet key.
- Root agent, admin and owner keys are never on the agent's machine. The MCP server signs nothing in Week 1; from Week 2 the session key signs `pay` locally.
- `EUNOMIA_AGENT_SECRET` overrides the file (CI, containers). `EUNOMIA_HOME` moves the store.

## Limits, honestly

- **Payee listing is rebuilt from events.** The whitelist is not enumerable on-chain, so `list_allowed_payees` replays the contract's `payee_add` / `payee_rm` events (the public RPC keeps ~7 days) and a local cache, then confirms each address with `is_payee`. A payee approved before that window on a machine that never saw it will not be listed — `check_payee` is exact for any address.
- **Testnet only** in this release. `EUNOMIA_NETWORK=pubnet` requires `EUNOMIA_RPC_URL` and a key you fund yourself.
- `check_budget` is a pre-flight. The contract is the final word at payment time; the two use the same rules and the same error codes.

## SDK

Everything the server does is exported:

```ts
import { computeBudget, makeClient, readTreasury, resolveNetwork } from "eunomia-mcp";

const net = resolveNetwork(process.env);
const client = makeClient(net, treasuryId);
const snapshot = await readTreasury(client, treasuryId);
const budget = computeBudget(snapshot, agentPublicKey, Math.floor(Date.now() / 1000), 25_000_000n);
```

## Contracts

Deployed addresses, wasm hashes and the on-chain evidence for every claim above live in the repo's [`DEPLOYMENT.md`](../../DEPLOYMENT.md). Architecture and the ZK compliance layer: [eunomia.finance/docs](https://eunomia.finance/docs).

## Develop

```bash
npm install
npm test          # unit tests (node:test)
npm run build     # dist/
EUNOMIA_TREASURY=<C…> npm run smoke   # drives the built server through the MCP protocol against testnet
```

`src/bindings/treasury.ts` is a vendored copy of `packages/treasury-client/src/index.ts`; `npm run check:bindings` (also in CI) keeps them byte-identical.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
