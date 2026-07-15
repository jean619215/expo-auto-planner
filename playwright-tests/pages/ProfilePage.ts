import type { Page, Locator } from "@playwright/test";

export class ProfilePage {
  readonly page: Page;
  readonly heading: Locator;
  readonly loginPrompt: Locator;
  readonly nicknameDisplay: Locator;
  readonly nicknameInput: Locator;
  readonly editButton: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  readonly saveSuccessMessage: Locator;
  readonly saveErrorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: "個人資料" });
    this.loginPrompt = page.getByText("請先登入。");
    this.nicknameDisplay = page.getByTestId("profile-nickname-display");
    this.nicknameInput = page.getByTestId("profile-nickname-input");
    this.editButton = page.getByTestId("profile-edit-button");
    this.saveButton = page.getByTestId("profile-save-button");
    this.cancelButton = page.getByTestId("profile-cancel-button");
    this.saveSuccessMessage = page.getByTestId("profile-save-success");
    this.saveErrorMessage = page.getByTestId("profile-save-error");
  }

  async navigate() {
    await this.page.goto("/profile");
    await this.page.waitForLoadState("networkidle");
  }

  async startEdit() {
    await this.editButton.click();
  }

  async fillNickname(value: string) {
    await this.nicknameInput.fill(value);
  }

  async save() {
    await this.saveButton.click();
  }

  async cancel() {
    await this.cancelButton.click();
  }
}
