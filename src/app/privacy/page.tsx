// 公開頁 — 金流審核必查項目之一,不可加入 src/proxy.ts 的 PROTECTED_PAGES。

import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "隱私權政策 | 展覽自動排程",
  description: "展覽自動排程之個人資料蒐集、處理與利用說明。",
};

export default function PrivacyPage() {
  return (
    <main data-testid="privacy-page" className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-black tracking-tight text-foreground">
        隱私權政策
      </h1>

      <section className="mt-8 space-y-3 text-sm leading-7 text-muted-foreground">
        <h2 className="text-lg font-black text-foreground">一、蒐集之資料</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>帳號資料：電子郵件地址、加密後之密碼驗證資訊。</li>
          <li>服務資料：您建立之場地平面圖、規劃內容與 AI 對話紀錄。</li>
          <li>交易資料：訂單編號、方案內容、金額與交易狀態。</li>
        </ul>
        <p>
          本服務
          <strong className="text-foreground">
            不儲存您的信用卡號、有效期限或安全碼
          </strong>
          ，付款程序全程由第三方金流服務商處理。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">二、利用目的</h2>
        <p>
          上述資料僅用於提供與維運本服務、身分驗證、訂單與使用次數之計算、
          客服處理，以及依法令要求之保存。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">
          三、第三方服務
        </h2>
        <p>
          本服務使用 Supabase 進行帳號驗證與資料儲存，使用 Anthropic 的 AI 模型
          服務處理規劃生成請求，並使用第三方金流服務商處理付款。上述服務商僅在
          提供服務之必要範圍內處理相關資料。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">四、資料保護</h2>
        <p>
          連線全程採用 HTTPS 加密；登入狀態以 httpOnly Cookie 保存，不暴露於
          瀏覽器端程式。資料庫存取採列級權限控管，使用者僅能存取自身資料。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">
          五、您的權利
        </h2>
        <p>
          您可請求查詢、閱覽、補正、刪除您的個人資料，或請求停止蒐集、處理及
          利用。請寄信至 {SITE.supportEmail} 提出申請。刪除帳號後，除法令要求
          保存之交易紀錄外，其餘資料將一併刪除。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">六、Cookie</h2>
        <p>
          本服務僅使用維持登入狀態所必要之 Cookie，不用於廣告追蹤。停用 Cookie
          將無法登入使用付費功能。
        </p>

        <h2 className="pt-4 text-lg font-black text-foreground">七、聯絡方式</h2>
        <p>
          客服信箱 {SITE.supportEmail}；LINE 官方帳號 {SITE.lineId}。
        </p>
      </section>
    </main>
  );
}
