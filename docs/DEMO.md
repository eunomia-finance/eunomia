# Eunomia — demo & pitch

## One-liner

> Eunomia is the wallet your AI agent can't drain. A business hands an autonomous agent real
> money to spend; the **contract** enforces the limits, every payment is auto-accounted, and
> Stellar settles in sub-cents.

## 30-second pitch

AI agents can reason and act — until they need to pay. No business gives an LLM agent a
wallet, because one jailbreak drains it and hundreds of micro-payments are impossible to
reconcile. Eunomia fixes both: the agent's spend is **bounded by a Soroban contract** (approved
payees, per-payment and daily limits, refused on-chain), every payment is **auto-accounted per
task**, and the budget starts as ordinary money — **TRY goes in through a SEP-6 anchor and
lands in the treasury as USDC**. Any MCP agent connects with one command. It is live on
testnet: a stranger signs up with a passkey, funds a treasury with a bank transfer and hands
it to Claude, in one sitting.

## Full product demo — screen-recording script

Goal: one unbroken take that shows the whole claim — **lira in, a leashed agent paying, the
contract saying no** — on the live site, with real transaction hashes. Real screen recording
(no static-screenshot zoom/pan), voiceover *or* captions. Target ~3:15.

The "say" column is a working draft in plain words — rewrite it in your own voice; the beats
and what must be on screen are what matter.

| Time | Screen | Say / caption |
|---|---|---|
| 0:00–0:10 | Landing hero | "The wallet your AI agent can't drain. Not a mock-up — I'll set one up and fund it with lira, live." |
| 0:10–0:25 | **Create your treasury with a passkey** → Face ID / fingerprint | "No wallet, no seed phrase, no crypto to buy first. A passkey — that's the owner." |
| 0:25–0:50 | **Setup**: USDC · limits 50 / 10 · *+ Connect an agent now* → copy the command → terminal: `npx -y eunomia-mcp init …` → paste the key | "The rules: fifty a day, ten per payment. And my agent — its key is made on *its* machine; I only see the public half. The treasury doesn't exist yet, but its address is already settled." |
| 0:50–1:00 | **Create treasury** → one passkey prompt → Overview | "One signature. The treasury exists, the rules are in it, and the agent is on its Leash." |
| 1:00–1:35 | **Add funds** → 1500 TRY → live price → *Get bank details* → IBAN + description → *Declare the transfer sent* → USDC lands, two tx links | "Now money. Lira, through a SEP-6 anchor, at a locked rate. This is a testnet sandbox, so I declare the transfer instead of sending it — the USDC that arrives is real testnet USDC. Notice what didn't happen: no wallet prompt." |
| 1:35–1:50 | **Payments** → approve one payee | "One address may be paid. Everyone else is a stranger." |
| 1:50–2:20 | **Claude** (MCP connected): "check the budget, then pay 2.5 USDC to \<payee\>" → `check_budget` → `pay` → tx hash → switch to the dashboard: the dark panel reads **2.5 USDC · Allowed**, the row is in the ledger with its proof, the 24h meter has moved | "I never touch this. Claude checks what it may spend, pays, and the payment is on-chain — signed by the Leash key, no prompt." |
| **2:20–2:50** | **Claude**: "send 5 USDC to \<stranger\>" → refused `PayeeNotWhitelisted #2` → open the refusal | **The climax — hold on it.** "Now the jailbreak. Same agent, same key — and the contract refuses. Not the app. Not the model's conscience. The contract. The funds never moved." |
| 2:50–3:05 | Claude calls `request_exception` → dashboard **Agent** page shows the request → *Approve payee* → Claude pays | "The agent doesn't argue — it asks. I decide, on-chain, and only then does it pay." |
| 3:05–3:15 | **Revoke Leash** → Overview | "One click and its authority is gone. My money, my rules, enforced on Stellar. eunomia.finance." |

**Recording notes**

- Record on **eunomia.finance**, not localhost — passkeys are bound to that domain.
- Have Claude Code open with the MCP server already added (`claude mcp add eunomia …` is
  printed by `init`); a second terminal for the `init` command. Pre-approve the MCP tools so
  permission dialogs don't land on camera.
- The payee must be able to hold USDC: a passkey wallet needs nothing, a G… account needs a
  USDC trustline. The **sample vendor** has one.
- TRY per transfer: 50–3000. 1500 TRY buys ~30 USDC — comfortably above the 50/10 limits'
  needs.
- Let each transaction confirm on camera — the real hash is the proof. 1080p, cursor visible,
  notifications off.
- Stills for a submission can be re-taken any time without recording:
  `cd web && npx playwright test --config playwright.shots.config.ts` → `docs/screenshots/`.
- Optional beats if the cut runs short: **Settings → Withdraw to your bank** (the unspent
  USDC goes back to an IBAN as TRY — the anchor in both directions, ~20 seconds on screen),
  the ZK attestation (Sealed Receipt), *Pause spending*, the same flow on a phone.

## 90-second guided demo (no sign-in)

The in-app **Guided demo** (sidebar) needs no wallet and reads live testnet state — useful on
a stage where signing in is a risk.

1. **▶ Run agent tasks.** "The agent pays three vendors autonomously — it signs its own
   transactions, no human, no wallet popup. Watch them settle." → 3 tx links, balance drops.
2. **⚠ Simulate prompt-injection.** "Now I jailbreak the agent: send everything to an attacker
   wallet." → 🔴 **Blocked on-chain — PayeeNotWhitelisted. Funds never moved.** "The model
   misbehaved. The contract didn't care."
3. **Auto-reconciled spend.** "Every payment is tagged to its task, read straight off-chain."
4. **Funding rail.** "One click pays a zero-cost muxed sub-address; the deposit is attributed
   on-chain with no memo. One account, any number of sub-budgets."

## Why Stellar (have this ready)

Sub-cent deterministic fees make agent micro-payments viable; **anchors and the SEPs** give a
standard, non-custodial way for ordinary money to become an on-chain budget — we integrate one
with two inputs, a home domain and an asset code; **contract accounts + passkeys** make an
owner who never holds a seed phrase first-class; **muxed accounts** are a zero-cost
attribution primitive; native USDC and x402 are where agent commerce is being priced. The
bounded-spend idea exists elsewhere — the **fiat-grade rail under it** is where Stellar wins.

## Judging map

| Criterion | Our evidence |
|---|---|
| Real-world impact | The #1 blocker to agentic commerce — safe, accountable agent spend — solved for money that starts in a bank account |
| Anchor / local payments | TRY → USDC through SEP-1/10/38/6, in the product's payment path: a USDC treasury has no other way to be funded. Evidence and diagrams: [`ANCHOR.md`](ANCHOR.md) |
| Technical | Soroban treasury + factory + registry + ZK verifier on testnet; SEP-10 challenge verified before signing; treasury address derived before creation; live tests against production |
| UX | Passkey sign-up, one-signature setup including the agent, funding with zero wallet prompts, refusals in plain language with the contract's code |
| Ecosystem fit | SEP anchors, passkey smart wallets, SAC/USDC, x402, MCP, ERC-8004 (trionlabs) — composes with what exists |
| Presentation | The "contract says no" moment, with live transaction links |

## Honest scope

- **Real (testnet):** the treasury, the rules and the refusals; one-signature setup; passkey
  ownership; autonomous agent payments through the published `eunomia-mcp`; the USDC the
  anchor pays; ZK attestation bound to chain state.
- **Simulated:** the anchor's **bank and KYC** — it is the Pro Hackathon's sandbox anchor. The
  integration is a configuration change away from a production SEP-6 anchor; the counterparty
  is the work.
- **Testnet shortcuts, stated in the code where they live:** the guided demo's embedded agent
  key, and the device-held funding-account and session keys.
- **Not reviewed yet:** the factory, `eunomia-mcp` and the anchor leg shipped after the last
  security round ([`SECURITY.md`](../SECURITY.md)).
- **Not built yet:** refusals an agent meets in simulation in the owner's ledger (its payments are there, and its exception
  requests are on the Agent page); mainnet.

## Likely questions

- *"Is the lira real?"* No — the sandbox anchor simulates the bank; the rate is real (oracle +
  spread, locked by a firm quote) and so is the USDC. Nothing in our code knows the
  difference: a production anchor is a different home domain.
- *"Isn't bounded spend already solved?"* Limits and allowlists are becoming table-stakes.
  What isn't: an owner who starts from a bank transfer and a passkey, an agent connected in
  the same signature, and refusals the agent can read and appeal.
- *"Why does the agent need a funding account in between?"* The anchor signs in and pays out
  G-accounts only; the owner's smart wallet and the treasury are contracts. SEP-45 on the
  anchor's side removes it.
- *"Custody risk?"* None — funds never leave the owner's contract. We're software, not a bank.
