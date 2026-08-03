// 公開頁 — 金流審核必查項目之一,不可加入 src/proxy.ts 的 PROTECTED_PAGES。

import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "服務條款 | 展覽自動排程",
  description: "展覽自動排程服務條款。",
};

export default function TermsPage() {
  return (
    <main data-testid="terms-page" className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-black tracking-tight text-foreground">
        服務條款
      </h1>

      <section className="mt-8 space-y-3 text-sm leading-7 text-muted-foreground">
        <h2 className="text-lg font-black text-foreground">一、服務內容</h2>
        <p>
          {SITE.name}（以下稱「本服務」）提供線上展場平面規劃工具，包含 2D 平面圖
          編輯、AI 輔助配置生成與 3D 場景預覽。本服務為數位軟體服務，無實體商品
          寄送。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">二、帳號</h2>
        <p>
          使用者須以有效電子郵件註冊並完成驗證後始得使用付費功能。使用者應自行
          保管帳號密碼，因帳號外洩所生之損失由使用者自行負責。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">
          三、方案與使用次數
        </h2>
        <p>
          使用者可購買一次性服務方案，每項方案包含固定次數之 AI 規劃生成服務。
          使用次數僅限購買帳號本人於本服務內使用，
          <strong className="text-foreground">
            不得轉讓、贈與或移轉予第三人，亦不可兌換現金、不可提領，
            且不具任何支付工具之性質
          </strong>
          。
        </p>
        <p>
          每次成功送出 AI 規劃生成請求即扣除一次使用次數。因使用者網路環境或
          上游服務異常導致之生成失敗，請於發生後聯繫客服，經查證屬實者將補回
          該次次數。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">四、付款</h2>
        <p>
          所有價格均以新台幣計價並已含稅。付款由第三方金流服務商處理，本服務
          不儲存使用者之信用卡資訊。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">五、退款</h2>
        <p>
          退款事宜依
          <Link href="/refund" className="mx-1 text-blueprint underline">
            退款政策
          </Link>
          辦理。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">
          六、智慧財產權
        </h2>
        <p>
          使用者上傳之場地資料與其產出之規劃結果，其權利歸使用者所有。本服務之
          軟體、介面與素材之權利歸本服務所有。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">
          七、服務變更與終止
        </h2>
        <p>
          本服務得於公告後調整方案內容與價格；調整不影響使用者已購買且尚未使用
          之次數。使用者違反本條款時，本服務得暫停或終止其帳號。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">八、聯絡方式</h2>
        <p>
          客服信箱 {SITE.supportEmail}；LINE 官方帳號 {SITE.lineId}；服務時間{" "}
          {SITE.supportHours}。
        </p>
      </section>
    </main>
  );
}
