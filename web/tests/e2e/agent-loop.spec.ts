// The claim the whole product rests on, driven through the UI: an agent spends by itself,
// the rules refuse it when it steps outside them, and it comes back asking the owner —
// without the owner signing anything after the Leash. Three real transactions on testnet.
import { test as base } from "@playwright/test";
import { Keypair } from "@stellar/stellar-sdk";
import { getTestSigner, injectTestSigner, EunomiaPage, expect } from "./eunomiaTest";
import { fundWithFriendbot } from "../../src/lib/funding";

const test = base.extend<{ eunomia: EunomiaPage; signer: ReturnType<typeof getTestSigner> }>({
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

test("the agent pays, gets refused, and asks the owner — on its own", async ({ eunomia, signer }) => {
  test.info().annotations.push({ type: "network", description: "Stellar testnet" });
  const page = eunomia.page;
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await eunomia.gotoWorkspace();
  await eunomia.connectWallet();
  await eunomia.assertWalletChipShows(signer.address);
  await eunomia.friendbotIfNeeded();

  // An XLM treasury, funded at creation — the loop needs a balance and room under the rules.
  await page.getByRole("button", { name: /^XLM/ }).click();
  await page.getByLabel(/daily limit.*xlm/i).fill("50");
  await page.getByLabel(/per-payment limit.*xlm/i).fill("10");
  await page.getByLabel(/starting funds/i).fill("20");
  await page.getByRole("button", { name: /create treasury/i }).click();
  await eunomia.waitForToast("success", 180_000);
  await eunomia.waitForNoBusyButtons();

  // One payee the owner approves. The loop asks the contract who is on the list, so this is
  // the address step 1 has to pay.
  const payee = Keypair.random();
  await fundWithFriendbot(payee.publicKey());
  await eunomia.whitelistPayee(payee.publicKey());

  // The Leash, with the key on this device: no agent key pasted means the built-in agent.
  await page.goto("/#agent");
  await page.getByLabel(/session spending cap/i).fill("25");
  await page.getByLabel(/session duration in hours/i).fill("24");
  await page.getByRole("button", { name: /^start leash$/i }).click();
  await expect(page.getByText(/leash · active/i)).toBeVisible({ timeout: 180_000 });

  // Everything below happens without another signature.
  const loop = page.locator("section", { hasText: /watch it spend without you/i });
  await expect(loop).toBeVisible();
  await page.screenshot({ path: "test-results/loop-1-before.png", fullPage: true });
  await loop.getByRole("button", { name: /^run the agent$/i }).click();

  const step = (title: RegExp) => loop.locator(".step", { hasText: title });

  // 1. A payment the rules allow.
  const paid = step(/pays a payee you approved/i);
  await expect(paid.locator(".pill--ok")).toHaveText("done", { timeout: 180_000 });
  await expect(paid).toContainText(payee.publicKey().slice(0, 4));
  await expect(paid.getByRole("link", { name: /^tx/ })).toBeVisible();

  // 2. A payment they refuse — the contract's own answer, with its reason.
  const refused = step(/tries an address you never approved/i);
  await expect(refused.locator(".pill--no")).toHaveText("refused", { timeout: 180_000 });
  await expect(refused).toContainText(/isn't approved|not on the whitelist/i);

  // 3. The agent asks for that one back.
  const asked = step(/asks you to allow it/i);
  await expect(asked.locator(".pill--ok")).toHaveText("done", { timeout: 180_000 });
  await page.screenshot({ path: "test-results/loop-2-ran.png", fullPage: true });

  // And the owner has something to resolve, read from the agent's own Stellar account.
  const waiting = page.locator("section", { hasText: /asked to pay outside your rules/i });
  await expect(waiting).toBeVisible({ timeout: 60_000 });
  await expect(waiting.locator(".pill--rule", { hasText: /pending/i }).first()).toBeVisible();
  await expect(waiting).toContainText(/isn't approved|not on the whitelist/i);
  await page.screenshot({ path: "test-results/loop-3-waiting.png", fullPage: true });

  // Both decisions land in the owner's ledger — the payment the agent made, and the one the
  // rules refused. The refusal row is read from the request the agent filed on its own
  // account, which is the only record an agent on another machine leaves behind; it names
  // the rule and the payee, and it replaces this app's own thinner telemetry row.
  await page.goto("/#overview");
  await page.reload();
  await expect(page.locator(".ledger__row", { hasText: /leash-signed agent payment/i }).first()).toBeVisible({ timeout: 120_000 });
  const refusal = page.locator(".ledger__row", { hasText: /agent payment refused/i });
  await expect(refusal.first()).toBeVisible({ timeout: 60_000 });
  await expect(refusal).toHaveCount(1);
  await expect(page.locator(".ledger__row", { hasText: /payment blocked by/i })).toHaveCount(0);
  await page.screenshot({ path: "test-results/loop-4-ledger.png", fullPage: true });

  expect(pageErrors).toEqual([]);
});
