// The newcomer path the anchor leg opens, on the live site: a passkey, a USDC treasury, and
// lira in through the anchor — without the owner ever holding XLM. The relay pays for the
// wallet and the treasury; the funding account pays for its own two transactions.
//
//   npx playwright test --config playwright.live.config.ts passkey-try.live
//
// What it measures that the wallet-driven spec cannot: the factory call goes through the
// relay with a token that is not the native asset, and the whole funding leg costs the
// passkey ZERO signatures. Spends no faucet allocation — that is the point.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type CDPSession, type Page } from "@playwright/test";
import { Client as TreasuryClient } from "../../src/lib/treasuryClient";
import { ANCHOR_USDC } from "../../src/lib/token";
import { NETWORK_PASSPHRASE, RPC_URL } from "../../src/config";

const EXCLUDE = fileURLToPath(new URL("../../../docs/metrics/e2e-exclude.json", import.meta.url));

/** Keep this run's throwaway wallet out of the user evidence (see passkey.live.spec.ts). */
function excludeFromUserCount(wallet: string): void {
  const file = JSON.parse(readFileSync(EXCLUDE, "utf8")) as { note: string; wallets: string[] };
  if (file.wallets.includes(wallet)) return;
  file.wallets.push(wallet);
  writeFileSync(EXCLUDE, JSON.stringify(file, null, 2) + "\n");
}

async function enableVirtualPasskey(page: Page): Promise<{ cdp: CDPSession; authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

async function signatures(cdp: CDPSession, authenticatorId: string): Promise<number> {
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  return credentials.reduce((n, c) => n + (c.signCount ?? 0), 0);
}

test("a passkey owner creates a USDC treasury and funds it with TRY, holding no XLM", async ({ page }) => {
  test.info().annotations.push({
    type: "network",
    description: "Drives eunomia.finance, the relay, tr-mock-anchor.fly.dev and Stellar testnet for real",
  });

  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  const badResponses: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
  });
  const why = () => `\nfailed requests: ${badResponses.join(" | ")}\nconsole: ${consoleErrors.join(" | ")}`;

  const { cdp, authenticatorId } = await enableVirtualPasskey(page);
  await page.goto("/");
  await page.getByRole("button", { name: /create your treasury with a passkey/i }).first().click();
  const saved = page.getByRole("button", { name: /i saved it/i });
  await saved.waitFor({ state: "visible", timeout: 120_000 });
  await saved.click();
  await expect(page).toHaveURL(/#(overview|setup)/, { timeout: 120_000 });

  // The form opens on USDC, and a smart wallet on that path is not asked to fetch XLM.
  await expect(page.getByRole("button", { name: /^USDC/ })).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
  await expect(page.getByRole("button", { name: /get free testnet xlm/i })).toHaveCount(0);
  await page.getByLabel(/daily limit.*usdc/i).fill("50");
  await page.getByLabel(/per-payment limit.*usdc/i).fill("10");

  const beforeCreate = await signatures(cdp, authenticatorId);
  await page.getByRole("button", { name: /create treasury/i }).first().click();
  await expect(page.locator('[data-toast-kind="success"]', { hasText: /treasury created/i }), why()).toBeVisible({
    timeout: 180_000,
  });
  const afterCreate = await signatures(cdp, authenticatorId);
  expect(afterCreate - beforeCreate, "passkey prompts during setup").toBe(1);

  // Lira in. None of this may touch the passkey.
  await page.locator("section", { hasText: /rules on stellar/i }).getByRole("button", { name: /^add funds$/i }).click();
  await page.getByLabel(/amount in try/i).fill("200");
  await expect(page.getByText(/treasury receives/i)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /get bank details/i }).click();
  await expect(page.getByText(/^TRMA-/), why()).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: /declare the transfer sent/i }).click();
  await expect(page.getByText(/in the treasury/i), why()).toBeVisible({ timeout: 180_000 });
  expect(await signatures(cdp, authenticatorId), "passkey prompts during funding").toBe(afterCreate);

  const errors = await page.locator('[data-toast-kind="error"]').allTextContents();
  expect(errors, `an error toast was raised: ${errors.join(" | ")}${why()}`).toEqual([]);

  // And the chain agrees: a USDC treasury owned by the smart wallet, holding about 4 USDC.
  const created = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("prism_treasuries:"));
    if (!key) return null;
    const rec = JSON.parse(localStorage.getItem(key)!) as { ids: string[] };
    return { wallet: key.slice("prism_treasuries:".length), treasury: rec.ids.at(-1) };
  });
  expect(created, "no treasury was recorded for this wallet").not.toBeNull();
  expect(created!.wallet).toMatch(/^C[A-Z2-7]{55}$/);
  const treasury = new TreasuryClient({ contractId: created!.treasury!, networkPassphrase: NETWORK_PASSPHRASE, rpcUrl: RPC_URL });
  const cfg = (await treasury.get_config()).result;
  expect(cfg.admin).toBe(created!.wallet);
  expect(cfg.token).toBe(ANCHOR_USDC);
  expect((await treasury.balance()).result).toBeGreaterThan(30_000_000n);

  expect(pageErrors).toEqual([]);
  excludeFromUserCount(created!.wallet);
  test.info().annotations.push({
    type: "created",
    description: `wallet ${created!.wallet} → USDC treasury ${created!.treasury} (excluded from user count)`,
  });
  console.log(`wallet ${created!.wallet} -> USDC treasury ${created!.treasury}`);
});
