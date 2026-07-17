import { createHmac, timingSafeEqual } from "crypto";

// 金流 provider 抽象層。Phase 1 只有 MockProvider;之後接綠界個人戶時
// 新增 EcpayProvider 實作同一介面(createCheckout 產生 form post 參數、
// verifyWebhook 改驗 CheckMacValue),購買/發點流程不動。

export interface CheckoutOrder {
  orderId: string;
  amountTwd: number;
  points: number;
  packageName: string;
}

export interface WebhookResult {
  ok: boolean;
  orderId: string;
  providerTxnId: string;
}

export interface PaymentProvider {
  /** 建立結帳,回傳要導去的付款頁 URL。 */
  createCheckout(order: CheckoutOrder): { redirectUrl: string };
  /** 驗證 webhook 簽章與內容。驗簽失敗一律 ok=false,呼叫端必須拒絕。 */
  verifyWebhook(payload: unknown): WebhookResult;
}

// Mock 簽章密鑰。僅供本機/測試模擬付款流程,不是任何真實系統的憑證;
// 但 webhook 路由在 public allowlist 上,簽章是唯一守門,所以正式環境
// 絕不可啟用 mock provider(見下方 getPaymentProvider 的環境檢查)。
const MOCK_SECRET = process.env.MOCK_PAYMENT_SECRET ?? "mock-payment-dev-secret";

export function signMockPayload(orderId: string, txnId: string): string {
  return createHmac("sha256", MOCK_SECRET)
    .update(`${orderId}|${txnId}`)
    .digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

class MockProvider implements PaymentProvider {
  createCheckout(order: CheckoutOrder): { redirectUrl: string } {
    // 模擬真實金流:導去「金流商的付款頁」。txnId 與簽章由本端(扮演金流商
    // 後台)先簽好放進 URL,付款頁按下模擬付款後帶著它們打 webhook。
    const txnId = `mock-${order.orderId}`;
    const sig = signMockPayload(order.orderId, txnId);
    const params = new URLSearchParams({
      orderId: order.orderId,
      txnId,
      sig,
      amount: String(order.amountTwd),
      points: String(order.points),
      name: order.packageName,
    });
    return { redirectUrl: `/shop/mock-checkout?${params.toString()}` };
  }

  verifyWebhook(payload: unknown): WebhookResult {
    const invalid: WebhookResult = { ok: false, orderId: "", providerTxnId: "" };
    if (typeof payload !== "object" || payload === null) return invalid;
    const { orderId, txnId, sig } = payload as {
      orderId?: unknown;
      txnId?: unknown;
      sig?: unknown;
    };
    if (
      typeof orderId !== "string" ||
      typeof txnId !== "string" ||
      typeof sig !== "string" ||
      !orderId ||
      !txnId
    ) {
      return invalid;
    }
    const expected = signMockPayload(orderId, txnId);
    if (!safeEqualHex(sig, expected)) return invalid;
    return { ok: true, orderId, providerTxnId: txnId };
  }
}

export type ProviderName = "mock" | "ecpay";

export function getPaymentProvider(): { name: ProviderName; provider: PaymentProvider } {
  const name = process.env.PAYMENT_PROVIDER ?? "mock";
  if (name === "mock") {
    // 守門:mock 的簽章密鑰若未另行設定,絕不可在正式環境提供服務,
    // 否則任何人都能偽造 webhook 幫自己加點。
    if (process.env.NODE_ENV === "production" && !process.env.MOCK_PAYMENT_SECRET) {
      throw new Error(
        "PAYMENT_PROVIDER=mock 在 production 需明確設定 MOCK_PAYMENT_SECRET"
      );
    }
    return { name: "mock", provider: new MockProvider() };
  }
  throw new Error(`未支援的 PAYMENT_PROVIDER: ${name}`);
}
