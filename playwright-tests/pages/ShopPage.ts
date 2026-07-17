import type { Page, Locator } from "@playwright/test";

/** Page object for src/app/shop/page.tsx + /shop/mock-checkout. */
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

  async balanceNumber(): Promise<number> {
    const text = (await this.balance.textContent())?.trim() ?? "";
    return Number(text);
  }
}
