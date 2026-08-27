import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import path from "path";
import {
  CATALOG,
  CATEGORIES,
  SUB_CATEGORIES,
  catalogStats,
} from "../src/lib/venue/catalog";

// 驗收閘:T6 擴充目錄與價格(stories/venue-catalog-and-quote-draft.md,決議 D2)。
//
// 這一支幾乎不開瀏覽器:目錄是純資料,結構錯了不必等到 UI 才發現。三層結構的
// 破口(孤兒品項、空子類)在目錄小的時候用眼睛看得出來,長到上百項就不行了 ——
// 所以判斷交給 `catalogStats()`,而它同時是目錄頁 UI 要用的那一份。

test.describe("Catalogue structure and pricing (T6)", () => {
  test("三層結構完整:每個大類有子類,每個子類有品項,沒有孤兒", () => {
    const stats = catalogStats();

    expect(stats.categories.length, "大類數").toBeGreaterThan(0);
    for (const category of stats.categories) {
      expect(
        category.subCategories.length,
        `大類 ${category.code}(${category.label})底下沒有子類`,
      ).toBeGreaterThan(0);
    }

    // 空子類在目錄頁會是一個點得到、但點進去沒東西的節點。
    expect(
      stats.emptySubCategories,
      `這些子類底下沒有品項: ${stats.emptySubCategories.join(", ")}`,
    ).toEqual([]);

    // 孤兒 = 子類不存在、大類不存在,或品項自記的大類與子類所屬的大類不一致。
    expect(
      stats.orphanItems,
      `這些品項的分類指向不存在或不一致: ${stats.orphanItems.join(", ")}`,
    ).toEqual([]);
  });

  test("每個品項的價格是正數,幣別一律 TWD", () => {
    for (const item of CATALOG) {
      expect(
        item.price,
        `${item.code}(${item.name})的價格不是正數`,
      ).toBeGreaterThan(0);
      expect(Number.isFinite(item.price), `${item.code} 的價格不是有限數`).toBe(
        true,
      );
      expect(item.currency, `${item.code} 的幣別`).toBe("TWD");
    }
    // 報價小計(T8)靠這個 —— 有一筆 0 就驗不出「金額有跟著變」。
    expect(catalogStats().currencies).toEqual(["TWD"]);
  });

  test("統計數字與目錄本身對得上(不是各算各的)", () => {
    const stats = catalogStats();

    expect(stats.totalItems).toBe(CATALOG.length);
    // 各大類件數加總 = 總數。對不上表示有品項的 category 落在 CATEGORIES 之外。
    const summed = stats.categories.reduce((n, c) => n + c.itemCount, 0);
    expect(summed, "各大類件數加總與總數不符").toBe(stats.totalItems);

    // 子類件數加總同理。
    const subSummed = stats.categories
      .flatMap((c) => c.subCategories)
      .reduce((n, s) => n + s.itemCount, 0);
    expect(subSummed, "各子類件數加總與總數不符").toBe(stats.totalItems);

    expect(stats.categories.map((c) => c.code)).toEqual(
      CATEGORIES.map((c) => c.code),
    );
    expect(
      stats.categories.flatMap((c) => c.subCategories).map((s) => s.code).sort(),
    ).toEqual(SUB_CATEGORIES.map((s) => s.code).sort());
  });

  test("每個代碼唯一,且格式一致", () => {
    const codes = CATALOG.map((i) => i.code);
    expect(new Set(codes).size, "有重複代碼").toBe(codes.length);
    for (const code of codes) {
      // D3:代碼由我們定,形狀照未來廠商資料設計 —— 前綴-寬-高(公分)。
      expect(code, `${code} 不符合代碼格式`).toMatch(/^[A-Z]{3}-\d+-\d+$/);
    }
  });

  test("所有 model 品項的 GLB 檔案實際存在", () => {
    const modelItems = CATALOG.filter((i) => i.geometry.kind === "model");
    expect(modelItems.length, "至少要有一個 model 品項").toBeGreaterThan(0);

    for (const item of modelItems) {
      if (item.geometry.kind !== "model") continue;
      // geometry.url 是 public/ 底下的絕對路徑。
      const filePath = path.join(
        process.cwd(),
        "public",
        item.geometry.url.replace(/^\//, ""),
      );
      expect(
        existsSync(filePath),
        `${item.code} 指向的 ${item.geometry.url} 不存在`,
      ).toBe(true);
      // 不只存在 —— 要是有效的 glTF 二進位容器(magic "glTF")。
      const head = readFileSync(filePath).subarray(0, 4).toString("ascii");
      expect(head, `${item.code} 的檔案不是 GLB`).toBe("glTF");
    }
  });

  test("目前沒有任何 model 品項需要方位修正", () => {
    // `rotationY` 原本只有 cabinet 用到(模型原生長邊在 X、平面圖長邊在 Z),
    // T5 把 cabinet 改成程序化之後就沒有使用者了,守著它的
    // `venue-furniture-models` M2 也一併移除。
    //
    // 欄位與 `normalizeModel()` 裡的機制都留著(模型本來就可能以任意方位匯出),
    // 但**留著的東西必須有人看著**:這一項把「目前沒人用」變成一個明說的事實。
    // 哪天有品項用上非零的 rotationY,這裡會紅 —— 那是在提醒補一支驗方位的測試,
    // 不是叫你把數字改回 0。
    for (const item of CATALOG) {
      if (item.geometry.kind !== "model") continue;
      expect(
        item.geometry.rotationY,
        `${item.code} 用了方位修正 —— 請補一支驗「長邊對上平面圖長邊」的測試,` +
          `然後把這一項改成允許它`,
      ).toBe(0);
    }
  });

  test("尺寸變體共用造型:同一個 shape 底下不只一個品項", () => {
    // T5 的整個重點。若每個 shape 都只對到一個品項,「尺寸是參數」這件事
    // 就從來沒被用過,目錄也不可能長到競品那個規模。
    const byShape = new Map<string, string[]>();
    for (const item of CATALOG) {
      if (item.geometry.kind !== "procedural") continue;
      const list = byShape.get(item.geometry.shape) ?? [];
      list.push(item.code);
      byShape.set(item.geometry.shape, list);
    }
    const shared = [...byShape.values()].filter((codes) => codes.length > 1);
    expect(
      shared.length,
      `沒有任何造型被多個品項共用: ${JSON.stringify([...byShape])}`,
    ).toBeGreaterThan(0);
  });

  test("送給模型的目錄附錄還在可接受的大小", () => {
    // T4 把目錄放進每輪的目前配置附錄,因為 tool schema 不能用 enum。
    // 代價是**每一輪都送一次**,所以目錄長大時要盯著這個數字。
    //
    // 這裡不是效能測試,是一道提醒:超過門檻就該改成給模型一支查詢工具,
    // 而不是繼續加大清單(RESUME.md 與 T4 的紀錄都寫了)。
    const payload = CATALOG.map((i) => ({
      code: i.code,
      name: i.name,
      w: i.w,
      d: i.d,
      height3d: i.height3d,
    }));
    const bytes = JSON.stringify(payload).length;

    // 8KB 約 2500 tokens/輪。目前 23 項約 1.8KB;競品規模 233 項推估約 18KB,
    // 會在中途撞到這條線 —— 那正是該換做法的時候。
    expect(
      bytes,
      `目錄附錄已達 ${bytes} bytes(${CATALOG.length} 項)。` +
        `該把每輪夾帶整份目錄改成給模型一支查詢工具了。`,
    ).toBeLessThan(8_000);
  });
});
