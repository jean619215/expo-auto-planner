import type { Page, Locator } from "@playwright/test";

export class HomePage {
  readonly page: Page;
  readonly loginLink: Locator;
  readonly registerLink: Locator;
  readonly profileLink: Locator;
  readonly logoutButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.loginLink = page.getByRole("link", { name: "登入" });
    this.registerLink = page.getByRole("link", { name: "註冊" });
    this.profileLink = page.getByRole("link", { name: "個人資料" });
    this.logoutButton = page.getByRole("button", { name: /登出/ });
  }

  async navigate() {
    await this.page.goto("/");
    await this.page.waitForLoadState("networkidle");
  }

  async logout() {
    await this.logoutButton.click();
    // AuthNav swaps to the logged-out link set once state flips.
    await this.loginLink.waitFor({ state: "visible" });
  }
}
