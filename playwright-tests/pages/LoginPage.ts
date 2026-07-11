import type { Page, Locator } from "@playwright/test";

/**
 * Page object for src/app/login/page.tsx.
 *
 * The app has no `data-testid` attributes anywhere yet (confirmed via repo
 * grep before writing these tests), and this task's scope is verification
 * only — no application code changes. Locators below use accessible,
 * semantic selectors (label text, role, exact button text) instead, which is
 * the standard Playwright fallback when test ids aren't present.
 */
export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorAlert: Locator;
  readonly resendButton: Locator;
  readonly resendMessage: Locator;
  readonly resendError: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel("Email");
    this.passwordInput = page.getByLabel("密碼");
    this.submitButton = page.getByRole("button", { name: "登入" });
    // Scoped to the form-level error <p role="alert">, not Next.js's
    // internal route-announcer div (which also has role="alert").
    this.errorAlert = page.locator("form p[role='alert']");
    this.resendButton = page.getByRole("button", { name: /重新寄送驗證信|寄送中/ });
    this.resendMessage = page.getByText(
      "若該信箱已註冊且尚未驗證，驗證信已重新寄出",
      { exact: true }
    );
    this.resendError = page.getByText("連線失敗，請稍後再試", { exact: true });
  }

  async navigate() {
    await this.page.goto("/login");
    await this.page.waitForLoadState("networkidle");
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async clickResend() {
    await this.resendButton.click();
  }

  /** Reads the current button label text (used to parse remaining seconds). */
  async resendButtonText(): Promise<string> {
    return (await this.resendButton.textContent())?.trim() ?? "";
  }
}
