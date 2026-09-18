// The hackathon's core claim, driven through the real UI against the real anchor: a new
// owner creates a USDC treasury and fills it with TRY — a bank transfer in, USDC out, with no
// wallet prompt on the funding leg.
import { test as base } from "@playwright/test";
import { Keypair } from "@stellar/stellar-sdk";
import { getTestSigner, injectTestSigner, EunomiaPage, expect } from "./eunomiaTest";
import { theAnchor } from "../../src/lib/anchor/addFunds";
import { signIn } from "../../src/lib/anchor/auth";
import { firmQuote } from "../../src/lib/anchor/quotes";
import { requestDeposit, simulateBankTransfer, waitForTransfer } from "../../src/lib/anchor/transfers";

const test = base.extend<{
  eunomia: EunomiaPage;
  signer: ReturnType<typeof getTestSigner>;
}>({
  signer: async ({}, use) => {
    await use(getTestSigner());
  },
  context: async ({ context, signer }, use) => {
    await injectTestSigner(context, signer);
    await use(context);
  },
  eunomia: async ({ page }, use) => {
    await use(new EunomiaPage(page));
  },
});

test("a USDC treasury is funded with TRY through the anchor", async ({ eunomia, signer }) => {
  test.info().annotations.push({
    type: "network",
    description: "Runs against Stellar testnet and tr-mock-anchor.fly.dev",
  });
  const page = eunomia.page;
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await eunomia.gotoWorkspace();
  await eunomia.connectWallet();
  await eunomia.assertWalletChipShows(signer.address);
  await eunomia.friendbotIfNeeded();

  // The form opens on USDC: no starting-funds field, the limits are in USDC.
  await expect(page.getByRole("button", { name: /^USDC/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel(/starting funds/i)).toHaveCount(0);
  await page.getByLabel(/daily limit.*usdc/i).fill("50");
  await page.getByLabel(/per-payment limit.*usdc/i).fill("10");
  await page.screenshot({ path: "test-results/try-1-setup.png" });
  await page.getByRole("button", { name: /create treasury/i }).click();
  await eunomia.waitForToast("success", 180_000);
  await eunomia.waitForNoBusyButtons();

  // Add funds → the TRY form, with a live preview of what the amount buys.
  await page.locator("section", { hasText: /rules on stellar/i }).getByRole("button", { name: /^add funds$/i }).click();
  const amount = page.getByLabel(/amount in try/i);
  await amount.fill("200");
  await expect(page.getByText(/treasury receives/i)).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/try-2-amount.png" });

  // Bank details at a locked rate.
  await page.getByRole("button", { name: /get bank details/i }).click();
  await expect(page.getByText(/^TRMA-/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/^TR\d{24}$/)).toBeVisible();
  await page.screenshot({ path: "test-results/try-3-bank.png" });

  // Declare it sent; the anchor pays USDC, the funding account forwards it.
  await page.getByRole("button", { name: /declare the transfer sent/i }).click();
  await expect(page.getByText(/in the treasury/i)).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("link", { name: /^tx / })).toHaveCount(2);
  await page.screenshot({ path: "test-results/try-4-added.png" });

  // 200 TRY is about 4 USDC; the panel's balance row has to say so, in USDC.
  const balance = page.getByTestId("treasury-balance");
  await expect(balance).toContainText("USDC");
  await expect.poll(async () => Number(((await balance.textContent()) ?? "0").split(" ")[0]), { timeout: 60_000 }).toBeGreaterThan(3);
  await page.screenshot({ path: "test-results/try-5-overview.png", fullPage: true });

  // A transfer that stops half-way: the anchor pays the funding account, and the tab that
  // would have forwarded it is gone. Made for real here — a second deposit driven from Node
  // with the page's own funding key, stopping before the forward — then the page is reloaded.
  const secret = await page.evaluate(
    () => Object.entries(localStorage).find(([k]) => k.startsWith("eunomia_funding:"))?.[1] ?? "",
  );
  const funding = Keypair.fromSecret(secret);
  const anchor = await theAnchor();
  const jwt = await signIn(anchor, funding);
  const quote = await firmQuote(anchor, jwt, "deposit", "100.00");
  const dep = await requestDeposit(anchor, jwt, { account: funding.publicKey(), tryAmount: "100.00", quoteId: quote.id });
  await simulateBankTransfer(anchor, jwt, dep.id, "100.00");
  await waitForTransfer(anchor, jwt, dep.id);

  await page.reload();
  await page.locator("section", { hasText: /rules on stellar/i }).getByRole("button", { name: /^add funds$/i }).click();
  await expect(page.getByText(/is waiting outside the treasury/i)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: "test-results/try-6-waiting.png" });
  await page.getByRole("button", { name: /move it in/i }).click();
  await expect(page.getByText(/is waiting outside the treasury/i)).toHaveCount(0, { timeout: 120_000 });
  await expect.poll(async () => Number(((await balance.textContent()) ?? "0").split(" ")[0]), { timeout: 60_000 }).toBeGreaterThan(5);

  expect(pageErrors).toEqual([]);
});
