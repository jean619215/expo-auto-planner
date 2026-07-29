import { test, expect } from "@playwright/test";
import { PricingPage } from "./pages/PricingPage";

// 金流(綠界)審核駁回原因 1:「商品頁需登入才能看」。這支 spec 就是那條
// 驗收線 —— 未登入(不套用任何登入後的 storageState、全程不呼叫 LoginPage)
// 必須能直接開啟 /pricing /terms /refund /privacy,且看得到完整商品資訊。
//
// 駁回原因 2:販售型態不得是「點數」。因此另外斷言公開商品頁全文不含
// 「點數 / 儲值」字樣。
//
// ⚠️ 本檔任何 test 都不得登入 —— 加登入等於讓這個門檻失效。

/**
 * 對應 src/lib/points/packages.ts 的 SERVICE_PLANS。刻意複製一份而非
 * import,沿用既有 page-object 慣例(測試只認 DOM 契約,不耦合 app source);
 * 反過來說,若方案調價/調次數而這裡沒同步,這支 test 會紅 —— 那正是我們要的,
 * 公開商品頁的價格與次數本來就必須被守住。
 */
const EXPECTED_PLANS = [
  { id: "basic", name: "標準方案", priceTwd: 100, usageCount: 10 },
  { id: "plus", name: "專業方案", priceTwd: 500, usageCount: 55 },
  { id: "mega", name: "旗艦方案", priceTwd: 1000, usageCount: 120 },
];

const PUBLIC_PATHS = ["/pricing", "/terms", "/refund", "/privacy"];

// 對外可見字串的違禁詞(金流商不承作點數/儲值性質商品)。
const FORBIDDEN_TERMS = ["點數", "儲值"];

test.describe("公開頁面 - 未登入可直接存取(金流審核條件)", () => {
  test("未登入前往 /pricing 回 200、不會被導向 /login,並渲染商品頁", async ({
    page,
  }) => {
    const pricing = new PricingPage(page);
    const response = await pricing.navigate();

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(pricing.root).toBeVisible();
  });

  for (const path of PUBLIC_PATHS) {
    test(`未登入前往 ${path} 回 200 且不會被導向 /login`, async ({ page }) => {
      const response = await page.goto(path);

      expect(response?.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page).not.toHaveURL(/\/login/);
    });
  }

  test("/terms /refund /privacy 未登入皆渲染出各自的主要內容區塊", async ({
    page,
  }) => {
    const pricing = new PricingPage(page);

    await page.goto("/terms");
    await expect(pricing.termsRoot).toBeVisible();

    await page.goto("/refund");
    await expect(pricing.refundRoot).toBeVisible();

    await page.goto("/privacy");
    await expect(pricing.privacyRoot).toBeVisible();
  });
});

test.describe("公開頁面 - /pricing 商品資訊", () => {
  test("顯示三個方案的名稱、NT$ 價格與可用次數", async ({ page }) => {
    const pricing = new PricingPage(page);
    await pricing.navigate();

    for (const plan of EXPECTED_PLANS) {
      const card = pricing.planCard(plan.id);
      await expect(card).toBeVisible();
      await expect(card).toContainText(plan.name);
      await expect(card).toContainText(`NT$ ${plan.priceTwd.toLocaleString()}`);
      // 對「可用次數」節點精確斷言 — 若只用 toContainText(card, "10"),
      // 卡片內的「NT$ 100」與說明文字裡的次數都會讓它假通過。
      await expect(card.getByTestId(`pricing-usage-${plan.id}`)).toHaveText(
        String(plan.usageCount)
      );
      await expect(card).toContainText("次");
      await expect(pricing.buyLink(plan.id)).toBeVisible();
    }
  });

  test("商品頁全文不含「點數」「儲值」字樣", async ({ page }) => {
    const pricing = new PricingPage(page);
    await pricing.navigate();
    await expect(pricing.root).toBeVisible();

    const text = await pricing.bodyText();
    for (const term of FORBIDDEN_TERMS) {
      expect(text, `公開商品頁不得出現「${term}」`).not.toContain(term);
    }
  });
});

test.describe("公開頁面 - 頁尾導覽", () => {
  test("未登入時頁尾四個連結皆可見,且可點擊到達對應頁面", async ({ page }) => {
    const pricing = new PricingPage(page);

    // 從首頁出發 —— 審核方要求「網站任一頁都能走到」這些資訊。
    await page.goto("/");
    await expect(pricing.footer).toBeVisible();

    for (const path of PUBLIC_PATHS) {
      await expect(pricing.footerLink(path)).toBeVisible();
    }

    for (const path of PUBLIC_PATHS) {
      await page.goto("/");
      await pricing.footerLink(path).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page).not.toHaveURL(/\/login/);
    }
  });

  test("未登入時頁尾顯示賣家與客服聯絡資訊", async ({ page }) => {
    const pricing = new PricingPage(page);
    await pricing.navigate();

    await expect(pricing.footerContact).toBeVisible();
    await expect(pricing.footerContact).toContainText("客服信箱");
    await expect(pricing.footerContact).toContainText("客服電話");
    // site.ts 的 placeholder 若未換成真實聯絡資料,送審必被駁回 — 測試守住這條線。
    await expect(pricing.footerContact).not.toContainText("請填入");
  });

  test("未登入時 header 的「方案與價格」連結可見並導向 /pricing", async ({
    page,
  }) => {
    const pricing = new PricingPage(page);

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(pricing.headerPricingLink).toBeVisible();
    await pricing.headerPricingLink.click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(pricing.root).toBeVisible();
  });
});
