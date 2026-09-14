# eunomia-mcp

Connect any MCP-capable AI agent (Claude Code, Claude Desktop, …) to a [Eunomia](https://eunomia.finance) treasury on Stellar. The agent gets a scoped, revocable credential; the treasury contract enforces the owner's budget on-chain and refuses anything outside it.

```bash
npx eunomia-mcp init --treasury <C…treasury id>
```

Week-1 surface: credential create/revoke + read tools (`check_budget`, `list_allowed_payees`, `check_payee`) against the live testnet contracts. The `pay` tool (x402) lands next.

Apache-2.0.
