import type { Page, Locator } from "@playwright/test";

export class HeaderPage {
  readonly page: Page;
  readonly homeLink: Locator;
  readonly navVenueLink: Locator;
  readonly authLoading: Locator;
  readonly profileLink: Locator;
  readonly logoutButton: Locator;
  readonly loginLink: Locator;
  readonly registerLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.homeLink = page.getByTestId("header-home-link");
    this.navVenueLink = page.getByTestId("header-nav-venue-link");
    this.authLoading = page.getByTestId("header-auth-loading");
    this.profileLink = page.getByTestId("header-profile-link");
    this.logoutButton = page.getByTestId("header-logout-button");
    this.loginLink = page.getByTestId("header-login-link");
    this.registerLink = page.getByTestId("header-register-link");
  }

  async logout() {
    await this.logoutButton.click();
    await this.loginLink.waitFor({ state: "visible" });
  }
}
