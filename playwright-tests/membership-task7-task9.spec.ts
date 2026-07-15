import { test, expect } from "@playwright/test";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { HomePage } from "./pages/HomePage";
import { HeaderPage } from "./pages/HeaderPage";

// Combined Playwright acceptance pass for 會員系統 Task 7 (src/proxy.ts page
// route protection) and Task 9 (login page "重新寄送驗證信" resend button +
// 60s cooldown), per the user's standing decision to defer both and run them
// together as the final browser acceptance gate. See
// supabase/tests/auth_routes_manual.md §9 and §10 for the manual scenarios
// these tests automate.
//
// Test accounts: created ahead of this run against the real cloud Supabase
// project configured in .env.local (mirrors how QA set up its Task 8 account).
// - PW_VERIFIED_EMAIL / PW_VERIFIED_PASSWORD: email already confirmed via the
//   Supabase Admin API (no real inbox click needed for automated testing) —
//   used for logged-in route-protection scenarios (Task 7).
// - PW_UNVERIFIED_EMAIL / PW_UNVERIFIED_PASSWORD: registered but never
//   confirmed — used to trigger the "請先至信箱完成驗證再登入" 403 branch that
//   exposes the resend button (Task 9).
const VERIFIED_EMAIL = process.env.PW_VERIFIED_EMAIL!;
const VERIFIED_PASSWORD = process.env.PW_VERIFIED_PASSWORD!;
const UNVERIFIED_EMAIL = process.env.PW_UNVERIFIED_EMAIL!;
const UNVERIFIED_PASSWORD = process.env.PW_UNVERIFIED_PASSWORD!;

test.describe("Task 7: src/proxy.ts route protection", () => {
  test("AC1: unauthenticated /profile redirects to /login", async ({ page }) => {
    const profilePage = new ProfilePage(page);
    await profilePage.navigate();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "登入" })).toBeVisible();
  });

  test("AC2: unauthenticated /login, /register, / all render normally (no redirect)", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/register");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/register$/);

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/$/);
  });

  test("AC3: unauthenticated GET /api/profile returns 401 JSON (API branch unaffected)", async ({
    request,
  }) => {
    const res = await request.get("/api/profile");
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "請先登入" });
  });

  test("AC4/AC5/AC6/AC7: logged-in session redirects /login and /register to /, allows /profile, and reverts on logout", async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);
    const homePage = new HomePage(page);
    const profilePage = new ProfilePage(page);
    const headerPage = new HeaderPage(page);

    await loginPage.navigate();
    await loginPage.login(VERIFIED_EMAIL, VERIFIED_PASSWORD);
    await expect(page).toHaveURL(/\/$/);

    // AC4: logged-in visit to /profile shows the profile page (not a redirect).
    await profilePage.navigate();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(profilePage.heading).toBeVisible();

    // AC5: logged-in visit to /login redirects home.
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/$/);

    // AC6: logged-in visit to /register redirects home.
    await page.goto("/register");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/$/);

    // AC7: after logout, /profile is protected again (reload/back-nav case
    // from §9.1 item 9).
    await homePage.navigate();
    await headerPage.logout();
    await profilePage.navigate();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("Task 9: login page resend-verification button + cooldown", () => {
  test("AC1: resend button only appears on the email_not_confirmed branch, not on wrong password", async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.login(UNVERIFIED_EMAIL, "definitely-wrong-password");

    await expect(loginPage.errorAlert).toBeVisible();
    await expect(loginPage.errorAlert).not.toHaveText(
      "請先至信箱完成驗證再登入"
    );
    await expect(loginPage.resendButton).toHaveCount(0);
  });

  test("AC2: click resend shows loading then the exact generic success message; login form stays usable", async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);

    await loginPage.navigate();
    await loginPage.login(UNVERIFIED_EMAIL, UNVERIFIED_PASSWORD);

    await expect(loginPage.errorAlert).toHaveText("請先至信箱完成驗證再登入");
    await expect(loginPage.resendButton).toBeVisible();
    await expect(loginPage.resendButton).toBeEnabled();

    // Login form must stay visible/usable the whole time (never overlaid).
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
    await expect(loginPage.submitButton).toBeEnabled();

    await loginPage.clickResend();
    await expect(page.getByRole("button", { name: "寄送中…" })).toBeVisible();
    await expect(loginPage.resendMessage).toBeVisible({ timeout: 10_000 });

    // Login form still usable while the resend block shows its result.
    await expect(loginPage.emailInput).toBeEditable();
    await expect(loginPage.passwordInput).toBeEditable();
    await expect(loginPage.submitButton).toBeEnabled();
  });

  test("AC3: after a successful resend, button disables and counts down every second", async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);

    await loginPage.navigate();
    await loginPage.login(UNVERIFIED_EMAIL, UNVERIFIED_PASSWORD);
    await loginPage.clickResend();
    await expect(loginPage.resendMessage).toBeVisible({ timeout: 10_000 });

    await expect(loginPage.resendButton).toBeDisabled();
    let text = await loginPage.resendButtonText();
    expect(text).toMatch(/重新寄送驗證信 \(\d+ 秒後可重試\)/);
    const firstSeconds = Number(text.match(/\((\d+)/)![1]);
    expect(firstSeconds).toBeGreaterThan(0);
    expect(firstSeconds).toBeLessThanOrEqual(60);

    await page.waitForTimeout(3000);
    text = await loginPage.resendButtonText();
    const laterSeconds = Number(text.match(/\((\d+)/)![1]);
    expect(laterSeconds).toBeLessThan(firstSeconds);
    await expect(loginPage.resendButton).toBeDisabled();
  });

  test("AC4 [BUG]: reloading mid-cooldown should resume the countdown (not reset), but the resend block disappears entirely", async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);

    await loginPage.navigate();
    await loginPage.login(UNVERIFIED_EMAIL, UNVERIFIED_PASSWORD);
    await loginPage.clickResend();
    await expect(loginPage.resendMessage).toBeVisible({ timeout: 10_000 });
    await expect(loginPage.resendButton).toBeDisabled();

    await page.reload();
    await page.waitForLoadState("networkidle");

    // Expected per supabase/tests/auth_routes_manual.md §10.5 (item 11): the
    // button should render immediately in its disabled/counting-down state
    // showing the remaining seconds (not a fresh 60s). Actual behavior:
    // `cooldownEndsAt` IS restored from localStorage on mount
    // (src/app/login/page.tsx:32-41), but the surrounding block is gated by
    // `showResend` (line 167: `{showResend && (...)}`), which is plain
    // `useState(false)` and is never set back to `true` from the restored
    // cooldown. So after reload the entire resend button/message block
    // vanishes — not degraded, not reset to a fresh 60s, just gone — even
    // though the cooldown timestamp is still faithfully persisted in
    // localStorage and (if the user re-triggers the 403 branch) would still
    // correctly block a new click. This assertion documents the failure.
    await expect(loginPage.resendButton).toBeVisible({ timeout: 3000 });
  });

  test("AC5: countdown reaches 0 and button returns to idle/clickable without reload", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const loginPage = new LoginPage(page);

    await loginPage.navigate();
    await loginPage.login(UNVERIFIED_EMAIL, UNVERIFIED_PASSWORD);
    await loginPage.clickResend();
    await expect(loginPage.resendMessage).toBeVisible({ timeout: 10_000 });

    const text = await loginPage.resendButtonText();
    const seconds = Number(text.match(/\((\d+)/)![1]);

    await expect(loginPage.resendButton).toHaveText("重新寄送驗證信", {
      timeout: (seconds + 10) * 1000,
    });
    await expect(loginPage.resendButton).toBeEnabled();

    // Login form (email/password/登入) remained visible & usable throughout.
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
  });
});
