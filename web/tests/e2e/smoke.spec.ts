import { test as base } from "@playwright/test";
import {
  getTestSigner,
  injectTestSigner,
  EunomiaPage,
  expect,
} from "./eunomiaTest";
import { SERVICE } from "../../src/config";

const test = base.extend<{
  eunomia: EunomiaPage;
  signer: ReturnType<typeof getTestSigner>;
}>({
  signer: async ({}, use) => {
    const s = getTestSigner();
    await use(s);
  },

  context: async ({ context, signer }, use) => {
    await injectTestSigner(context, signer);
    await use(context);
  },

  eunomia: async ({ page }, use) => {
    await use(new EunomiaPage(page));
  },
});

test.describe
  .serial("Smoke: landing → connect → deploy → fund → whitelist → pay", () => {
  test("the full happy path succeeds against testnet", async ({
    eunomia,
    signer,
  }) => {
    test.info().annotations.push({
      type: "network",
      description:
        "Runs against Stellar testnet — needs funded PLAYWRIGHT_TEST_WALLET_SECRET",
    });

    const pageErrors: string[] = [];
    eunomia.page.on("pageerror", (e) => {
      pageErrors.push(String(e));
    });

    // 1. Landing loads without console errors.
    await eunomia.assertNoConsoleErrorsOnLanding();

    // 2. Navigate to workspace (shell / connect gate).
    await eunomia.gotoWorkspace();

    // 3. Connect via the injected test signer — no wallet modal.
    await eunomia.connectWallet();
    await eunomia.assertWalletChipShows(signer.address);

    // 4. Friendbot top-up if the throwaway wallet has < MIN_XLM.
    await eunomia.friendbotIfNeeded();

    // 5. Deploy a treasury with default limits.
    await eunomia.deployTreasury("50", "10");

    // 6. Fund the treasury.
    await eunomia.fundTreasury("20");
    await eunomia.assertBalanceGt(15n * 10_000_000n);

    // 7. Whitelist the sample payee.
    await eunomia.whitelistPayee(SERVICE);

    // 8. Pay 1 XLM within the per-task + daily limits.
    const balBefore = await eunomia.readBalanceStroops();
    await eunomia.sendPayment(SERVICE, "1");

    // 9. On-chain state assertion — the payment left the treasury. Measured as a difference:
    //    the one-signature setup already moves starting funds in, so an absolute figure
    //    ("at most 19") stopped describing this flow the day that shipped.
    const balAfter = await eunomia.readBalanceStroops();
    expect(balBefore - balAfter).toBe(10_000_000n);

    expect(pageErrors).toEqual([]);
  });
});
