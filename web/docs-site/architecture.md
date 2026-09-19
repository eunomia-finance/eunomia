# Architecture

Eunomia is a handful of small Soroban contracts, a web app, and a package for the agent's
side. The design rule everywhere: **the contract is the gate, everything else is a window
onto it.**

![Eunomia architecture: owner, factory, treasury, anchor rail, agent, payees, ZK verifier](https://raw.githubusercontent.com/eunomia-finance/eunomia/main/docs/architecture.svg)

## The pieces

| Piece | What it does |
| --- | --- |
| **Treasury** (per user) | Holds the funds and the rules: approved-payee list, per-payment cap, rolling 24h daily cap. `pay()` checks every rule on-chain; a payment outside the rules reverts — funds never move. It holds one token, fixed at creation: USDC or XLM. |
| **Treasury factory** | One owner signature does the whole setup — deploy, rules, first payees, Leash, funding, registry — atomically. It has no admin and no authority over a treasury once it exists. A treasury's address follows from (network, factory, salt), which is why the app can tell an agent its treasury's id before the treasury is created. |
| **Anchor leg** | TRY goes to a SEP-6 anchor at a locked rate; the anchor's USDC reaches the treasury through a per-treasury funding account. See [The anchor leg](/anchor). |
| **`eunomia-mcp`** | The agent's side: an MCP server + SDK. The agent checks its budget, pays, settles x402 requirements and asks for exceptions — with a key made on its own machine. See [Connect your agent](/connect-your-agent). |
| **Leash sessions** | A time-bound, spend-capped session key the owner grants to an agent. While a Leash is active it is the *only* key that can pay; it expires on its own and can be revoked instantly. |
| **Treasury Registry** | Optional on-chain backup: `register(owner, treasury)` makes a treasury discoverable from any device by the owner's wallet — no client-side-only state. |
| **Compliance Verifier (ZK)** | A hardened Groth16/BN254 verifier that attests a whole batch of payments obeyed the rules — without revealing amounts or payees. See [Confidential compliance](/zk). |
| **Smart wallet** (passkey users) | A WebAuthn passkey controls a Stellar smart wallet, and that wallet — not a browser extension — owns the treasury. Nothing about the treasury changes: the owner is simply a `C…` address instead of a `G…` one. |

## The flow

1. **Create — one signature.** The owner creates their own treasury through the factory —
   from a browser wallet, or from the smart wallet a passkey controls. The rules are
   constructor arguments: there is no separate `initialize` to race, and no upgrade
   entrypoint to trust. Policy bounds are validated at creation (`0 < per-payment ≤ daily`).
   A first payee and an agent's Leash can ride in the same signature.
2. **Fund & approve.** A USDC treasury is filled with TRY through the anchor — no wallet
   prompt; an XLM one from the owner's wallet. The treasury pays from its own balance, and
   only to payees the owner approved (or, optionally, to addresses that clear an on-chain
   reputation threshold).
3. **Spend — human or agent.** Without a Leash, the owner's wallet signs each payment.
   With a Leash, the session key signs autonomously; the contract enforces the same rules
   plus the session's own cap.
4. **Exit paths never lock.** `pause` freezes spending, `admin_withdraw` works even while
   paused, limits can be updated live, and the agent key can be rotated. The owner always
   has a way out.

## Design choices worth knowing

- **Deliberately non-upgradeable.** An upgradeable treasury would turn "the rules are
  enforced" into "trust the admin". The exit story is pause → withdraw → create a fresh
  treasury.
- **Rolling 24h window.** The daily cap uses hourly buckets over the last 24 hours, so
  there is no midnight boundary where 2× the limit could slip through.
- **Checks-effects-interactions + overflow-checked arithmetic.** Accounting is written
  before the token transfer and reverts atomically; spend math panics rather than wraps.
- **A blocked payment is the product working.** Rejections happen on-chain with typed
  error codes (see [Contracts & Addresses](/contracts)) and are visible in the activity
  feed — "my agent can't drain me" is verifiable, not promised.
