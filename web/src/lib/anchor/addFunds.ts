// "Add funds with TRY", end to end: lira leaves a bank account, USDC lands in the treasury,
// and from that moment the agent can spend it — inside the limits, to approved payees only.
//
// Two halves with the user in between. `startDeposit` ends with bank instructions on screen;
// the user sends the money (in the sandbox: declares it sent); `finishDeposit` waits for the
// anchor's USDC and forwards it into the treasury.
import type { Keypair } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE } from "../../config";
import { signIn } from "./auth";
import { ANCHOR_HOME_DOMAIN, discoverAnchor, type Anchor } from "./discover";
import { forwardToTreasury, openFundingAccount } from "./fundingAccount";
import { firmQuote, type Quote } from "./quotes";
import { requestDeposit, waitForTransfer, type DepositInstructions, type Transfer } from "./transfers";

export type DepositStep = "account" | "sign-in" | "quote" | "instructions" | "anchor" | "forward";

export interface PendingDeposit {
  anchor: Anchor;
  token: string;
  quote: Quote;
  instructions: DepositInstructions;
  tryAmount: string;
}

export interface FinishedDeposit {
  transfer: Transfer;
  /** USDC that reached the treasury, seven-place decimal. */
  usdcAmount: string;
  /** The anchor's payment into the funding account. */
  anchorTxHash: string | null;
  /** The forward from the funding account into the treasury. */
  treasuryTxHash: string;
}

let discovered: Promise<Anchor> | undefined;
/** The anchor's toml, read once per page load. */
export function theAnchor(): Promise<Anchor> {
  discovered ??= discoverAnchor(ANCHOR_HOME_DOMAIN, "USDC", NETWORK_PASSPHRASE).catch((e) => {
    discovered = undefined; // a failed read must not poison every later attempt
    throw e;
  });
  return discovered;
}

export async function startDeposit(
  funding: Keypair,
  tryAmount: string,
  onStep: (s: DepositStep) => void = () => {},
): Promise<PendingDeposit> {
  const anchor = await theAnchor();
  onStep("account");
  await openFundingAccount(funding, anchor);
  onStep("sign-in");
  const token = await signIn(anchor, funding);
  onStep("quote");
  const quote = await firmQuote(anchor, token, "deposit", tryAmount);
  onStep("instructions");
  const instructions = await requestDeposit(anchor, token, {
    account: funding.publicKey(),
    tryAmount,
    quoteId: quote.id,
  });
  return { anchor, token, quote, instructions, tryAmount };
}

export async function finishDeposit(
  funding: Keypair,
  treasuryId: string,
  p: PendingDeposit,
  onStep: (s: DepositStep) => void = () => {},
): Promise<FinishedDeposit> {
  onStep("anchor");
  const transfer = await waitForTransfer(p.anchor, p.token, p.instructions.id);
  // Forward what the anchor says it paid, not what the quote promised: the transfer record
  // is the fact, the quote was the intention.
  const usdcAmount = transfer.amountOut ?? p.quote.buyAmount;
  onStep("forward");
  const treasuryTxHash = await forwardToTreasury(funding, p.anchor, treasuryId, usdcAmount);
  return { transfer, usdcAmount, anchorTxHash: transfer.stellarTxHash, treasuryTxHash };
}
