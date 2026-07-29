import type { Page, Locator } from "@playwright/test";

/**
 * Page object for the PUBLIC pages required by the payment-gateway review:
 * /pricing (商品頁), /terms, /refund, /privacy 與全站頁尾。
 *
 * ⚠️ 這些頁面刻意不在 src/proxy.ts 的 PROTECTED_PAGES / config.matcher 內 —
 * 未登入必須能直接開啟。任何會讓它們被導向 /login 的改動都會讓金流審核再次
 * 被駁回,public-pages.spec.ts 就是守住這條線的門檻。
 */
export class PricingPage {
  readonly page: Page;
  readonly root: Locator;
  readonly termsRoot: Locator;
  readonly refundRoot: Locator;
  readonly privacyRoot: Locator;
  readonly footer: Locator;
  readonly footerContact: Locator;
  readonly headerPricingLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId("pricing-page");
    this.termsRoot = page.getByTestId("terms-page");
    this.refundRoot = page.getByTestId("refund-page");
    this.privacyRoot = page.getByTestId("privacy-page");
    this.footer = page.getByTestId("site-footer");
    this.footerContact = page.getByTestId("footer-contact");
    this.headerPricingLink = page.getByTestId("header-nav-pricing-link");
  }

  /** goto /pricing 並回傳 response,供呼叫端斷言 HTTP 狀態碼。 */
  async navigate() {
    return this.page.goto("/pricing");
  }

  planCard(planId: string): Locator {
    return this.page.getByTestId(`pricing-plan-${planId}`);
  }

  buyLink(planId: string): Locator {
    return this.page.getByTestId(`pricing-buy-${planId}`);
  }

  /** 頁尾連結,path 傳 "/pricing" 這種形式(對應 footer-link-<path 去掉斜線>)。 */
  footerLink(href: string): Locator {
    return this.page.getByTestId(`footer-link-${href.replace(/^\//, "")}`);
  }

  /** 整頁可見文字 — 用來檢查對外字串未殘留「點數 / 儲值」。 */
  async bodyText(): Promise<string> {
    return (await this.page.locator("body").innerText()).trim();
  }
}
