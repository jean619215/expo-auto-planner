"use client";

import { quoteFor, formatTwd } from "@/lib/venue/quote";
import type { FurnitureItem } from "@/lib/venue/furniture";

/**
 * 報價小計面板(第三輪 T8,決議 D6)。
 *
 * 畫圖的當下就看得到累計金額 —— 這一輪要驗證的正是這件事有沒有用,所以面板
 * 掛在側欄頂端、跟著家具即時更新,而不是做成一個要另外點開的「產生報價」頁。
 *
 * **這裡不算錢。** 金額全部來自 `src/lib/venue/quote.ts`(純領域模組),元件
 * 只負責排版。分開的理由很實際:加總的正確性因此可以在不開瀏覽器的情況下驗,
 * 而 T8 的驗收條件裡有一半是算術。
 *
 * **只做小計**(單價 × 數量)。稅率、人員時薪、運費都不在這一輪 —— D6 的原話是
 * 先確認「畫圖時看得到金額」有沒有價值,再談報價單的完整度。
 */
export default function QuotePanel({
  furniture,
}: {
  furniture: FurnitureItem[];
}) {
  const quote = quoteFor(furniture);

  return (
    <div data-testid="quote-panel" className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between px-0.5">
        <span className="text-xs font-bold text-muted-foreground">報價小計</span>
        <span
          data-testid="quote-item-count"
          className="font-mono text-[10px] text-muted-foreground"
        >
          {quote.itemCount} 件
        </span>
      </div>

      <div className="rounded border border-blueprint-light bg-blueprint-wash px-2 py-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-muted-foreground">合計</span>
          <span
            data-testid="quote-total"
            className="font-mono text-sm font-bold text-blueprint"
          >
            {formatTwd(quote.total)}
          </span>
        </div>
      </div>

      {quote.lines.length === 0 ? (
        // 空場地也要有東西可看 —— 只留一個 NT$ 0 會讓人以為面板還沒載好。
        <p
          data-testid="quote-empty"
          className="rounded border border-dashed border-stone-300 px-2 py-2 text-center text-[11px] text-muted-foreground"
        >
          尚未放置家具
        </p>
      ) : (
        <ul data-testid="quote-lines" className="flex flex-col gap-1">
          {quote.lines.map((line) => (
            <li
              key={line.code}
              data-testid={`quote-line-${line.code}`}
              className="flex flex-col gap-0.5 rounded border border-stone-300 bg-card px-2 py-1"
            >
              <span
                data-testid={`quote-line-name-${line.code}`}
                className="text-[11px] font-medium leading-tight text-foreground"
              >
                {line.name}
              </span>
              <div className="flex items-baseline justify-between font-mono text-[10px] text-muted-foreground">
                <span data-testid={`quote-line-unit-${line.code}`}>
                  {formatTwd(line.unitPrice)}
                </span>
                <span data-testid={`quote-line-quantity-${line.code}`}>
                  × {line.quantity}
                </span>
                <span
                  data-testid={`quote-line-subtotal-${line.code}`}
                  className="font-bold text-blueprint"
                >
                  {formatTwd(line.subtotal)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {quote.unknownCodes.length > 0 && (
        // 目錄查不到的代碼(多半是讀進來的舊存檔帶著已下架品項)。不靜靜跳過:
        // 那會讓金額少算而畫面上完全看不出來。
        <p
          data-testid="quote-unknown-codes"
          data-codes={quote.unknownCodes.join(",")}
          className="rounded border border-dashed border-amber-400 px-2 py-1 text-[10px] leading-tight text-amber-700"
        >
          {quote.unknownCodes.length} 件不在目錄中,未計入金額:
          {quote.unknownCodes.join("、")}
        </p>
      )}
    </div>
  );
}
