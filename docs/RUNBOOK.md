# Eunomia — Runbook

What to do when something goes wrong, and the routine that keeps it from going wrong. Two
audiences: a treasury **owner**, who holds every power over their own funds, and the
**operator** (us), who runs the web app, the relay and the indexer and holds no power over
anyone's funds.

The CLI snippets assume `stellar` CLI 26 and a network entry for mainnet:

```sh
stellar network add eunomia-mainnet --rpc-url <a mainnet RPC> \
  --network-passphrase "Public Global Stellar Network ; September 2015"
T=<treasury C…>   OWNER=<the owner's CLI identity>   N="--network eunomia-mainnet"
```

Every owner action below is also in the app (Settings, Agent). The CLI is the path for when
the app is down or not to be trusted.

## Owner: an incident

| Situation | First move | In the app | CLI |
|---|---|---|---|
| The agent's key leaked, or the agent misbehaves | End the Leash: the key stops spending in the same ledger | Agent → Revoke | `stellar contract invoke --id $T --source $OWNER $N -- revoke_session` |
| Unsure what is happening | Pause: every `pay`, `create_escrow` and `release_escrow` is refused; exits keep working | Settings → Pause spending | `… -- set_paused --paused true` |
| A payee is compromised | Remove it from the whitelist | Payments | `… -- remove_payee --payee <G…/C…>` |
| An escrow should not settle | Cancel it; the funds go back to the free balance | — | `… -- admin_cancel_escrow --id <n>` |
| Get out | Withdraw to an address you control | Settings → Withdraw | `… -- admin_withdraw --to <G…> --amount <stroops>` |
| The deposit is refused although you are under the cap | Someone sent tokens in directly (SECURITY.md, Known limitations): withdraw the excess | Settings → Withdraw | as above |

Order when in doubt: **revoke, pause, then think.** Neither loses anything: a revoked Leash
is replaced with a new key, a pause is undone with `set_paused --paused false`.

The web app is the soft spot (SECURITY.md): if `eunomia.finance` itself is suspect, sign
nothing there. Use the CLI, or a wallet whose own screen shows the call.

## Owner: the pause drill

Once, on a small treasury, before trusting an agent with a real one:

1. Start a Leash with a small cap and let the agent pay once.
2. Pause. Ask the agent to pay again: it must be refused (`#9`, paused).
3. Withdraw one stroop while paused: it must go through.
4. Resume, revoke the Leash, and check the agent's next payment is refused.

## Operator: routine

| What | Where | How often |
|---|---|---|
| Relay fee account `GCN5E5FB…46FXM` holds more than 10 XLM — and, to be able to spend a whole day's budget and still pay for exit calls, the floor + the daily budget + the reserve (5 + 20 + 5 = 30 XLM as configured) | [stellar.expert](https://stellar.expert/explorer/public/account/GCN5E5FBQCVBWY6BK2JQOI7SVUVEFF5FUCHCVHAVFHGUJV2DNQR46FXM) | weekly, and on any alert below |
| The indexer runs | `cd workers/chain-indexer && npx wrangler tail` shows `{"ok":true,"network":"mainnet",…}` every 15 minutes | weekly |
| The passkey wallet wasm `fdefad64…` stays live | it was live to ledger 67,934,065 on 2026-10-24; extend well before | monthly |
| The provider plan is not near its limit | Validation Cloud dashboard (free plan: 50M compute units a month) | monthly |

Extending the passkey wasm, which every passkey wallet runs (anyone can pay for it):

```sh
stellar contract extend --wasm-hash fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0 \
  --ledgers-to-extend 3000000 --source eunomia-deployer $N
```

## Operator: alerts

`cd web && npx wrangler tail` streams the app worker's log. The lines that matter:

| Line | Meaning | Action |
|---|---|---|
| `[relay] fee account below floor` | Sponsorship is off: passkey users cannot transact | Send XLM to the fee account. Wallet users are unaffected |
| `[relay] daily budget reached` | The day's fee total (`RELAY_DAILY_BUDGET_XLM`) is spent; it resets at 00:00 UTC. Until then only an owner's exit calls are sponsored (revoke, pause, withdraw, cancel an escrow, remove a payee), from the reserve | If it is real use, raise the var in `wrangler.jsonc` and deploy. If not, find the caller first |
| `[relay] exit call charged to the reserve` | An owner got out while the day's budget was gone. The reserve is `RELAY_SAFETY_BUDGET_XLM` (default 5) a day, ten calls per wallet | Nothing, unless it repeats: then the budget is being emptied on purpose |
| `[relay] refused a … transaction (cap …)` | A single call priced above `RELAY_MAX_FEE_XLM` | Usually an abuse attempt; nothing to do |
| `[rpc] not configured` | `/api/rpc` lost `RELAY_RPC_URL` or its limiter | `npx wrangler secret put RELAY_RPC_URL` |
| `[rpc] upstream failed` | The provider is down or the key was revoked | Check the provider; rotate the key below |

## Operator: rotations

- **RPC provider key.** Make a new endpoint at the provider, then `npx wrangler secret put
  RELAY_RPC_URL` in `web/` and `npx wrangler secret put RPC_URL` in `workers/chain-indexer/`.
  Revoke the old endpoint last.
- **Relay fee key.** `stellar keys generate eunomia-relay-2`, fund it, then
  `stellar keys secret eunomia-relay-2 | npx wrangler secret put RELAY_SECRET` in `web/`.
  Move what is left on the old account to the new one. The key holds no role in any contract;
  a leak costs at most its balance.
- **Deployer key** (`eunomia-deployer`, in the Windows credential store). It holds no role in
  any contract and is only needed to deploy new code or extend TTLs.

## Operator: changes that need care

- **A new factory** (a cap change, the next treasury version). Factories have no admin and
  cannot be changed, so a new one is deployed beside the old; existing treasuries keep the cap
  and code they were born with. Update `web/src/networks.ts`, `RELAY_FACTORY_ID`, the docs,
  and keep the old treasury wasm hash in `relayGuard.allowedWasmHashes` so those owners can
  still use the relay.
- **Deploys** of the app and the indexer: `npm run deploy:cf` in `web/` with
  `EUNOMIA_RPC_URL=https://eunomia.finance/api/rpc`, and `npx wrangler deploy` in
  `workers/chain-indexer/`. After either, load the app and check the log for a minute.
