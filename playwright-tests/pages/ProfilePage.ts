import type { Page, Locator } from "@playwright/test";

export class ProfilePage {
  readonly page: Page;
  readonly heading: Locator;
  readonly nicknameInput: Locator;
  readonly loginPrompt: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: "個人資料" });
    this.nicknameInput = page.getByLabel("暱稱");
    this.loginPrompt = page.getByText("請先登入。");
  }

  async navigate() {
    await this.page.goto("/profile");
    await this.page.waitForLoadState("networkidle");
  }
}
