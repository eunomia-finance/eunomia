// The return visit, driven for real: create a passkey wallet on eunomia.finance, throw the
// browser session away, come back and sign in with the SAME passkey — and land on the same
// wallet. Before 2026-09-16 the landing page only knew how to create, so every return visit
// minted a fresh wallet (and a fresh recovery code) for a user who already had one.
//
// Runs against production: the passkey is bound to rp.id eunomia.finance and the relay that
// deploys the wallet is Production-scoped. Costs one relay-sponsored wallet deploy per run —
// a real mainnet fee — and creates no treasury.
//
//   npx playwright test --config playwright.live.config.ts passkey-signin
import { test, expect, type CDPSession, type Page } from "@playwright/test";

async function enableVirtualPasskey(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return cdp;
}

const sessionAddress = (page: Page) =>
  page.evaluate(() => sessionStorage.getItem("prism_wallet_address"));

test.describe.serial("Live passkey sign-in", () => {
  test("a returning visitor signs in with the passkey they created and gets the same wallet", async ({
    page,
  }) => {
    test.info().annotations.push({
      type: "network",
      description: "Drives eunomia.finance, the relay and Stellar mainnet for real",
    });
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });

    await enableVirtualPasskey(page);
    // The doors are in the app's gate now (the landing page has one button, which leads here).
    await page.goto("/#overview");

    // 1. First visit: create. The virtual authenticator stores a discoverable credential.
    await page.getByRole("button", { name: /start with a passkey/i }).first().click();
    const saved = page.getByRole("button", { name: /i saved it/i });
    await saved.waitFor({ state: "visible", timeout: 120_000 });
    await saved.click();
    await expect(page).toHaveURL(/#(overview|setup)/, { timeout: 120_000 });
    const created = await sessionAddress(page);
    expect(created, "no wallet address after creation").toMatch(/^C[A-Z2-7]{55}$/);

    // 2. A remembered device: a plain reload keeps the session without any prompt.
    await page.reload();
    await expect.poll(() => sessionAddress(page), { timeout: 30_000 }).toBe(created);

    // 3. A forgotten device (new browser, cleared site data): the gate must offer a way
    //    back in that does not mint a wallet.
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.clear();
    });
    await page.goto("/#overview");
    await page.reload();
    await expect(page.getByRole("button", { name: /start with a passkey/i }).first()).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: /already made a treasury with a passkey/i }).first().click();

    // 4. Same wallet, no recovery-code modal, straight into the workspace.
    await expect(page).toHaveURL(/#(overview|setup)/, { timeout: 120_000 });
    await expect.poll(() => sessionAddress(page), { timeout: 30_000 }).toBe(created);
    expect(await page.getByRole("button", { name: /i saved it/i }).count()).toBe(0);
    expect(consoleErrors.filter((m) => /passkey|wallet/i.test(m)), consoleErrors.join(" | ")).toEqual([]);
  });
});
