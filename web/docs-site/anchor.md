# The anchor leg — TRY in, a spendable agent budget out

An owner funds a treasury with Turkish lira. The lira goes to a **SEP-6 anchor**, USDC comes
out on Stellar, and it lands inside the treasury, where the agent spends it — inside the
limits, to approved payees only.

The anchor is in the payment path, not beside it: from the dashboard a USDC treasury has no
other way to be funded, and every payment the agent makes afterwards is that same USDC.

## What the owner does

1. **Add funds** → type an amount in TRY. A live price (SEP-38) shows what it buys.
2. **Get bank details** → the rate is now locked: bank, IBAN, the transfer description, and
   the time the rate is held until.
3. Send the transfer. *(On the testnet sandbox there is no bank, so the transfer is declared
   with one button — the app says so on the screen.)*
4. A few seconds later the USDC is in the treasury, with both transactions linked.

No wallet prompt at any point: a passkey owner goes from nothing to a funded treasury with
**one signature** — the one that created it — and without ever holding XLM.

## And back out

**Settings → Withdraw to your bank**: type an amount in USDC and an IBAN (checksum-verified),
see what it pays in TRY, sign once. The rate and the anchor's instructions are taken *before*
the treasury releases anything, so a refusal from the anchor costs nothing; then the treasury
releases the USDC, it is sent to the anchor with the memo that ties it to the request, and
TRY arrives at the IBAN.

## How it is built

| Step | Standard |
| --- | --- |
| Find the anchor's endpoints, signing key and issuer from its home domain | SEP-1 |
| Sign in — after proving the challenge is unsubmittable, addressed to this account and signed by the anchor's published key | SEP-10 |
| Live preview, then a firm quote | SEP-38 |
| `deposit-exchange` / `withdraw-exchange` | SEP-6 |
| Payout IBAN | SEP-12 |

The integration's only inputs are **a home domain and an asset code**; everything else is
discovered. Moving from the sandbox to a production SEP-6 anchor is a configuration change.

Two constraints shaped it. The anchor signs in **G-accounts only** (no SEP-45 endpoint, so a
passkey smart wallet cannot authenticate) and pays out **G-accounts only** (it refuses
contract addresses outright). Both the owner's smart wallet and the treasury are contract
addresses — so each treasury gets a **funding account**: a key made on the owner's device
that signs in, receives the USDC and forwards it into the treasury in the next transaction. A
corridor, not a vault. If the trip is interrupted, the USDC waits there and the app offers to
move it in the next time the form opens.

## What is simulated, and what is not

| | |
| --- | --- |
| The bank and KYC | **Simulated** by the sandbox anchor (`tr-mock-anchor.fly.dev`). |
| The rate | Real: USD/TRY from the Reflector oracle plus a 50 bps spread, locked by a firm quote. |
| The USDC | Real testnet USDC, paid on-chain by the anchor. |
| The treasury, the limits, the refusals | Real contracts on testnet. |

## Evidence

150 TRY → 3.0594136 USDC, [paid by the anchor](https://stellar.expert/explorer/testnet/tx/0db8d77093198f64d7ebc3b03628a34ef1a6c47d80e74b07298073c3427f1b34),
[forwarded into the treasury](https://stellar.expert/explorer/testnet/tx/aff042d153ff4e11295e310efdcc70f6ad81404452c003e7a56804a5a27d411e);
the agent [pays an approved payee](https://stellar.expert/explorer/testnet/tx/7ff1d88ebd68730108e9a965f3e06e99f8cbb4f25f44d11fac59244390d00643)
on its own, and its payment to a stranger is refused by the contract (`PayeeNotWhitelisted #2`).

Sequence and component diagrams, the full evidence table (including the run on the live site
with a passkey) and the off-ramp probe:
[`docs/ANCHOR.md`](https://github.com/eunomia-finance/eunomia/blob/main/docs/ANCHOR.md).
