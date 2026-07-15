import { test, expect } from "@playwright/test";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";

// Playwright acceptance pass for Task 2 (LAST task) of 全站導覽 Header 與個人資料
//編輯模式: the profile page's view/edit mode toggle for the nickname field.
// See .claude/pipeline/orchestrator-output.md for the full Clarified
// Acceptance Criteria this spec covers.
const VERIFIED_EMAIL = process.env.PW_VERIFIED_EMAIL!;
const VERIFIED_PASSWORD = process.env.PW_VERIFIED_PASSWORD!;

async function loginAndGoToProfile(page: import("@playwright/test").Page) {
  const loginPage = new LoginPage(page);
  const profilePage = new ProfilePage(page);
  await loginPage.navigate();
  await loginPage.login(VERIFIED_EMAIL, VERIFIED_PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await profilePage.navigate();
  await expect(profilePage.heading).toBeVisible();
  return profilePage;
}

test.describe("Profile page: default view state", () => {
  test("shows read-only nickname display and 編輯 button, no form controls", async ({
    page,
  }) => {
    const profilePage = await loginAndGoToProfile(page);

    await expect(profilePage.nicknameDisplay).toBeVisible();
    await expect(profilePage.editButton).toBeVisible();
    await expect(profilePage.nicknameInput).toHaveCount(0);
    await expect(profilePage.saveButton).toHaveCount(0);
    await expect(profilePage.cancelButton).toHaveCount(0);
  });
});

test.describe("Profile page: view/edit mode toggle", () => {
  test("full state machine: empty placeholder, edit entry, cancel, save, validation, API failure, saving state", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const profilePage = await loginAndGoToProfile(page);

    // Capture the current saved nickname so the test can restore it at the
    // end and stay idempotent across reruns.
    const originalText = (await profilePage.nicknameDisplay.textContent())?.trim() ?? "";
    const originalNickname = originalText === "(未設定暱稱)" ? "" : originalText;

    // --- Empty-nickname placeholder ------------------------------------
    // Ensure the account has no nickname set, then verify the placeholder.
    await profilePage.startEdit();
    await profilePage.fillNickname("");
    await profilePage.save();
    await expect(profilePage.saveSuccessMessage).toBeVisible();
    await expect(profilePage.nicknameDisplay).toHaveText("(未設定暱稱)");
    await expect(profilePage.editButton).toBeVisible();
    await expect(profilePage.nicknameInput).toHaveCount(0);

    // --- Enter edit mode -------------------------------------------------
    await profilePage.startEdit();
    await expect(profilePage.nicknameInput).toBeVisible();
    await expect(profilePage.nicknameInput).toHaveValue("");
    await expect(profilePage.editButton).toHaveCount(0);
    await expect(profilePage.saveButton).toBeVisible();
    await expect(profilePage.cancelButton).toBeVisible();

    // --- 取消 flow: no PATCH sent, reverts to original value -------------
    let patchSent = false;
    const trackPatch = (req: import("@playwright/test").Request) => {
      if (req.url().includes("/api/profile") && req.method() === "PATCH") {
        patchSent = true;
      }
    };
    page.on("request", trackPatch);
    await profilePage.fillNickname("不應該被儲存的值");
    await profilePage.cancel();
    await expect(profilePage.nicknameDisplay).toHaveText("(未設定暱稱)");
    await expect(profilePage.saveSuccessMessage).toHaveCount(0);
    await expect(profilePage.saveErrorMessage).toHaveCount(0);
    expect(patchSent).toBe(false);
    page.off("request", trackPatch);

    // --- Successful save + reload persistence -----------------------------
    const newNickname = `PW測試暱稱${Date.now()}`;
    await profilePage.startEdit();
    await profilePage.fillNickname(newNickname);
    await profilePage.save();
    await expect(profilePage.saveSuccessMessage).toBeVisible();
    await expect(profilePage.saveSuccessMessage).toHaveAttribute("role", "status");
    await expect(profilePage.nicknameDisplay).toHaveText(newNickname);
    await expect(profilePage.editButton).toBeVisible();

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(profilePage.nicknameDisplay).toHaveText(newNickname);

    // --- Client-side validation failure (51+ chars) -----------------------
    let validationPatchSent = false;
    const trackValidationPatch = (req: import("@playwright/test").Request) => {
      if (req.url().includes("/api/profile") && req.method() === "PATCH") {
        validationPatchSent = true;
      }
    };
    page.on("request", trackValidationPatch);
    await profilePage.startEdit();
    await profilePage.fillNickname("a".repeat(51));
    await profilePage.save();
    await expect(profilePage.nicknameInput).toBeVisible();
    await expect(profilePage.saveErrorMessage).toBeVisible();
    await expect(profilePage.saveErrorMessage).toHaveAttribute("role", "alert");
    await expect(profilePage.saveErrorMessage).toHaveText("暱稱長度不可超過 50 字");
    expect(validationPatchSent).toBe(false);
    page.off("request", trackValidationPatch);
    await profilePage.cancel();

    // --- API failure on save ------------------------------------------------
    await page.route("**/api/profile", async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "伺服器發生錯誤" }),
        });
      } else {
        await route.continue();
      }
    });
    await profilePage.startEdit();
    await profilePage.fillNickname("暫存但會失敗的值");
    await profilePage.save();
    await expect(profilePage.nicknameInput).toBeVisible();
    await expect(profilePage.saveErrorMessage).toBeVisible();
    await expect(profilePage.saveErrorMessage).toHaveAttribute("role", "alert");
    await expect(profilePage.nicknameInput).toHaveValue("暫存但會失敗的值");
    await page.unroute("**/api/profile");
    await profilePage.cancel();

    // --- Saving-state button disabling ---------------------------------------
    await page.route("**/api/profile", async (route) => {
      if (route.request().method() === "PATCH") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.continue();
      } else {
        await route.continue();
      }
    });
    await profilePage.startEdit();
    await profilePage.fillNickname(originalNickname || "還原用暱稱");
    await profilePage.save();
    await expect(profilePage.saveButton).toHaveText("儲存中…");
    await expect(profilePage.saveButton).toBeDisabled();
    await expect(profilePage.cancelButton).toBeDisabled();
    await expect(profilePage.saveSuccessMessage).toBeVisible({ timeout: 10_000 });
    await page.unroute("**/api/profile");

    // --- Restore original nickname for idempotency --------------------------
    await profilePage.startEdit();
    await profilePage.fillNickname(originalNickname);
    await profilePage.save();
    await expect(profilePage.saveSuccessMessage).toBeVisible();
    if (originalNickname) {
      await expect(profilePage.nicknameDisplay).toHaveText(originalNickname);
    } else {
      await expect(profilePage.nicknameDisplay).toHaveText("(未設定暱稱)");
    }
  });
});
