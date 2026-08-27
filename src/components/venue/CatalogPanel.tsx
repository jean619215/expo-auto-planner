"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  Armchair,
  ChevronDown,
  ChevronRight,
  Flag,
  Flower2,
  LayoutPanelTop,
  Package,
  Presentation,
  Search,
  Sofa,
  Store,
  Table2,
  X,
} from "lucide-react";
import {
  CATALOG,
  CATEGORIES,
  subCategoriesIn,
  itemsInSubCategory,
  type CatalogItem,
} from "@/lib/venue/catalog";
import { cn } from "@/lib/utils";

/**
 * 家具目錄面板:大類 → 子類 → 品項的三層導覽,加一個跨全表的搜尋。
 *
 * 取代原本「把整份 CATALOG 攤平成一排按鈕」的做法 —— 那在九個品項時堪用,
 * 二十三個就得一直捲,而目錄的目標規模是上百項。
 *
 * **這個面板只負責選,不負責放。** 點一個品項就是把 `placingCode` 交出去,
 * 實際落地由 3D 場景的地板點擊處理(與先前完全相同的一條路徑)。
 *
 * **沒有任何尺寸輸入。** 家具尺寸的唯一來源是目錄(AGENTS.md 硬規定,第三輪
 * D4 再次確認):使用者要的是換一個型號,不是把桌子拉高 —— 現實中租不到
 * 「拉高 13% 的桌子」。卡片上的尺寸是唯讀資訊。
 */

/**
 * 子類的圖示。目錄收合時,圖示是唯一能一眼分辨子類的線索。
 *
 * 缺的子類退回 `Package` —— 新增子類忘了配圖示只會少一個線索,不該讓面板炸掉。
 */
const SUBCATEGORY_ICONS: Record<string, typeof Table2> = {
  A1: Package,
  A2: Flag,
  A3: LayoutPanelTop,
  B1: Table2,
  B2: Armchair,
  B3: Sofa,
  C1: Store,
  C2: Presentation,
  C3: Archive,
  D1: Flower2,
};

/** 公尺 → 公分整數。顯示層一律公分(台灣建築圖慣例,AGENTS.md)。 */
function cm(meters: number): number {
  return Math.round(meters * 100);
}

function itemDimensionText(item: CatalogItem): string {
  return `${cm(item.w)} × ${cm(item.d)} × H${cm(item.height3d)} cm`;
}

/**
 * 卡片標題:品項名稱去掉尺寸那一段。
 *
 * 目錄的 `name` 是「高桌 120×70×H100」這種完整型號名(廠商型錄的慣例,拿到
 * 真型錄時這個欄位會直接被取代)。卡片下一行已經有從資料算出來的公分尺寸,
 * 標題再重複一次同樣的數字只是噪音。切在第一個空白 —— 沒有空白就用整個名稱,
 * 不會因為換了命名慣例就變成空字串。完整名稱仍留在 `title` 裡。
 */
function itemHeading(item: CatalogItem): string {
  const [head] = item.name.split(/\s+/);
  return head || item.name;
}

function priceText(item: CatalogItem): string {
  return `NT$ ${item.price.toLocaleString("en-US")}`;
}

/**
 * 搜尋比對:名稱、英文規格名、代碼,**任意位置**皆可命中。
 *
 * 不是只比對開頭 —— 使用者搜「桌」要找得到「長桌」「洽談高桌」,搜「櫃」要
 * 同時撈出展示櫃、接待櫃檯、矮櫃(分屬三個不同子類)。只比開頭的話這些全都
 * 漏掉,而畫面上只會顯示「無結果」,看不出是搜尋壞了還是目錄真的沒有。
 */
function matchesQuery(item: CatalogItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.name.toLowerCase().includes(q) ||
    item.spec.toLowerCase().includes(q) ||
    item.code.toLowerCase().includes(q)
  );
}

function ItemCard({
  item,
  active,
  onPick,
}: {
  item: CatalogItem;
  active: boolean;
  onPick: (code: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid={`furniture-place-${item.code}`}
      data-catalog-item={item.code}
      aria-pressed={active}
      title={`${item.name} — ${priceText(item)}`}
      onClick={() => onPick(item.code)}
      className={cn(
        "flex w-full flex-col items-start gap-0.5 rounded border px-2 py-1.5 text-left transition-colors",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none",
        active
          ? "border-blueprint bg-blueprint text-white"
          : "border-stone-300 bg-card text-foreground hover:bg-blueprint-wash",
      )}
    >
      <span className="text-xs font-medium leading-tight">
        {itemHeading(item)}
      </span>
      <span
        data-testid={`catalog-dimension-${item.code}`}
        className={cn(
          "font-mono text-[10px] leading-tight",
          active ? "text-blueprint-light" : "text-muted-foreground",
        )}
      >
        {itemDimensionText(item)}
      </span>
      <span
        data-testid={`catalog-price-${item.code}`}
        className={cn(
          "text-[11px] font-bold leading-tight",
          active ? "text-white" : "text-blueprint",
        )}
      >
        {priceText(item)}
      </span>
    </button>
  );
}

export default function CatalogPanel({
  placingCode,
  onPick,
}: {
  placingCode: string | null;
  onPick: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  // 預設全部收合。目錄長大之後,一進來就展開等於回到攤平清單。
  const [openCategories, setOpenCategories] = useState<string[]>([]);
  const [openSubCategories, setOpenSubCategories] = useState<string[]>([]);

  const searching = query.trim().length > 0;
  const results = useMemo(
    () => (searching ? CATALOG.filter((item) => matchesQuery(item, query)) : []),
    [query, searching],
  );

  function toggle(list: string[], code: string): string[] {
    return list.includes(code)
      ? list.filter((c) => c !== code)
      : [...list, code];
  }

  return (
    <div data-testid="catalog-panel" className="flex flex-col gap-1.5">
      <span className="px-0.5 text-xs font-bold text-muted-foreground">
        家具目錄
      </span>

      <div className="relative">
        <Search className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
        <input
          // 刻意用 text 而不是 search:`type="search"` 在 Chromium 會自己長出
          // 一顆原生清除鈕,和下面那顆疊成兩個 ✕。
          type="text"
          data-testid="catalog-search"
          value={query}
          placeholder="搜尋名稱或代碼"
          aria-label="搜尋家具目錄"
          onChange={(e) => setQuery(e.currentTarget.value)}
          className="w-full rounded border border-stone-300 bg-card py-1 pl-6 pr-6 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none"
        />
        {searching && (
          <button
            type="button"
            data-testid="catalog-search-clear"
            aria-label="清除搜尋"
            onClick={() => setQuery("")}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-blueprint-wash hover:text-blueprint [&_svg]:size-3"
          >
            <X />
          </button>
        )}
      </div>

      {searching ? (
        <div data-testid="catalog-search-results" className="flex flex-col gap-1">
          <span
            data-testid="catalog-result-count"
            data-count={results.length}
            className="px-0.5 text-[10px] text-muted-foreground"
          >
            {results.length} 項符合
          </span>
          {results.length === 0 ? (
            // 空白畫面會讓人以為是壞了。明說沒有結果,並保留搜尋字讓人知道搜了什麼。
            <p
              data-testid="catalog-no-results"
              className="rounded border border-dashed border-stone-300 px-2 py-3 text-center text-xs text-muted-foreground"
            >
              找不到「{query.trim()}」
            </p>
          ) : (
            results.map((item) => (
              <ItemCard
                key={item.code}
                item={item}
                active={placingCode === item.code}
                onPick={onPick}
              />
            ))
          )}
        </div>
      ) : (
        <div data-testid="catalog-tree" className="flex flex-col gap-0.5">
          {CATEGORIES.map((category) => {
            const subs = subCategoriesIn(category.code);
            const categoryOpen = openCategories.includes(category.code);
            const categoryCount = CATALOG.filter(
              (i) => i.category === category.code,
            ).length;

            return (
              <div key={category.code} className="flex flex-col">
                <button
                  type="button"
                  data-testid={`catalog-category-${category.code}`}
                  aria-expanded={categoryOpen}
                  onClick={() =>
                    setOpenCategories((prev) => toggle(prev, category.code))
                  }
                  className="flex items-center gap-1 rounded px-1 py-1 text-xs font-bold text-blueprint hover:bg-blueprint-wash focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-3 [&_svg]:shrink-0"
                >
                  {categoryOpen ? <ChevronDown /> : <ChevronRight />}
                  <span className="flex-1 text-left">{category.label}</span>
                  <span className="font-mono text-[10px] font-normal text-muted-foreground">
                    {categoryCount}
                  </span>
                </button>

                {categoryOpen && (
                  <div
                    data-testid={`catalog-subcategories-${category.code}`}
                    className="ml-2 flex flex-col gap-0.5 border-l border-blueprint-light pl-1.5"
                  >
                    {subs.map((sub) => {
                      const items = itemsInSubCategory(sub.code);
                      const subOpen = openSubCategories.includes(sub.code);
                      const SubIcon = SUBCATEGORY_ICONS[sub.code] ?? Package;
                      return (
                        <div key={sub.code} className="flex flex-col">
                          <button
                            type="button"
                            data-testid={`catalog-subcategory-${sub.code}`}
                            aria-expanded={subOpen}
                            onClick={() =>
                              setOpenSubCategories((prev) =>
                                toggle(prev, sub.code),
                              )
                            }
                            className="flex items-center gap-1 rounded px-1 py-1 text-xs text-foreground hover:bg-blueprint-wash focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-3 [&_svg]:shrink-0"
                          >
                            {subOpen ? <ChevronDown /> : <ChevronRight />}
                            <SubIcon />
                            <span className="flex-1 text-left">{sub.label}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {items.length}
                            </span>
                          </button>

                          {subOpen && (
                            <div
                              data-testid={`catalog-items-${sub.code}`}
                              className="ml-1.5 flex flex-col gap-1 py-0.5"
                            >
                              {items.map((item) => (
                                <ItemCard
                                  key={item.code}
                                  item={item}
                                  active={placingCode === item.code}
                                  onPick={onPick}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
