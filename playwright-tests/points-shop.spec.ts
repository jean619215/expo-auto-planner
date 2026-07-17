import { test, expect, type Page } from "@playwright/test";
import { LoginPage } from "./pages/LoginPage";
import { HeaderPage } from "./pages/HeaderPage";
import { ShopPage } from "./pages/ShopPage";

// 會員點數系統 Phase 1 acceptance: shop page, mock purchase flow (full
// webhook path), ledger idempotency, and access control.
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

test.describe("Points shop: balance and packages", () => {
  test("shows numeric balance (signup bonus applied) and all three packages", async ({
    page,
  }) => {
    const shopPage = await loginAndGoToShop(page);

    // Backfill/signup bonus guarantees at least the 50-point grant.
    const balance = await shopPage.balanceNumber();
    expect(Number.isFinite(balance)).toBe(true);
    expect(balance).toBeGreaterThanOrEqual(50);

    for (const id of ["basic", "plus", "mega"]) {
      await expect(shopPage.packageCard(id)).toBeVisible();
      await expect(shopPage.buyButton(id)).toBeEnabled();
    }

    // Transaction list renders localized reason labels. The API returns only
    // the most recent 20 rows, and repeated E2E purchase runs push the
    // original 註冊禮 row out of that window on the shared test account — so
    // assert on the list rendering known labels, not on the signup row
    // specifically (the >= 50 balance check above already proves the grant).
    await expect(shopPage.transactions.locator("li").first()).toBeVisible();
    await expect(shopPage.transactions).toContainText(/註冊禮|購買點數|AI/);
  });
});

test.describe("Points shop: mock purchase flow", () => {
  test("buy basic package end-to-end: checkout → mock pay → webhook credits 100 points", async ({
    page,
  }) => {
    const shopPage = await loginAndGoToShop(page);
    const before = await shopPage.balanceNumber();

    await shopPage.buyButton("basic").click();
    await expect(shopPage.mockCheckoutRoot).toBeVisible();
    await expect(page).toHaveURL(/\/shop\/mock-checkout\?/);

    await shopPage.mockPayButton.click();

    await expect(page).toHaveURL(/\/shop\?paid=1$/);
    await expect(shopPage.paidSuccess).toBeVisible();
    await expect(shopPage.balance).toHaveText(String(before + 100));
    await expect(shopPage.transactions).toContainText("購買點數");
  });

  test("webhook resend is idempotent: same signed payload twice credits only once", async ({
    page,
  }) => {
    const shopPage = await loginAndGoToShop(page);
    const before = await shopPage.balanceNumber();

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
    await expect(shopPage.balance).toHaveText(String(before + 100));
  });

  test("webhook rejects tampered signature", async ({ page }) => {
    const shopPage = await loginAndGoToShop(page);
    const before = await shopPage.balanceNumber();

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
    const before = await shopPage.balanceNumber();

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
