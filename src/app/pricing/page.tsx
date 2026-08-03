// 公開商品頁 — 金流審核指定要看的「無須登入即可查看之販售商品網址」。
// 刻意不放進 src/proxy.ts 的 PROTECTED_PAGES / config.matcher:未登入也必須看得到
// 完整商品名稱、價格、服務內容與使用規則。變更前請確認這點仍成立。

import type { Metadata } from "next";
import Link from "next/link";
import { SERVICE_PLANS } from "@/lib/points/packages";
import { SITE } from "@/lib/site";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "服務方案與價格 | 展覽自動排程",
  description:
    "展覽自動排程 AI 場地平面規劃服務方案與價格，含服務內容、使用規則與退款說明。",
};

export default function PricingPage() {
  return (
    <main data-testid="pricing-page" className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-black tracking-tight text-foreground">
        服務方案與價格
      </h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        {SITE.name} 提供 AI 輔助的展場平面規劃服務：輸入場地尺寸與需求後，由系統
        自動生成家具配置與 3D 預覽。以下方案為一次性購買，購買後即可依方案所含
        次數使用 AI 規劃生成功能。
      </p>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        {SERVICE_PLANS.map((plan) => (
          <Card key={plan.id} data-testid={`pricing-plan-${plan.id}`}>
            <CardHeader>
              <CardTitle className="text-lg font-black">{plan.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p>
                <span className="font-mono text-3xl font-bold text-blueprint">
                  NT$ {plan.amountTwd.toLocaleString()}
                </span>
              </p>
              <p className="text-sm text-foreground">
                可用次數：
                <span data-testid={`pricing-usage-${plan.id}`} className="font-mono font-bold">
                  {plan.usageCount}
                </span>{" "}
                次
              </p>
              <p className="text-sm text-muted-foreground">{plan.description}</p>
              <Link
                href="/shop"
                data-testid={`pricing-buy-${plan.id}`}
                className="mt-2 inline-flex h-9 items-center justify-center rounded-md bg-blueprint px-4 text-sm font-medium text-white hover:opacity-90"
              >
                登入後購買
              </Link>
            </CardContent>
          </Card>
        ))}
      </section>

      <p className="mt-4 text-xs text-muted-foreground">
        價格均為新台幣，已含稅。購買需先註冊並登入帳號。
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-black text-foreground">服務內容說明</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>2D 平面圖編輯：繪製場地輪廓、擺放與旋轉展場家具。</li>
          <li>AI 規劃生成：以文字描述需求，由 AI 自動配置家具位置與動線。</li>
          <li>3D 預覽：將平面圖轉為 3D 場景檢視實際佈展效果。</li>
          <li>方案所含次數僅計算「AI 規劃生成」；2D 編輯與 3D 預覽不限次數。</li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-black text-foreground">使用規則</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>方案所含使用次數僅限本服務帳號內使用，不得轉讓或移轉予他人。</li>
          <li>使用次數不可兌換現金、不可提領，且不具任何支付工具性質。</li>
          <li>本服務為數位軟體服務，非實體商品，無寄送流程。</li>
          <li>已使用之次數不予退還；未使用部分之退款依退款政策辦理。</li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          完整條款請見
          <Link href="/terms" className="mx-1 text-blueprint underline">
            服務條款
          </Link>
          、
          <Link href="/refund" className="mx-1 text-blueprint underline">
            退款政策
          </Link>
          與
          <Link href="/privacy" className="mx-1 text-blueprint underline">
            隱私權政策
          </Link>
          。
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-black text-foreground">聯絡我們</h2>
        <dl className="mt-3 grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-[6rem_1fr]">
          <dt className="font-medium text-foreground">客服信箱</dt>
          <dd>{SITE.supportEmail}</dd>
          <dt className="font-medium text-foreground">服務時間</dt>
          <dd>{SITE.supportHours}</dd>
          <dt className="font-medium text-foreground">LINE</dt>
          <dd>
            <a
              href={SITE.lineUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="line-add-friend"
              className="underline hover:text-foreground"
            >
              {SITE.lineId}
            </a>
          </dd>
        </dl>
        <div className="mt-4 flex items-center gap-3">
          {/* 未用 next/image：QR 是固定尺寸的小圖，且必須逐像素清晰可掃，
              不希望經過任何重新編碼或縮放。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={SITE.lineQr}
            alt={`加入 LINE 官方帳號 ${SITE.lineId} 的行動條碼`}
            width={120}
            height={120}
            className="rounded border border-border"
          />
          <p className="text-xs text-muted-foreground">
            手機請直接點上方連結加入；此行動條碼供桌機或列印使用。
          </p>
        </div>
      </section>
    </main>
  );
}
