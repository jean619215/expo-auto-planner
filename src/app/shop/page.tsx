"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";
import { SERVICE_PLANS, toUsageCount } from "@/lib/points/packages";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PageState = "loading" | "ready" | "unauthenticated" | "error";

interface PointTransaction {
  id: string;
  delta: number;
  reason: string;
  created_at: string;
}

const REASON_LABELS: Record<string, string> = {
  signup_bonus: "新手體驗次數",
  purchase: "方案購買",
  ai_usage: "AI 規劃生成",
  refund: "退款沖銷",
  compensation: "服務補償",
};

const createdAtFormatter = new Intl.DateTimeFormat("zh-TW", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatCreatedAt(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "-";
  return createdAtFormatter.format(date);
}

// useSearchParams 需要 Suspense boundary(Next.js build 時的 CSR bailout 要求)。
export default function ShopPage() {
  return (
    <Suspense fallback={null}>
      <ShopContent />
    </Suspense>
  );
}

function ShopContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paid = searchParams.get("paid") === "1";

  const [pageState, setPageState] = useState<PageState>("loading");
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<PointTransaction[]>([]);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [buyError, setBuyError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/points/balance")
      .then(async (res) => {
        if (!active) return;
        if (res.status === 401) {
          setPageState("unauthenticated");
          return;
        }
        if (!res.ok) {
          setPageState("error");
          return;
        }
        const data = (await res.json()) as {
          balance: number;
          transactions: PointTransaction[];
        };
        if (!active) return;
        setBalance(data.balance);
        setTransactions(data.transactions);
        setPageState("ready");
      })
      .catch(() => {
        if (active) setPageState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleBuy(packageId: string) {
    if (buyingId) return;
    setBuyingId(packageId);
    setBuyError("");
    try {
      const res = await fetch("/api/points/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId }),
      });
      if (res.status === 401) {
        setPageState("unauthenticated");
        return;
      }
      const data = (await res.json()) as { redirectUrl?: string; error?: string };
      if (!res.ok || !data.redirectUrl) {
        setBuyError(data.error ?? "建立訂單失敗，請稍後再試");
        setBuyingId(null);
        return;
      }
      router.push(data.redirectUrl);
    } catch {
      setBuyError("建立訂單失敗，請稍後再試");
      setBuyingId(null);
    }
  }

  if (pageState === "unauthenticated") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p data-testid="shop-unauthenticated" className="text-muted-foreground">
          請先
          <Link href="/login" className="mx-1 text-blueprint underline">
            登入
          </Link>
          後再購買方案。
        </p>
      </main>
    );
  }

  return (
    <main data-testid="shop-page" className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-black tracking-tight text-foreground">
        我的方案
      </h1>

      {paid && (
        <p
          role="status"
          data-testid="shop-paid-success"
          className="mb-4 rounded-md border border-blueprint-light bg-blueprint-wash px-3 py-2 text-sm text-blueprint"
        >
          付款成功，使用次數已加入您的帳號。
        </p>
      )}

      <Card className="mb-6">
        <CardContent className="flex items-center gap-3 py-4">
          <Sparkles className="size-6 text-blueprint" />
          <span className="text-sm text-muted-foreground">可用次數</span>
          {pageState === "loading" ? (
            <span
              data-testid="shop-balance-loading"
              className="h-7 w-16 animate-pulse rounded bg-black/6 dark:bg-white/8"
            />
          ) : (
            <span
              data-testid="shop-balance"
              className="font-mono text-2xl font-bold text-blueprint"
            >
              {pageState === "error" ? "-" : toUsageCount(balance)}
            </span>
          )}
          <span className="text-sm text-muted-foreground">次</span>
        </CardContent>
      </Card>

      {pageState === "error" && (
        <p role="alert" data-testid="shop-load-error" className="mb-4 text-sm text-destructive">
          載入失敗，請重新整理頁面。
        </p>
      )}

      {buyError && (
        <p role="alert" data-testid="shop-buy-error" className="mb-4 text-sm text-destructive">
          {buyError}
        </p>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {SERVICE_PLANS.map((pkg) => (
          <Card key={pkg.id} data-testid={`shop-package-${pkg.id}`}>
            <CardHeader>
              <CardTitle className="text-lg font-black">{pkg.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div>
                <span className="font-mono text-3xl font-bold text-blueprint">
                  {pkg.usageCount}
                </span>
                <span className="ml-1 text-sm text-muted-foreground">
                  次 AI 規劃
                </span>
                {pkg.bonusPoints > 0 && (
                  <p className="mt-1 text-xs text-blueprint">
                    含加贈 {toUsageCount(pkg.bonusPoints)} 次
                  </p>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                NT$ {pkg.amountTwd.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">{pkg.description}</p>
              <Button
                type="button"
                data-testid={`shop-buy-${pkg.id}`}
                disabled={buyingId !== null}
                onClick={() => handleBuy(pkg.id)}
              >
                {buyingId === pkg.id ? "前往付款…" : "購買"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <section>
        <h2 className="mb-3 text-lg font-black text-foreground">交易記錄</h2>
        {pageState === "ready" && transactions.length === 0 && (
          <p className="text-sm text-muted-foreground">尚無交易記錄。</p>
        )}
        <ul data-testid="shop-transactions" className="flex flex-col gap-1.5">
          {transactions.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between rounded-md border border-line bg-card px-3 py-2 text-sm"
            >
              <span>{REASON_LABELS[t.reason] ?? t.reason}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {formatCreatedAt(t.created_at)}
                </span>
                <span
                  className={
                    "font-mono font-bold " +
                    (t.delta > 0 ? "text-blueprint" : "text-destructive")
                  }
                >
                  {t.delta > 0
                    ? `+${toUsageCount(t.delta)} 次`
                    : `-${toUsageCount(-t.delta)} 次`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
