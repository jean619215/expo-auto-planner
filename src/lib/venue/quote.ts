// 報價小計的純領域模組(第三輪 T8,決議 D6)。
//
// 不 import React / DOM / Konva / Three(AGENTS.md 分層規定)。金額計算是領域
// 知識,應該可以在沒有瀏覽器的情況下被讀懂與驗證 —— 事實上 T8 的加總正確性
// 就是用一支不開瀏覽器的檢查在守。
//
// D6:**這一輪只做小計**(單價 × 數量)。稅率與人員時薪之後再說 —— 先驗證
// 「畫圖時看得到累計金額」這件事有沒有用。

import { catalogItem, type CatalogCurrency } from "./catalog";
import type { FurnitureItem } from "./furniture";

/** 報價單上的一列:同一個品項的所有件數併成一列。 */
export interface QuoteLine {
  code: string;
  /** 品項全名(含尺寸),與目錄一致。 */
  name: string;
  quantity: number;
  unitPrice: number;
  /** `unitPrice × quantity`。 */
  subtotal: number;
}

export interface Quote {
  lines: QuoteLine[];
  /** 所有列的小計加總。 */
  total: number;
  /** 場上總件數(不是列數)—— 與探針回報的家具件數交叉驗證用。 */
  itemCount: number;
  currency: CatalogCurrency;
  /**
   * 目錄裡查不到的代碼。**正常情況應為空。**
   *
   * 不靜靜跳過:讀進來的舊存檔可能帶著已下架的代碼,那時金額會少算,而畫面上
   * 看不出來。列出來才有機會發現「這張圖的報價不完整」。
   */
  unknownCodes: string[];
}

/**
 * 場上家具 → 報價小計。
 *
 * **逐件加總**,不是每個品項算一次就好 —— 同一個代碼放三張,金額就是三倍。
 * 這句看起來理所當然,但 T8 的破壞驗證正是「把加總改成只算第一件」,
 * 而那種錯誤在只有一件家具的畫面上完全看不出來。
 *
 * 列的順序依**金額由大到小**,金額相同再依代碼 —— 報價單上先看到的應該是花最多
 * 錢的那幾項。依代碼排序在金額相同時才介入,讓輸出穩定(否則同價品項的順序會
 * 隨場上放置順序跳動,測試與人眼都難比對)。
 */
export function quoteFor(furniture: readonly FurnitureItem[]): Quote {
  const counts = new Map<string, number>();
  for (const item of furniture) {
    counts.set(item.code, (counts.get(item.code) ?? 0) + 1);
  }

  const lines: QuoteLine[] = [];
  const unknownCodes: string[] = [];

  for (const [code, quantity] of counts) {
    const entry = catalogItem(code);
    if (!entry) {
      unknownCodes.push(code);
      continue;
    }
    lines.push({
      code,
      name: entry.name,
      quantity,
      unitPrice: entry.price,
      subtotal: entry.price * quantity,
    });
  }

  lines.sort((a, b) =>
    b.subtotal !== a.subtotal
      ? b.subtotal - a.subtotal
      : a.code.localeCompare(b.code),
  );

  return {
    lines,
    total: lines.reduce((sum, line) => sum + line.subtotal, 0),
    // 場上件數含查不到代碼的那些 —— 它們確實在圖上,只是算不出錢。
    itemCount: furniture.length,
    currency: "TWD",
    unknownCodes: unknownCodes.sort(),
  };
}

/**
 * 金額字串。與目錄卡片同一個格式(`NT$ 1,234`),兩處看到的數字才長得一樣。
 *
 * 幣別目前恆為 TWD(目錄有測試守著),所以前綴寫死 —— 真的出現第二種幣別時,
 * 這裡會是需要動的第一個地方,而不是散在各個元件裡。
 */
export function formatTwd(amount: number): string {
  return `NT$ ${Math.round(amount).toLocaleString("en-US")}`;
}
