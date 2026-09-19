# Connect your agent

[`eunomia-mcp`](https://www.npmjs.com/package/eunomia-mcp) puts any MCP agent — Claude
included — on a Leash: it can check its budget and pay from your treasury on its own, and
everything outside your rules is refused by the contract, not by the agent's good manners.

The agent's key is made **on the agent's machine and never leaves it**. You, the owner, sign
exactly one thing: a spending cap and a deadline for that key's public half.

## See it first, without setting anything up

If you'd rather watch the arrangement work before wiring your own agent into it: start a Leash
without pasting a key (the **Start Leash** button with the key field empty) and the app keeps
one on this device. **Agent → Run the agent** then does three real transactions in a row,
signed by that key, with no prompt to you:

1. it pays a payee you approved;
2. it tries an address you never approved, and the contract refuses it with its own error code;
3. it files that refusal as a request on its own Stellar account — which appears under
   **Waiting for you**, with the one on-chain action that resolves it.

Both decisions land in your ledger. That is the whole product in about forty seconds, and it
is exactly what an external agent does through the tools below.

## Three steps

**1 · On the agent's machine — make its key.**

```bash
npx -y eunomia-mcp init --treasury <your treasury id>
```

You don't have to type the id: the app prints this command with it filled in — on the
**Agent** page, and on the setup screen under *+ Connect an agent now*. (During setup the
treasury doesn't exist yet. Its address follows from a salt the form draws when it opens, so
the app can name it in advance — and one signature then creates the treasury *and* puts the
agent on its Leash.)

The command prints the **agent public key** and the config for your MCP client. On testnet it
also funds the key, which pays its own transaction fees.

**2 · In the app — authorise it.** Paste the public key, set a cap and a duration,
**Authorise agent**. One signature. *Revoke Leash* on the same page ends it instantly.

**3 · Add the server to your MCP client.**

```bash
# Claude Code
claude mcp add eunomia -e EUNOMIA_TREASURY=<C…> -e EUNOMIA_NETWORK=testnet -- npx -y eunomia-mcp
```

```json
{ "mcpServers": { "eunomia": { "command": "npx", "args": ["-y", "eunomia-mcp"],
  "env": { "EUNOMIA_TREASURY": "<C…>", "EUNOMIA_NETWORK": "testnet" } } } }
```

Check it: `npx -y eunomia-mcp status --treasury <C…>` — `canSpend: true` with
`session.isThisAgent: true` means the handshake worked.

## What the agent gets

| Tool | |
| --- | --- |
| `check_budget` | What it may spend right now: per-payment cap, what is left of the rolling 24 hours, the Leash (cap, spent, expiry), free balance, and the `unit` every amount is in (`"USDC"`, `"XLM"`). Given an `amount`, it answers ahead of time with the **contract's own refusal codes**. |
| `list_allowed_payees` · `check_payee` | Who the treasury will pay — rebuilt from the contract's events and re-verified on-chain, or the exact answer for one address. |
| `pay` | `to` + `amount`, or an **x402** payment requirement (one entry of a `402` response's `accepts[]`, in the treasury's asset). Signed by the Leash key, no prompt. A refusal is not an error: it comes back with the stage it was refused at and the contract's code. |
| `request_exception` · `check_exception` | When the rules say no, the agent asks you. The request is a data entry on the agent's own Stellar account — no server in between — and shows up on your **Agent** page. You resolve it with an ordinary on-chain action (approve the payee, raise a limit, start a bigger Leash); the agent sees `approved` and pays. |

## What a refusal looks like

```json
{
  "paid": false,
  "amount": "1", "unit": "USDC",
  "stage": "simulation",
  "reasons": [{ "code": 2, "name": "PayeeNotWhitelisted", "detail": "payee is not on the owner's whitelist" }],
  "nextStep": "request_exception",
  "note": "This refusal is the treasury's policy working — the same rule the contract enforces on-chain."
}
```

That is from a real run: a treasury funded with TRY, an agent started from an empty directory
with the published package, [a payment to the approved payee that went through](https://stellar.expert/explorer/testnet/tx/55e1d57ac10b71b88f12f7403efadcc8c44a6b46209f86759293616f154a6bfe)
and this one, to a stranger, that did not.

Full reference — environment variables, the CLI, the SDK:
[`packages/mcp/README.md`](https://github.com/eunomia-finance/eunomia/blob/main/packages/mcp/README.md).
