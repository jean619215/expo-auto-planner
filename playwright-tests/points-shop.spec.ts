import { test, expect, type Page } from "@playwright/test";
import { LoginPage } from "./pages/LoginPage";
import { HeaderPage } from "./pages/HeaderPage";
import { ShopPage } from "./pages/ShopPage";

// 會員方案系統 Phase 1 acceptance: shop page, mock purchase flow (full
// webhook path), ledger idempotency, and access control.
//
// ⚠️ 顯示層已改為「服務方案 / 可用次數」:shop-balance 顯示的是
// 內部額度 / USAGE_UNIT_COST(10)換算後的次數,交易列的 reason label 也改成
// 新手體驗次數 / 方案購買 / AI 規劃生成。內部 ledger(delta、reason 值)未變,
// 所以 API/webhook 相關斷言維持原樣,只有畫面數字與文案要換算/改名。
if (!process.env.PW_VERIFIED_EMAIL || !process.env.PW_VERIFIED_PASSWORD) {
  throw new Error(
    "缺少 PW_VERIFIED_EMAIL / PW_VERIFIED_PASSWORD — 請設定 .env.playwright.local"
  );
}
const VERIFIED_EMAIL = process.env.PW_VERIFIED_EMAIL;
const VERIFIED_PASSWORD = process.env.PW_VERIFIED_PASSWORD;

async function loginAndGoToShop(page: Page): Promise<ShopPage> {
  const loginPage = new LoginPage(page);
  const shopPage = new ShopPage(page);
  await loginPage.navigate();
  await loginPage.login(VERIFIED_EMAIL, VERIFIED_PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await shopPage.navigate();
  await expect(shopPage.balance).toBeVisible();
  return shopPage;
}

test.describe("Points shop: access control", () => {
  test("unauthenticated visit to /shop redirects to /login", async ({ page }) => {
    await page.goto("/shop");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("balance API rejects unauthenticated requests", async ({ request }) => {
    const res = await request.get("/api/points/balance");
    expect(res.status()).toBe(401);
  });

  test("checkout API rejects unauthenticated requests", async ({ request }) => {
    const res = await request.post("/api/points/checkout", {
      data: { packageId: "basic" },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("Points shop: header navigation", () => {
  test("header shop link is hidden when logged out and navigates to /shop when logged in", async ({
    page,
  }) => {
    const headerPage = new HeaderPage(page);
    const shopPage = new ShopPage(page);

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(headerPage.navShopLink).toBeHidden();

    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.login(VERIFIED_EMAIL, VERIFIED_PASSWORD);
    await expect(page).toHaveURL(/\/$/);

    await expect(headerPage.navShopLink).toBeVisible();
    await headerPage.navShopLink.click();
    await expect(page).toHaveURL(/\/shop$/);
    await expect(shopPage.balance).toBeVisible();
  });
});

test.describe("Points shop: usage count and service plans", () => {
  test("shows numeric usage count (signup bonus applied) and all three plans", async ({
    page,
  }) => {
    const shopPage = await loginAndGoToShop(page);

    // Backfill/signup bonus guarantees at least the 50-unit grant, which the
    // UI now renders as 50 / 10 = 5 次.
    const usageCount = await shopPage.usageCountNumber();
    expect(Number.isFinite(usageCount)).toBe(true);
    expect(usageCount).toBeGreaterThanOrEqual(5);

    for (const id of ["basic", "plus", "mega"]) {
      await expect(shopPage.packageCard(id)).toBeVisible();
      await expect(shopPage.buyButton(id)).toBeEnabled();
    }

    // Transaction list renders localized reason labels (REASON_LABELS in
    // src/app/shop/page.tsx). The API returns only the most recent 20 rows,
    // and repeated E2E purchase runs push the original signup row out of that
    // window on the shared test account — so assert on the list rendering
    // known labels, not on the signup row specifically (the >= 5 usage-count
    // check above already proves the grant).
    await expect(shopPage.transactions.locator("li").first()).toBeVisible();
    await expect(shopPage.transactions).toContainText(
      /新手體驗次數|方案購買|AI 規劃生成/
    );
    // 對外字串不得再出現點數/儲值。
    await expect(shopPage.transactions).not.toContainText("點數");
  });
});

test.describe("Points shop: mock purchase flow", () => {
  test("buy basic plan end-to-end: checkout → mock pay → webhook credits 10 次", async ({
    page,
  }) => {
    const shopPage = await loginAndGoToShop(page);
    const before = await shopPage.usageCountNumber();

    await shopPage.buyButton("basic").click();
    await expect(shopPage.mockCheckoutRoot).toBeVisible();
    await expect(page).toHaveURL(/\/shop\/mock-checkout\?/);

    // 模擬結帳頁同樣以「次數」呈現(basic = 100 額度 = 10 次)。
    await expect(shopPage.mockCheckoutUsage).toHaveText("10 次");

    await shopPage.mockPayButton.click();

    await expect(page).toHaveURL(/\/shop\?paid=1$/);
    await expect(shopPage.paidSuccess).toBeVisible();
    // basic 方案入帳 100 內部額度 = 10 次。
    await expect(shopPage.balance).toHaveText(String(before + 10));
    await expect(shopPage.transactions).toContainText("方案購買");
  });

  test("webhook resend is idempotent: same signed payload twice credits only once", async ({
    page,
  }) => {
    const shopPage = await loginAndGoToShop(page);
    const before = await shopPage.usageCountNumber();

    await shopPage.buyButton("basic").click();
    await expect(shopPage.mockCheckoutRoot).toBeVisible();

    // Capture the gateway-signed params from the mock checkout URL, then
    // replay the webhook twice directly (simulating gateway retry).
    const url = new URL(page.url());
    const payload = {
      orderId: url.searchParams.get("orderId"),
      txnId: url.searchParams.get("txnId"),
      sig: url.searchParams.get("sig"),
    };
    expect(payload.orderId).toBeTruthy();
    expect(payload.sig).toBeTruthy();

    const first = await page.request.post("/api/points/webhook/mock", {
      data: payload,
    });
    expect(first.status()).toBe(200);
    const second = await page.request.post("/api/points/webhook/mock", {
      data: payload,
    });
    expect(second.status()).toBe(200);

    await shopPage.navigate();
    await expect(shopPage.balance).toHaveText(String(before + 10));
  });

  test("webhook rejects tampered signature", async ({ page }) => {
    const shopPage = await loginAndGoToShop(page);
    const before = await shopPage.usageCountNumber();

    await shopPage.buyButton("basic").click();
    await expect(shopPage.mockCheckoutRoot).toBeVisible();

    const url = new URL(page.url());
    const res = await page.request.post("/api/points/webhook/mock", {
      data: {
        orderId: url.searchParams.get("orderId"),
        txnId: url.searchParams.get("txnId"),
        sig: "0".repeat(64),
      },
    });
    expect(res.status()).toBe(400);

    await shopPage.navigate();
    await expect(shopPage.balance).toHaveText(String(before));
  });

  test("cancel on mock checkout returns to shop without charging", async ({
    page,
  }) => {
    const shopPage = await loginAndGoToShop(page);
    const before = await shopPage.usageCountNumber();

    await shopPage.buyButton("plus").click();
    await expect(shopPage.mockCheckoutRoot).toBeVisible();
    await shopPage.mockCancelButton.click();

    await expect(page).toHaveURL(/\/shop$/);
    await expect(shopPage.balance).toHaveText(String(before));
  });

  test("checkout API rejects unknown packageId", async ({ page }) => {
    await loginAndGoToShop(page);
    const res = await page.request.post("/api/points/checkout", {
      data: { packageId: "nope" },
    });
    expect(res.status()).toBe(400);
  });
});
