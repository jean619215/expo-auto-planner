import { test, expect } from "@playwright/test";
import { LoginPage } from "./pages/LoginPage";
import { HeaderPage } from "./pages/HeaderPage";

// Playwright acceptance pass for Task 1 of 全站導覽 Header 與個人資料編輯模式:
// the global Header component mounted in RootLayout. See
// .claude/pipeline/orchestrator-output.md for the full Clarified Acceptance
// Criteria this spec covers.
const VERIFIED_EMAIL = process.env.PW_VERIFIED_EMAIL!;
const VERIFIED_PASSWORD = process.env.PW_VERIFIED_PASSWORD!;

test.describe("Header: presence and layout", () => {
  test("header is present on /, /login, and /register", async ({ page }) => {
    const headerPage = new HeaderPage(page);

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(headerPage.homeLink).toBeVisible();

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await expect(headerPage.homeLink).toBeVisible();

    await page.goto("/register");
    await page.waitForLoadState("networkidle");
    await expect(headerPage.homeLink).toBeVisible();
  });
});

test.describe("Header: logged-out state", () => {
  test("shows login/register, hides nav links, and navigates correctly", async ({
    page,
  }) => {
    const headerPage = new HeaderPage(page);

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(headerPage.loginLink).toBeVisible();
    await expect(headerPage.registerLink).toBeVisible();
    await expect(headerPage.navProfileLink).toHaveCount(0);
    await expect(headerPage.navVenueLink).toHaveCount(0);
    await expect(headerPage.logoutButton).toHaveCount(0);

    await headerPage.loginLink.click();
    await expect(page).toHaveURL(/\/login$/);

    await headerPage.homeLink.click();
    await expect(page).toHaveURL(/\/$/);

    await headerPage.registerLink.click();
    await expect(page).toHaveURL(/\/register$/);
  });
});

test.describe("Header: logged-in state", () => {
  test("shows nav links and profile/logout, navigates correctly, logout flips state without full reload", async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);
    const headerPage = new HeaderPage(page);

    await loginPage.navigate();
    await loginPage.login(VERIFIED_EMAIL, VERIFIED_PASSWORD);
    await expect(page).toHaveURL(/\/$/);

    await expect(headerPage.navProfileLink).toBeVisible();
    await expect(headerPage.navVenueLink).toBeVisible();
    await expect(headerPage.profileLink).toBeVisible();
    await expect(headerPage.logoutButton).toBeVisible();
    await expect(headerPage.loginLink).toHaveCount(0);
    await expect(headerPage.registerLink).toHaveCount(0);

    await headerPage.navVenueLink.click();
    await expect(page).toHaveURL(/\/venue$/);
    await expect(headerPage.homeLink).toBeVisible();

    await headerPage.navProfileLink.click();
    await expect(page).toHaveURL(/\/profile$/);

    await headerPage.logout();
    await expect(headerPage.loginLink).toBeVisible();
    await expect(headerPage.navProfileLink).toHaveCount(0);
  });
});

test.describe("Home page: no duplicate auth controls", () => {
  test("exactly one login link and one register link render on /", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("link", { name: "登入" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "註冊" })).toHaveCount(1);
  });
});
