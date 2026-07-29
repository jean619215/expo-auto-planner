import type { Page, Locator } from "@playwright/test";

/**
 * Page object for src/app/shop/page.tsx + /shop/mock-checkout.
 *
 * ⚠️ 販售型態改為「軟體服務方案」後,`shop-balance` / `mock-checkout-points`
 * 顯示的是**對外的可用次數**(= 內部額度 / USAGE_UNIT_COST,目前 10),
 * 不是 ledger 的 delta 總和。斷言購買後的增量時請用「次數」而非額度。
 * testid 名稱維持不變(DOM 契約),只有顯示語意換算過。
 */
export class ShopPage {
  readonly page: Page;
  readonly root: Locator;
  readonly balance: Locator;
  readonly paidSuccess: Locator;
  readonly transactions: Locator;
  readonly unauthenticated: Locator;
  readonly mockCheckoutRoot: Locator;
  readonly mockPayButton: Locator;
  readonly mockCancelButton: Locator;
  readonly mockCheckoutUsage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId("shop-page");
    this.balance = page.getByTestId("shop-balance");
    this.paidSuccess = page.getByTestId("shop-paid-success");
    this.transactions = page.getByTestId("shop-transactions");
    this.unauthenticated = page.getByTestId("shop-unauthenticated");
    this.mockCheckoutRoot = page.getByTestId("mock-checkout-page");
    this.mockPayButton = page.getByTestId("mock-pay-button");
    this.mockCancelButton = page.getByTestId("mock-cancel-button");
    this.mockCheckoutUsage = page.getByTestId("mock-checkout-points");
  }

  async navigate() {
    await this.page.goto("/shop");
  }

  buyButton(packageId: string): Locator {
    return this.page.getByTestId(`shop-buy-${packageId}`);
  }

  packageCard(packageId: string): Locator {
    return this.page.getByTestId(`shop-package-${packageId}`);
  }

  /** 讀取畫面上顯示的「可用次數」(整數;載入失敗時畫面為 "-" → NaN)。 */
  async usageCountNumber(): Promise<number> {
    const text = (await this.balance.textContent())?.trim() ?? "";
    return Number(text);
  }
}
