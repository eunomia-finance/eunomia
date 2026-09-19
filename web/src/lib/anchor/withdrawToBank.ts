// "Withdraw to your bank": the anchor leg in reverse. USDC leaves the treasury, the anchor
// receives it on Stellar, and TRY arrives at an IBAN.
//
// Three parts, and the order is the safety. `startWithdrawal` gets a locked rate and the
// anchor's instructions while the money is still in the treasury — if the anchor says no,
// nothing has moved. Then the owner signs the one thing only the owner can: the treasury's
// `admin_withdraw`, into the funding account. `finishWithdrawal` sends that USDC to the anchor
// with the memo that ties it to the request, and waits for the payout.
//
// If the trip stops between the last two — a reload, a dropped connection — the USDC is in the
// funding account, and "Add funds" offers to move it back into the treasury.
import type { Keypair } from "@stellar/stellar-sdk";
import { decimalToStroops, stroopsToDecimal } from "./amounts";
import { theAnchor } from "./addFunds";
import { signIn } from "./auth";
import type { Anchor } from "./discover";
import { openFundingAccount, payAnchor } from "./fundingAccount";
import { normalizeIban } from "./iban";
import { firmQuote, type Quote } from "./quotes";
import { requestWithdraw, setPayoutIban, waitForTransfer, type Transfer, type WithdrawInstructions } from "./transfers";

export type WithdrawStep = "account" | "sign-in" | "quote" | "instructions" | "send" | "anchor";

export interface PendingWithdrawal {
  anchor: Anchor;
  token: string;
  quote: Quote;
  instructions: WithdrawInstructions;
  /** Seven-place decimal — the exact figure the treasury releases and the anchor is sent. */
  usdcAmount: string;
}

export interface FinishedWithdrawal {
  transfer: Transfer;
  /** The USDC payment from the funding account to the anchor. */
  paymentTxHash: string;
  /** TRY paid out, as the anchor reports it. */
  tryAmount: string;
}

export async function startWithdrawal(
  funding: Keypair,
  usdcAmount: string,
  iban: string | undefined,
  onStep: (s: WithdrawStep) => void = () => {},
): Promise<PendingWithdrawal> {
  // One spelling of the amount for all three parties — treasury, payment, anchor.
  const amount = stroopsToDecimal(decimalToStroops(usdcAmount));
  const anchor = await theAnchor();
  onStep("account");
  await openFundingAccount(funding, anchor);
  onStep("sign-in");
  const token = await signIn(anchor, funding);
  if (iban) await setPayoutIban(anchor, token, funding.publicKey(), normalizeIban(iban));
  onStep("quote");
  const quote = await firmQuote(anchor, token, "withdraw", amount);
  onStep("instructions");
  const instructions = await requestWithdraw(anchor, token, { usdcAmount: amount, quoteId: quote.id });
  return { anchor, token, quote, instructions, usdcAmount: amount };
}

export async function finishWithdrawal(
  funding: Keypair,
  p: PendingWithdrawal,
  onStep: (s: WithdrawStep) => void = () => {},
): Promise<FinishedWithdrawal> {
  onStep("send");
  const paymentTxHash = await payAnchor(funding, p.anchor, p.instructions, p.usdcAmount);
  onStep("anchor");
  const transfer = await waitForTransfer(p.anchor, p.token, p.instructions.id);
  return { transfer, paymentTxHash, tryAmount: transfer.amountOut ?? p.quote.buyAmount };
}
