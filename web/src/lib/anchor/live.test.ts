// LIVE — talks to tr-mock-anchor.fly.dev and Stellar testnet, so it is off unless asked for:
//
//   ANCHOR_LIVE=1 npx vitest run src/lib/anchor/live.test.ts
//
// The whole claim in one run: lira goes in, a USDC treasury comes out funded, the agent pays
// an approved payee from it on its own, and a payment to anyone else is refused by the
// contract. Every account here is a throwaway made for the run.
import { describe, it, expect } from "vitest";
import { Horizon, Keypair } from "@stellar/stellar-sdk";
import { HORIZON_URL } from "../../config";
import { createTreasury, freshSalt, predictTreasuryId } from "../createTreasury";
import { makeWalletExecutor } from "../executor";
import { fundWithFriendbot } from "../funding";
import { sessionSigner } from "../session";
import { makeTreasury, pay, readState } from "../userTreasury";
import { finishDeposit, startDeposit, theAnchor } from "./addFunds";
import { decimalToStroops } from "./amounts";
import { anchorTokenId, hasTrustline, openFundingAccount } from "./fundingAccount";
import { simulateBankTransfer } from "./transfers";

const live = process.env.ANCHOR_LIVE === "1";

describe.skipIf(!live)("TRY -> USDC treasury -> agent payment (live)", () => {
  it(
    "funds a treasury with lira and lets the agent spend it only where allowed",
    async () => {
      const anchor = await theAnchor();
      const owner = Keypair.random();
      const agent = Keypair.random();
      const payee = Keypair.random();
      const stranger = Keypair.random();
      const funding = Keypair.random();

      await Promise.all([owner, agent, payee, stranger].map((k) => fundWithFriendbot(k.publicKey())));
      // A payee is paid in USDC, so it has to trust the issuer — same rule as any USDC wallet.
      await Promise.all([payee, stranger].map((k) => openFundingAccount(k, anchor)));

      const ownerExec = makeWalletExecutor(owner.publicKey(), sessionSigner(owner.secret()).signer);
      const salt = freshSalt();
      const treasuryId = await createTreasury(ownerExec, {
        token: anchorTokenId(anchor),
        dailyXlm: 50,
        perTaskXlm: 10,
        payees: [payee.publicKey()],
        leash: { agent: agent.publicKey(), capXlm: 25, hours: 1 },
        fundXlm: 0,
        register: false,
        salt,
      });
      console.log("treasury", treasuryId, "salt", salt.toString("hex"));
      // Setup shows an agent its treasury id before the treasury exists; the chain has to agree.
      expect(treasuryId).toBe(predictTreasuryId(salt));

      const pending = await startDeposit(funding, "150", (s) => console.log("  step:", s));
      console.log("  send", pending.tryAmount, "TRY to", pending.instructions.iban, "ref", pending.instructions.reference);
      await simulateBankTransfer(pending.anchor, pending.token, pending.instructions.id, pending.tryAmount);
      const done = await finishDeposit(funding, treasuryId, pending, (s) => console.log("  step:", s));
      console.log("  anchor tx", done.anchorTxHash, "| treasury tx", done.treasuryTxHash, "|", done.usdcAmount, "USDC");

      const asOwner = makeTreasury(treasuryId, ownerExec);
      const state = await readState(asOwner);
      expect(state.token).toBe(anchorTokenId(anchor));
      expect(state.balance).toBe(decimalToStroops(done.usdcAmount));

      const asAgent = makeTreasury(treasuryId, makeWalletExecutor(agent.publicKey(), sessionSigner(agent.secret()).signer));
      const paid = await pay(asAgent, 1n, payee.publicKey(), 1);
      console.log("  agent paid:", paid);
      expect(paid.ok).toBe(true);

      const horizon = new Horizon.Server(HORIZON_URL);
      const payeeAcct = await horizon.loadAccount(payee.publicKey());
      expect(hasTrustline(payeeAcct.balances as never, anchor)).toBe(true);
      const got = (payeeAcct.balances as { asset_code?: string; balance: string }[]).find((b) => b.asset_code === "USDC");
      expect(got?.balance).toBe("1.0000000");

      const refused = await pay(asAgent, 2n, stranger.publicKey(), 1);
      console.log("  to a stranger:", refused);
      expect(refused.ok).toBe(false);

      expect((await readState(asOwner)).balance).toBe(decimalToStroops(done.usdcAmount) - 10_000_000n);
    },
    300_000,
  );
});
