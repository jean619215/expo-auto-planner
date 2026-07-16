"use client";

// 模擬金流商的付款頁。按下「模擬付款成功」後,以金流商的身分帶簽章
// POST 到我們的 webhook 路由 — 走的是與真實金流完全相同的發點路徑
// (webhook → 驗簽 → idempotency → ledger),不是前端直接加點的捷徑。
// 之後接綠界時,這頁整個被綠界的真實付款頁取代。

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MockCheckoutPage() {
  return (
    <Suspense fallback={null}>
      <MockCheckoutContent />
    </Suspense>
  );
}

function MockCheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");

  const orderId = searchParams.get("orderId") ?? "";
  const txnId = searchParams.get("txnId") ?? "";
  const sig = searchParams.get("sig") ?? "";
  const amount = searchParams.get("amount") ?? "";
  const points = searchParams.get("points") ?? "";
  const name = searchParams.get("name") ?? "";

  const valid = orderId && txnId && sig;

  async function handlePay() {
    if (paying || !valid) return;
    setPaying(true);
    setError("");
    try {
      const res = await fetch("/api/points/webhook/mock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, txnId, sig }),
      });
      if (!res.ok) {
        setError("模擬付款失敗，請返回商店重試。");
        setPaying(false);
        return;
      }
      router.push("/shop?paid=1");
    } catch {
      setError("模擬付款失敗，請返回商店重試。");
      setPaying(false);
    }
  }

  return (
    <main
      data-testid="mock-checkout-page"
      className="mx-auto max-w-md px-4 py-10"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-black">
            模擬付款頁（測試用）
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!valid ? (
            <p role="alert" className="text-sm text-destructive">
              訂單資訊不完整，請返回商店重新購買。
            </p>
          ) : (
            <>
              <dl className="flex flex-col gap-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">方案</dt>
                  <dd data-testid="mock-checkout-name">{name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">點數</dt>
                  <dd data-testid="mock-checkout-points" className="font-mono">
                    {points} 點
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">金額</dt>
                  <dd data-testid="mock-checkout-amount" className="font-mono">
                    NT$ {amount}
                  </dd>
                </div>
              </dl>
              {error && (
                <p role="alert" data-testid="mock-checkout-error" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                type="button"
                data-testid="mock-pay-button"
                disabled={paying}
                onClick={handlePay}
              >
                {paying ? "處理中…" : "模擬付款成功"}
              </Button>
              <Button
                type="button"
                variant="outline"
                data-testid="mock-cancel-button"
                disabled={paying}
                onClick={() => router.push("/shop")}
              >
                取消返回商店
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
