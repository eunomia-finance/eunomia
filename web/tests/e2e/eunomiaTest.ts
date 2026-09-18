import { expect } from "@playwright/test";
import type { Page, BrowserContext, Locator } from "@playwright/test";
import { Keypair } from "@stellar/stellar-sdk";

export interface TestSignerConfig {
  secretKey: string;
  address: string;
}

export function getTestSigner(): TestSignerConfig {
  const secretKey = process.env.PLAYWRIGHT_TEST_WALLET_SECRET;
  if (secretKey) {
    const kp = Keypair.fromSecret(secretKey);
    return { secretKey, address: kp.publicKey() };
  }
  const fresh = Keypair.random();
  return { secretKey: fresh.secret(), address: fresh.publicKey() };
}

export async function injectTestSigner(
  context: BrowserContext,
  config: TestSignerConfig,
): Promise<void> {
  await context.addInitScript(
    ({ secretKey }) => {
      (
        window as unknown as { __EUNOMIA_TEST_SIGNER__?: { secretKey: string } }
      ).__EUNOMIA_TEST_SIGNER__ = {
        secretKey,
      };
    },
    { secretKey: config.secretKey },
  );
}

export class EunomiaPage {
  constructor(public readonly page: Page) {}

  private toast(kind: "success" | "error" | "info"): Locator {
    return this.page.locator(`[data-toast-kind="${kind}"]`).first();
  }

  async gotoLanding(): Promise<void> {
    await this.page.goto("/");
    await this.page.waitForLoadState("networkidle");
  }

  async gotoWorkspace(): Promise<void> {
    await this.page.goto("/#overview");
    await this.page.waitForLoadState("networkidle");
  }

  async assertNoConsoleErrorsOnLanding(): Promise<void> {
    const errors: string[] = [];
    const handler = (msg: { type: () => string; text: () => string }) => {
      if (msg.type() === "error") errors.push(msg.text());
    };
    this.page.on("console", handler);
    try {
      await this.gotoLanding();
      await this.page.waitForTimeout(1500);
      if (errors.length > 0) {
        throw new Error(`Console errors on landing: ${errors.join("\n")}`);
      }
    } finally {
      this.page.off("console", handler);
    }
  }

  async waitForToast(
    kind: "success" | "error" | "info",
    timeoutMs = 120_000,
  ): Promise<string> {
    const t = this.toast(kind);
    await t.waitFor({ state: "visible", timeout: timeoutMs });
    const text = (await t.textContent()) ?? "";
    return text;
  }

  async waitForNoBusyButtons(timeoutMs = 180_000): Promise<void> {
    const start = Date.now();
    // Busy buttons in this app end with an ellipsis ("Connecting…", "Funding…").
    // Match only a TRAILING ellipsis — the connected-wallet chip ("GDT6…JSJH")
    // carries one mid-string and must not read as busy.
    const busyRe = /(…|\.\.\.)\s*$/;
    while (Date.now() - start < timeoutMs) {
      const btns = await this.page.getByRole("button").all();
      let anyBusy = false;
      for (const b of btns) {
        try {
          const t = (await b.textContent()) ?? "";
          if (busyRe.test(t.trim())) {
            anyBusy = true;
            break;
          }
        } catch {
          /* detached — ignore */
        }
      }
      if (!anyBusy) return;
      await this.page.waitForTimeout(500);
    }
    throw new Error("Buttons stayed busy past timeout");
  }

  // ---- Setup page -------------------------------------------------------------

  async connectWallet(): Promise<void> {
    const btn = this.page
      .getByRole("button", { name: /connect wallet/i })
      .first();
    try {
      await btn.waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      return;
    }
    await btn.click();
    await this.page.waitForTimeout(1500);
  }

  async friendbotIfNeeded(): Promise<void> {
    const btn = this.page
      .getByRole("button", { name: /get free testnet xlm/i })
      .first();
    if (await btn.isVisible()) {
      await btn.click();
      await this.waitForToast("success", 90_000);
      await this.waitForNoBusyButtons();
    }
  }

  async deployTreasury(daily = "50", perTask = "10"): Promise<void> {
    // This suite walks the XLM treasury (wallet-funded). The form opens on USDC, whose
    // funding runs through the TRY anchor — covered by src/lib/anchor/live.test.ts.
    const xlmChip = this.page.getByRole("button", { name: /^XLM/ }).first();
    await xlmChip.waitFor({ state: "visible", timeout: 30_000 });
    await xlmChip.click();

    const dailyInput = this.page.getByLabel(/daily limit.*xlm/i).first();
    await dailyInput.waitFor({ state: "visible", timeout: 30_000 });
    await dailyInput.fill(daily);

    const perTaskInput = this.page
      .getByLabel(/per-payment limit.*xlm/i)
      .first();
    await perTaskInput.fill(perTask);

    const deployBtn = this.page
      .getByRole("button", { name: /create treasury/i })
      .first();
    await deployBtn.click();

    await this.page.waitForFunction(
      () => {
        const el = document.querySelector('[data-toast-kind="success"]');
        return (
          !!el && /created|treasury/i.test(el.textContent ?? "")
        );
      },
      null,
      { timeout: 180_000 },
    );
    await this.waitForNoBusyButtons();
  }

  // ---- Overview ---------------------------------------------------------------

  async fundTreasury(amountXlm = "20"): Promise<void> {
    await this.page.goto("/#overview");
    await this.page.waitForLoadState("networkidle");

    // The rules panel opens the fund form behind "Add funds"; the submit inside it is
    // named exactly "Fund", so /^fund$/ below resolves to one button.
    // Scoped to that panel: the setup nudge above it can carry an "Add funds" button too.
    const toggle = this.page
      .locator("section", { hasText: /rules on stellar/i })
      .getByRole("button", { name: /^add funds$/i });
    await toggle.waitFor({ state: "visible" });
    await toggle.click();

    const input = this.page.getByLabel(/fund amount.*xlm/i).first();
    await input.waitFor({ state: "visible" });
    await input.fill(amountXlm);

    const fundBtn = this.page.getByRole("button", { name: /^fund$/i }).first();
    await fundBtn.click();

    await this.page.waitForFunction(
      () => {
        const el = document.querySelector('[data-toast-kind="success"]');
        return !!el && /funded/i.test(el.textContent ?? "");
      },
      null,
      { timeout: 120_000 },
    );
    await this.waitForNoBusyButtons();
  }

  // ---- Payments ---------------------------------------------------------------

  async goToPayments(): Promise<void> {
    await this.page.goto("/#payments");
    await this.page.waitForLoadState("networkidle");
  }

  // Payees live in a standing side panel now (no tab); the hand-payment form is folded
  // behind "Pay by hand" — the product is the agent paying, this is the escape hatch.
  async switchToPayeesTab(): Promise<void> {
    await this.page.getByLabel(/^payee address$/i).first().waitFor({ state: "visible" });
  }

  async switchToSendTab(): Promise<void> {
    const open = this.page.getByRole("button", { name: /^pay by hand$/i }).first();
    await open.waitFor({ state: "visible" });
    await open.click();
  }

  async whitelistPayee(address: string): Promise<void> {
    await this.goToPayments();
    await this.switchToPayeesTab();

    const input = this.page.getByLabel(/^payee address$/i).first();
    await input.waitFor({ state: "visible" });
    await input.fill(address);

    const addBtn = this.page
      .getByRole("button", { name: /^add payee/i })
      .first();
    await addBtn.click();

    await this.page.waitForFunction(
      () => {
        const el = document.querySelector('[data-toast-kind="success"]');
        return !!el && /approved|payee/i.test(el.textContent ?? "");
      },
      null,
      { timeout: 120_000 },
    );
    await this.waitForNoBusyButtons();
  }

  async sendPayment(to: string, amountXlm: string): Promise<void> {
    await this.goToPayments();
    await this.switchToSendTab();

    const toInput = this.page
      .getByLabel(/payment destination address/i)
      .first();
    await toInput.waitFor({ state: "visible" });
    await toInput.fill(to);

    const amtInput = this.page.getByLabel(/payment amount.*xlm/i).first();
    await amtInput.fill(amountXlm);

    const sendBtn = this.page
      .getByRole("button", { name: /^send payment/i })
      .first();
    await sendBtn.click();

    await this.page.waitForFunction(
      () => {
        const el = document.querySelector('[data-toast-kind="success"]');
        return !!el && /paid|sent|payment/i.test(el.textContent ?? "");
      },
      null,
      { timeout: 120_000 },
    );
    await this.waitForNoBusyButtons();
  }

  async readBalanceStroops(): Promise<bigint> {
    // goto("/#overview") is a no-op when the app is already on that hash, so the stale
    // pre-transaction balance would be read back. Reload for a fresh on-chain fetch,
    // then wait out the async balance query (it first renders as 0).
    await this.page.goto("/#overview");
    await this.page.reload();
    await this.page.waitForLoadState("networkidle");
    // The balance is a row in the rules panel since the control-room redesign; the old
    // `.ov__balance` hero it used to be read from no longer renders.
    const bal = this.page.getByTestId("treasury-balance").first();
    await bal.waitFor({ state: "visible" });
    await this.page.waitForFunction(
      () => /[1-9]/.test(document.querySelector('[data-testid="treasury-balance"]')?.textContent ?? ""),
      null,
      { timeout: 60_000 },
    );
    const text = (await bal.textContent()) ?? "";
    const match = text.match(/([\d][\d.]*)/);
    if (!match) throw new Error(`Could not read balance from: "${text}"`);
    const xlm = Number(match[1]);
    if (!Number.isFinite(xlm))
      throw new Error(`Balance parse error: ${match[1]}`);
    return BigInt(Math.round(xlm * 10_000_000));
  }

  async assertBalanceGt(minStroops: bigint): Promise<void> {
    const b = await this.readBalanceStroops();
    if (b <= minStroops) {
      throw new Error(`Balance ${b} stroops ≤ ${minStroops} minimum`);
    }
  }

  async assertWalletChipShows(address: string): Promise<void> {
    const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
    await expect(this.page.getByText(short)).toBeVisible({ timeout: 15_000 });
  }
}

// Re-export expect so the spec gets the same Playwright instance.
export { expect } from "@playwright/test";
