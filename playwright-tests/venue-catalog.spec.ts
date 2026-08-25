import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import {
  CATALOG,
  CATEGORIES,
  SUB_CATEGORIES,
  catalogItem,
} from "../src/lib/venue/catalog";
import { KIND_TO_CODE } from "../src/lib/venue/furniture";

// 驗收閘:T2 家具目錄資料層(stories/venue-catalog-and-quote-draft.md)。
//
// 這一步把「9 種寫死的 kind」換成有代碼、分類與價格的目錄,`FurnitureItem`
// 只留 `code`。繪製路徑本身還沒改吃目錄(那是 T3),所以這裡的重點是**資料
// 的完整性**與**品項身上真的只剩代碼**。
//
// 目錄是純領域模組,直接 import 進 spec 比從 DOM 撈回來誠實 —— 從 DOM 撈只
// 證明「頁面回報了什麼」,import 證明「資料本身是什麼」。第 6 項才需要走瀏覽
// 器,因為它問的是「放下去之後存了什麼」。

/** 步驟 02 的 canvas 中心點(螢幕座標)。 */
async function canvasCenter(page: Page) {
  const canvas = page.locator('[data-testid="venue-scene"] canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error("venue-scene canvas not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 見 venue-step2-delete.spec.ts 的同名函式:繞開 OrbitControls 的首輪時序。 */
async function clickFloor(page: Page, point: { x: number; y: number }) {
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
}

test.describe("Furniture catalogue (T2)", () => {
  test("目錄至少九個品項,且九種既有家具都在裡面", async () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(9);

    // 不是只數數量 —— 逐一確認舊的九種都找得到對應品項,否則「遷移」可能
    // 漏掉其中幾種而數量仍然湊得出來。
    for (const [kind, code] of Object.entries(KIND_TO_CODE)) {
      expect(catalogItem(code), `${kind} 對應的代碼 ${code} 不在目錄裡`).toBeTruthy();
    }
  });

  test("每個 code 唯一", async () => {
    const codes = CATALOG.map((item) => item.code);
    const seen = new Map<string, number>();
    for (const code of codes) seen.set(code, (seen.get(code) ?? 0) + 1);
    const duplicates = [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([code, count]) => `${code} ×${count}`);

    expect(duplicates, `重複的代碼: ${duplicates.join(", ")}`).toEqual([]);
    expect(new Set(codes).size).toBe(CATALOG.length);
  });

  test("沒有孤兒分類 —— 每個品項的大類/子類都指得到", async () => {
    const categoryCodes = new Set(CATEGORIES.map((c) => c.code));
    const subByCode = new Map(SUB_CATEGORIES.map((s) => [s.code, s]));

    for (const item of CATALOG) {
      expect(
        categoryCodes.has(item.category),
        `${item.code} 的大類 ${item.category} 不存在`,
      ).toBe(true);

      const sub = subByCode.get(item.subCategory);
      expect(sub, `${item.code} 的子類 ${item.subCategory} 不存在`).toBeTruthy();
      // 子類自己也要掛在對的大類底下,否則 A1 掛在 B 底下這種錯配會讓目錄頁
      // 的三層導覽走不通,而上面兩個檢查都還是綠的。
      expect(
        sub!.category,
        `${item.code}:子類 ${item.subCategory} 屬於 ${sub!.category},品項卻標 ${item.category}`,
      ).toBe(item.category);
    }

    // 反方向:子類指的大類也必須存在。
    for (const sub of SUB_CATEGORIES) {
      expect(categoryCodes.has(sub.category), `子類 ${sub.code} 的大類不存在`).toBe(
        true,
      );
    }
  });

  test("每個品項的幾何來源有效,GLB 檔案實際拿得到", async ({ request }) => {
    const modelUrls: string[] = [];

    for (const item of CATALOG) {
      const geometry = item.geometry;
      expect(["procedural", "model"]).toContain(geometry.kind);
      if (geometry.kind === "model") {
        expect(geometry.url).toMatch(/^\/models\/venue\/.+\.glb$/);
        modelUrls.push(geometry.url);
      } else {
        expect(geometry.shape.length).toBeGreaterThan(0);
      }
    }

    // 檔案真的存在才算數 —— manifest 指向一個不存在的路徑,型別檢查與上面
    // 的字串比對都攔不住,要到使用者進步驟 03 才會發現模型沒出現。
    for (const url of modelUrls) {
      const response = await request.get(url);
      expect(response.status(), `${url} 取不到`).toBe(200);
    }
  });

  test("FurnitureItem 身上沒有 kind / w / h 欄位", async () => {
    // tsc 會擋掉讀取,但擋不住「欄位還留在型別上、只是沒人用」。直接看介面
    // 本體:這一項要驗的是欄位真的消失了,不是恰好沒被讀。
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/venue/furniture.ts"),
      "utf8",
    );
    const match = source.match(
      /export interface FurnitureItem \{([\s\S]*?)\n\}/,
    );
    expect(match, "找不到 FurnitureItem 的介面宣告").toBeTruthy();

    const body = match![1];
    for (const field of ["kind", "w", "h"]) {
      expect(
        new RegExp(`^\\s*${field}\\??:`, "m").test(body),
        `FurnitureItem 仍帶著 ${field} 欄位`,
      ).toBe(false);
    }
    expect(/^\s*code:/m.test(body), "FurnitureItem 沒有 code 欄位").toBe(true);
  });

  test("尺寸逐字沿用遷移前的值 —— T2 是搬家不是改設計", async () => {
    // 遷移時把數字重打一次是最容易出錯的地方,而錯了之後畫面只是「稍微不對」,
    // 沒有任何既有 spec 會紅。這裡釘住三個代表性品項的三軸尺寸。
    const table = catalogItem("TBL-120-75")!;
    expect([table.w, table.d, table.height3d]).toEqual([1.2, 0.7, 0.75]);

    const chair = catalogItem("CHR-45-90")!;
    expect([chair.w, chair.d, chair.height3d]).toEqual([0.45, 0.45, 0.9]);

    const banner = catalogItem("BNR-80-200")!;
    expect([banner.w, banner.d, banner.height3d]).toEqual([0.8, 0.3, 2.0]);
  });

  test("放下一件家具後,存的只有 id / code / center / rotationDeg", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.clickNextStep();
    await expect(editor.stepPreview).toBeVisible();

    await page.getByTestId("furniture-place-table").click();

    // 重試放置:clickFloor 的時序問題偶爾讓第一次點擊打不到地板 mesh(見
    // clickFloor 的註解)。整套一起跑時機器較忙,三次不夠 —— 這一項要驗的是
    // 「放下去之後存了什麼」,放置本身只是前置動作,但仍然明確斷言它成功。
    const center = await canvasCenter(page);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if ((await editor.scene.getAttribute("data-furniture-mesh-count")) === "1") {
        break;
      }
      await clickFloor(page, center);
      await page.waitForTimeout(250);
    }
    await expect(editor.scene).toHaveAttribute("data-furniture-mesh-count", "1");

    const raw = await editor.editor.getAttribute("data-furniture");
    const items = JSON.parse(raw ?? "[]") as Record<string, unknown>[];
    expect(items).toHaveLength(1);

    expect(Object.keys(items[0]).sort()).toEqual([
      "center",
      "code",
      "id",
      "rotationDeg",
    ]);
    expect(items[0].code).toBe("TBL-120-75");
  });
});
