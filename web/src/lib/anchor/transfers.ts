// SEP-6, the programmatic door: the app asks, the anchor answers with instructions, and the
// app renders them in its own UI. (SEP-24 — the anchor's hosted page — is the door Turkish
// regulation closes to third-party apps; SEP-6 is the one that stays open.)
//
// Deposit: TRY goes to the anchor's bank account with a reference, USDC arrives on Stellar.
// Withdraw: USDC goes to the anchor's Stellar account with a memo, TRY arrives at an IBAN.
import { FIAT_TRY, type Anchor } from "./discover";
import { anchorJson } from "./http";

export interface DepositInstructions {
  id: string;
  bankName: string;
  iban: string;
  /** Goes in the bank transfer's description; it is how the anchor finds the sender. */
  reference: string;
}

export interface WithdrawInstructions {
  id: string;
  /** The anchor's Stellar account the USDC is sent to. */
  account: string;
  memo: string;
  memoType: "id" | "text" | "hash";
}

export type TransferStatus =
  | "pending_user_transfer_start"
  | "pending_anchor"
  | "pending_trust"
  | "completed"
  | "error"
  | (string & {});

export interface Transfer {
  id: string;
  kind: "deposit" | "withdrawal" | (string & {});
  status: TransferStatus;
  amountIn: string | null;
  amountOut: string | null;
  amountFee: string | null;
  /** The Stellar payment: USDC out for a deposit, USDC in for a withdrawal. */
  stellarTxHash: string | null;
  /** The bank side: the deposit reference, or the FAST payout id. */
  bankRef: string | null;
  message: string | null;
}

type Field = { value?: string };
interface RawDeposit {
  id: string;
  instructions?: Record<string, Field>;
}
interface RawWithdraw {
  id: string;
  account_id: string;
  memo: string;
  memo_type: WithdrawInstructions["memoType"];
}
interface RawTransfer {
  id: string;
  kind: string;
  status: string;
  amount_in?: string | null;
  amount_out?: string | null;
  amount_fee?: string | null;
  stellar_transaction_id?: string | null;
  external_transaction_id?: string | null;
  message?: string | null;
}

/** Ask to turn `tryAmount` TRY into USDC on `account`, at the rate `quoteId` locked.
 *
 *  `account` has to be a G-address with a USDC trustline. The anchor refuses contract
 *  addresses outright, which is why a treasury is funded through a classic account and not
 *  directly. */
export async function requestDeposit(
  anchor: Anchor,
  token: string,
  p: { account: string; tryAmount: string; quoteId: string },
  fetchFn: typeof fetch = fetch,
): Promise<DepositInstructions> {
  const raw = await anchorJson<RawDeposit>(
    `${anchor.transfer}/deposit-exchange`,
    {
      token,
      query: {
        // SEP-6 asymmetry: the on-chain side is a bare code, the fiat side a SEP-38 identifier.
        destination_asset: anchor.assetCode,
        source_asset: FIAT_TRY,
        amount: p.tryAmount,
        quote_id: p.quoteId,
        account: p.account,
        funding_method: "bank_account",
        type: "bank_account",
      },
    },
    fetchFn,
  );
  const field = (name: string): string => {
    const v = raw.instructions?.[name]?.value;
    if (!v) throw new Error(`The anchor's deposit instructions are missing ${name}.`);
    return v;
  };
  return {
    id: raw.id,
    bankName: field("bank_name"),
    iban: field("bank_account_number"),
    reference: field("external_transfer_memo"),
  };
}

/** Ask to turn `usdcAmount` USDC into TRY. The answer says where to send the USDC, and with
 *  which memo — the memo is the only thing tying the payment to this withdrawal. */
export async function requestWithdraw(
  anchor: Anchor,
  token: string,
  p: { usdcAmount: string; quoteId: string },
  fetchFn: typeof fetch = fetch,
): Promise<WithdrawInstructions> {
  const raw = await anchorJson<RawWithdraw>(
    `${anchor.transfer}/withdraw-exchange`,
    {
      token,
      query: {
        source_asset: anchor.assetCode,
        destination_asset: FIAT_TRY,
        amount: p.usdcAmount,
        quote_id: p.quoteId,
        funding_method: "bank_account",
        type: "bank_account",
      },
    },
    fetchFn,
  );
  if (!raw.account_id || !raw.memo) {
    throw new Error("The anchor's withdrawal instructions are missing the account or the memo.");
  }
  return { id: raw.id, account: raw.account_id, memo: raw.memo, memoType: raw.memo_type };
}

/** Where a withdrawal's TRY is paid. The anchor reads the IBAN from the SEP-12 customer
 *  record, not from the withdraw request. */
export async function setPayoutIban(
  anchor: Anchor,
  token: string,
  account: string,
  iban: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  await anchorJson(
    `${anchor.kyc}/customer`,
    { method: "PUT", token, body: { account, bank_account_number: iban } },
    fetchFn,
  );
}

export async function getTransfer(
  anchor: Anchor,
  token: string,
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<Transfer> {
  const { transaction: t } = await anchorJson<{ transaction: RawTransfer }>(
    `${anchor.transfer}/transaction`,
    { token, query: { id } },
    fetchFn,
  );
  return {
    id: t.id,
    kind: t.kind,
    status: t.status,
    amountIn: t.amount_in ?? null,
    amountOut: t.amount_out ?? null,
    amountFee: t.amount_fee ?? null,
    stellarTxHash: t.stellar_transaction_id ?? null,
    bankRef: t.external_transaction_id ?? null,
    message: t.message ?? null,
  };
}

export interface WaitOptions {
  onStatus?: (t: Transfer) => void;
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Poll until the transfer settles. An `error` status throws with the anchor's own message;
 *  a timeout throws too — a transfer nobody is watching any more is not a success. */
export async function waitForTransfer(
  anchor: Anchor,
  token: string,
  id: string,
  { onStatus, timeoutMs = 120_000, intervalMs = 2_000, sleep = wait, now = Date.now }: WaitOptions = {},
  fetchFn: typeof fetch = fetch,
): Promise<Transfer> {
  const deadline = now() + timeoutMs;
  let last: TransferStatus | undefined;
  for (;;) {
    const t = await getTransfer(anchor, token, id, fetchFn);
    if (t.status !== last) {
      last = t.status;
      onStatus?.(t);
    }
    if (t.status === "completed") return t;
    if (t.status === "error") throw new Error(t.message || "The anchor reported an error on this transfer.");
    if (now() >= deadline) {
      throw new Error(`The anchor has not finished this transfer yet (still ${t.status}). Its id is ${id}.`);
    }
    await sleep(intervalMs);
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** SANDBOX ONLY. There is no bank behind the mock anchor, so the incoming TRY transfer is
 *  declared instead of made. A production anchor has no such endpoint: the user sends the
 *  money from their bank and this call simply does not exist. */
export async function simulateBankTransfer(
  anchor: Anchor,
  token: string,
  id: string,
  tryAmount: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  await anchorJson(
    `${anchor.transfer}/tx/${encodeURIComponent(id)}/simulate-bank-transfer`,
    { method: "POST", token, body: { amount: tryAmount } },
    fetchFn,
  );
}
