// The README's product screenshots, taken from a real run (see playwright.shots.config.ts).
// One treasury, start to finish: created over USDC with a first payee, funded with TRY through
// the anchor, paid from twice, refused twice — once over the per-payment cap, once to a
// stranger — then handed to an agent on a Leash. Each picture is the screen at that moment.
import { test as base } from "@playwright/test";
import { Keypair } from "@stellar/stellar-sdk";
import { fileURLToPath } from "node:url";
import { getTestSigner, injectTestSigner, EunomiaPage, expect } from "./eunomiaTest";
import { theAnchor } from "../../src/lib/anchor/addFunds";
import { openFundingAccount } from "../../src/lib/anchor/fundingAccount";
import { fundWithFriendbot } from "../../src/lib/funding";

const OUT = fileURLToPath(new URL("../../../docs/screenshots/", import.meta.url));

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

test("screenshots for the README", async ({ eunomia }) => {
  const page = eunomia.page;
  const shot = async (name: string) => {
    // Toasts sit over the top-right corner for a few seconds; a picture waits them out.
    await expect(page.locator("[data-toast-kind]")).toHaveCount(0, { timeout: 30_000 });
    await page.screenshot({ path: `${OUT}${name}.png` });
  };
  const payByHand = async (to: string, amount: string, expectKind: "success" | "error") => {
    await page.goto("/#payments");
    // The form is folded behind "Pay by hand" on first visit and stays open afterwards —
    // wait for whichever of the two is on screen before deciding (isVisible() alone answers
    // "no" to a page that has not painted yet).
    const open = page.getByRole("button", { name: /^pay by hand$/i });
    const dest = page.getByLabel(/payment destination address/i);
    await expect(open.or(dest).first()).toBeVisible({ timeout: 30_000 });
    if (!(await dest.isVisible())) await open.click();
    await dest.fill(to);
    await page.getByLabel(/payment amount.*usdc/i).fill(amount);
    await page.getByRole("button", { name: /^send payment/i }).click();
    await expect(page.locator(`[data-toast-kind="${expectKind}"]`).first()).toBeVisible({ timeout: 180_000 });
    await eunomia.waitForNoBusyButtons();
    await expect(page.locator("[data-toast-kind]")).toHaveCount(0, { timeout: 30_000 });
  };

  // A payee that can hold USDC, and a stranger the treasury has never heard of.
  const anchor = await theAnchor();
  const payee = Keypair.random();
  const stranger = Keypair.random();
  await Promise.all([payee, stranger].map((k) => fundWithFriendbot(k.publicKey())));
  await openFundingAccount(payee, anchor);

  await eunomia.gotoWorkspace();
  await eunomia.connectWallet();
  await eunomia.friendbotIfNeeded();

  // 1 · setup — rules, a first payee, one signature
  await page.getByLabel(/daily limit.*usdc/i).fill("50");
  await page.getByLabel(/per-payment limit.*usdc/i).fill("10");
  await page.getByRole("button", { name: /approve a payee now/i }).click();
  await page.getByLabel(/first approved payee/i).fill(payee.publicKey());
  await shot("setup");
  await page.getByRole("button", { name: /create treasury/i }).click();
  await expect(page.locator('[data-toast-kind="success"]', { hasText: /treasury created/i })).toBeVisible({ timeout: 180_000 });
  await eunomia.waitForNoBusyButtons();

  // 2 · add funds with TRY — the bank details at a locked rate
  await page.locator("section", { hasText: /rules on stellar/i }).getByRole("button", { name: /^add funds$/i }).click();
  await page.getByLabel(/amount in try/i).fill("1500");
  await expect(page.getByText(/treasury receives/i)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /get bank details/i }).click();
  await expect(page.getByText(/^TRMA-/)).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(900); // the slot scrolls itself to the middle of the screen
  await shot("add-funds-try");
  await page.getByRole("button", { name: /declare the transfer sent/i }).click();
  await expect(page.getByText(/in the treasury/i)).toBeVisible({ timeout: 180_000 });

  // 3 · two payments the rules allow, two they refuse
  await payByHand(payee.publicKey(), "2.5", "success");
  await payByHand(payee.publicKey(), "4", "success");
  await payByHand(payee.publicKey(), "15", "error"); // over the 10 USDC per-payment cap
  await payByHand(stranger.publicKey(), "1", "error"); // not an approved payee

  // 4 · an agent on a Leash
  await page.goto("/#agent");
  await page.getByLabel(/session spending cap/i).fill("25");
  await page.getByLabel(/session duration in hours/i).fill("24");
  await page.getByRole("button", { name: /^start leash$/i }).click();
  await expect(page.getByText(/leash · active/i)).toBeVisible({ timeout: 180_000 });
  await eunomia.waitForNoBusyButtons();
  await shot("agent-leash");

  // 5 · the Overview: what the rules did
  await page.goto("/#overview");
  await page.reload();
  await expect(page.getByTestId("treasury-balance")).toContainText("USDC", { timeout: 60_000 });
  await expect(page.getByText(/latest decision ·/i)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500); // entrance motion settles
  await shot("overview");
});
