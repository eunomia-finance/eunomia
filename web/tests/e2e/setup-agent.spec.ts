// "Connect an agent now", in the one signature that creates the treasury.
//
// The knot this unties: an agent's key is made for a treasury id (`eunomia-mcp init
// --treasury <id>`), and during setup there is no treasury yet. The form settles the address
// first — it follows from the salt — and prints the command with it. This spec does what a
// newcomer would: reads the command off the screen, runs the published package, pastes the
// key, signs once, and asks the package whether that agent is on the Leash.
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "@playwright/test";
import { getTestSigner, injectTestSigner, EunomiaPage, expect } from "./eunomiaTest";

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

test("an agent is connected in the same signature that creates the treasury", async ({ eunomia, signer }) => {
  test.info().annotations.push({ type: "network", description: "Stellar testnet + the published eunomia-mcp package" });
  const page = eunomia.page;
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await eunomia.gotoWorkspace();
  await eunomia.connectWallet();
  await eunomia.assertWalletChipShows(signer.address);
  await eunomia.friendbotIfNeeded();

  await page.getByLabel(/daily limit.*usdc/i).fill("50");
  await page.getByLabel(/per-payment limit.*usdc/i).fill("10");
  await page.getByRole("button", { name: /connect an agent now/i }).click();

  // The command on the screen already names the treasury that does not exist yet.
  const command = ((await page.locator(".code", { hasText: "eunomia-mcp init" }).textContent()) ?? "").trim();
  expect(command).toMatch(/^npx -y eunomia-mcp init --treasury C[A-Z2-7]{55}$/);
  const promisedId = command.split(" ").at(-1) as string;

  const home = mkdtempSync(join(tmpdir(), "eunomia-setup-"));
  const run = (cmd: string) => execSync(cmd, { cwd: home, env: { ...process.env, EUNOMIA_HOME: home }, encoding: "utf8", timeout: 240_000 });
  const agentKey = /Agent public key:\s+(G[A-Z2-7]{55})/.exec(run(command))?.[1];
  expect(agentKey, "init printed no agent key").toBeTruthy();

  await page.getByLabel(/agent public key for the leash/i).fill(agentKey as string);
  await page.getByLabel(/leash spending cap/i).fill("25");
  await page.getByLabel(/leash duration/i).fill("24");
  await page.screenshot({ path: "test-results/setup-agent-1-form.png", fullPage: true });
  await page.getByRole("button", { name: /create treasury/i }).click();
  await expect(page.locator('[data-toast-kind="success"]', { hasText: /treasury created/i })).toBeVisible({ timeout: 180_000 });

  // The treasury landed on the address the form promised…
  const createdId = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("prism_treasuries:"));
    return key ? (JSON.parse(localStorage.getItem(key)!) as { ids: string[] }).ids.at(-1) : null;
  });
  expect(createdId).toBe(promisedId);

  // …and the package, holding a key made before that treasury existed, finds itself on its Leash.
  const status = JSON.parse(run(`npx -y eunomia-mcp status --treasury ${promisedId}`)) as {
    session: { isThisAgent: boolean; active: boolean; cap: string } | null;
  };
  expect(status.session?.isThisAgent).toBe(true);
  expect(status.session?.active).toBe(true);
  expect(status.session?.cap).toBe("25");

  expect(pageErrors).toEqual([]);
});
