// 公開頁 — 金流審核必查項目之一,不可加入 src/proxy.ts 的 PROTECTED_PAGES。

import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "退款政策 | 展覽自動排程",
  description: "展覽自動排程服務方案之退款與退費說明。",
};

export default function RefundPage() {
  return (
    <main data-testid="refund-page" className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-black tracking-tight text-foreground">
        退款政策
      </h1>

      <section className="mt-8 space-y-3 text-sm leading-7 text-muted-foreground">
        <h2 className="text-lg font-black text-foreground">一、適用範圍</h2>
        <p>
          本政策適用於在 {SITE.name} 購買之一次性服務方案。本服務屬「非以有形
          媒介提供之數位內容或一經提供即為完成之線上服務」，依消費者保護法相關
          規定不適用七日猶豫期。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">
          二、可退款情形
        </h2>
        <p>
          本服務仍自願提供以下優於法定之退款方案：
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            購買後方案所含次數
            <strong className="text-foreground">完全未使用</strong>
            ，且於付款日起 7 日內提出申請者，全額退款。
          </li>
          <li>
            因本服務系統故障導致無法使用，且經查證屬實者，依未使用之次數比例
            退款。
          </li>
          <li>重複扣款或金額錯誤者，全額退還溢收金額。</li>
          <li>
            退款經核准後，該筆方案所含尚未使用之次數將同步失效，並於交易記錄
            中以「退款沖銷」列示。
          </li>
        </ul>

        <h2 className="pt-4 text-lg font-black text-foreground">
          三、不可退款情形
        </h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>方案內次數已部分或全部使用者，已使用部分不予退還。</li>
          <li>付款日起超過 7 日者。</li>
          <li>因違反服務條款遭終止帳號者。</li>
          <li>註冊贈送或活動加贈之次數，不列入退款計算。</li>
        </ul>

        <h2 className="pt-4 text-lg font-black text-foreground">四、申請方式</h2>
        <p>
          請寄信至 {SITE.supportEmail}，註明註冊信箱、訂單編號與退款原因。本服務
          將於收到申請後 3 個工作日內回覆審核結果；審核通過者，退款將由原付款
          管道退回，實際入帳時間依發卡銀行作業為準（一般為 7 至 30 個工作日）。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">五、聯絡方式</h2>
        <p>
          客服信箱 {SITE.supportEmail}；LINE 官方帳號 {SITE.lineId}；服務時間{" "}
          {SITE.supportHours}。
        </p>
      </section>
    </main>
  );
}
