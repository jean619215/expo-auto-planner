import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { CATALOG, catalogItem } from "../src/lib/venue/catalog";

// 驗收閘:T7 家具目錄頁 UI(stories/venue-catalog-and-quote-draft.md,決議 D2)。
//
// 取代原本「整份目錄攤平成一排按鈕」的面板 —— 九項堪用,二十三項要一直捲,
// 而目標規模是上百項。三層導覽 + 跨全表搜尋。
//
// 面板只負責選,不負責放:點品項就是把 placingCode 交出去,實際落地仍是
// 地板點擊那條既有路徑(所以案例5同時是「沒有把放置改壞」的迴歸)。

const TABLE = "TBL-120-75";
const LONG_TABLE = "TBL-180-75";
const COCKTAIL_TABLE = "TBL-60-110";

async function toStep2(editor: PlanEditorPage) {
  await editor.navigate();
  await editor.applyCustomBoothSize(50, 50);
  await editor.clickNextStep();
  await editor.page.getByTestId("catalog-panel").waitFor();
}

/** 展開到某個子類,讓它底下的品項卡出現。 */
async function openTo(page: Page, category: string, sub: string) {
  await page.getByTestId(`catalog-category-${category}`).click();
  await page.getByTestId(`catalog-subcategory-${sub}`).click();
  await expect(page.getByTestId(`catalog-items-${sub}`)).toBeVisible();
}

test.describe("Catalogue page UI (T7)", () => {
  test("三層導覽:點大類展開子類,點子類列出品項", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);

    // 預設全部收合 —— 一進來就展開等於回到攤平清單。
    await expect(page.getByTestId("catalog-subcategories-B")).toHaveCount(0);

    await page.getByTestId("catalog-category-B").click();
    await expect(page.getByTestId("catalog-subcategories-B")).toBeVisible();
    // 子類已經出現,但品項還沒 —— 第二層與第三層是分開的。
    await expect(page.getByTestId("catalog-items-B1")).toHaveCount(0);

    await page.getByTestId("catalog-subcategory-B1").click();
    const items = page.getByTestId("catalog-items-B1");
    await expect(items).toBeVisible();

    // 這個子類底下的每一個品項都要在列表裡,不是只列前幾筆。
    const expected = CATALOG.filter((i) => i.subCategory === "B1");
    expect(expected.length).toBeGreaterThan(1);
    for (const item of expected) {
      await expect(items.getByTestId(`furniture-place-${item.code}`)).toHaveCount(
        1,
      );
    }
  });

  test("品項卡顯示名稱、尺寸、價格", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await openTo(page, "B", "B1");

    const spec = catalogItem(TABLE)!;
    const card = page.getByTestId(`furniture-place-${TABLE}`);
    await expect(card).toBeVisible();

    // 名稱:標題是型號名去掉尺寸那一段(下一行已經有尺寸,標題再寫一次是噪音)。
    await expect(card).toContainText(spec.name.split(/\s+/)[0]);

    // 尺寸:公分,由目錄資料算出來 —— 期望值也從資料算,但單位換算寫死在測試裡,
    // 這樣「顯示層漏掉換算」會被抓到(AGENTS.md:標註一律公分,運算維持公尺)。
    await expect(page.getByTestId(`catalog-dimension-${TABLE}`)).toHaveText(
      `${Math.round(spec.w * 100)} × ${Math.round(spec.d * 100)} × H${Math.round(
        spec.height3d * 100,
      )} cm`,
    );

    // 價格:含幣別,千分位。價格是 0 或缺席的話 T8 的報價小計驗不出來。
    await expect(page.getByTestId(`catalog-price-${TABLE}`)).toHaveText(
      `NT$ ${spec.price.toLocaleString("en-US")}`,
    );
  });

  test("搜尋「櫃」同時命中不同子類底下的品項", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);

    await page.getByTestId("catalog-search").fill("櫃");
    const results = page.getByTestId("catalog-search-results");
    await expect(results).toBeVisible();

    // 「櫃」橫跨展示櫃(A1)、接待櫃檯(C1)、櫃子(C3)三個子類。
    //
    // 用「櫃」而不是驗收條件寫的「桌」來驗跨子類:目錄裡帶「桌」的品項目前
    // 全在 B1,跨不了子類。守的東西沒變 —— 搜尋比對的是整份目錄而不是單一
    // 分支;「桌」則留給下一個案例驗「不是只比對開頭」。
    const expected = CATALOG.filter((i) => i.name.includes("櫃"));
    const subs = new Set(expected.map((i) => i.subCategory));
    expect(subs.size, "測試前提:「櫃」應該橫跨多個子類").toBeGreaterThan(1);

    for (const item of expected) {
      await expect(
        results.getByTestId(`furniture-place-${item.code}`),
        `${item.code}(${item.name})沒有出現在搜尋結果裡`,
      ).toHaveCount(1);
    }
  });

  test("搜尋比對的是任意位置,不是只比對開頭", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);

    await page.getByTestId("catalog-search").fill("桌");
    const results = page.getByTestId("catalog-search-results");

    // 「長桌」「洽談高桌」的「桌」都不在開頭 —— 只比對開頭的實作會漏掉它們,
    // 而畫面只會顯示比較少的結果,不會報錯。這一項就是破壞驗證要打的地方。
    await expect(
      results.getByTestId(`furniture-place-${LONG_TABLE}`),
    ).toHaveCount(1);
    await expect(
      results.getByTestId(`furniture-place-${COCKTAIL_TABLE}`),
    ).toHaveCount(1);
    await expect(results.getByTestId(`furniture-place-${TABLE}`)).toHaveCount(1);
  });

  test("搜尋不存在的字串顯示「無結果」,不是空白畫面", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);

    await page.getByTestId("catalog-search").fill("這個目錄裡沒有的東西");

    const empty = page.getByTestId("catalog-no-results");
    await expect(empty).toBeVisible();
    // 把搜尋字帶回畫面上 —— 使用者才知道系統收到的是什麼。
    await expect(empty).toContainText("這個目錄裡沒有的東西");
    await expect(page.getByTestId("catalog-result-count")).toHaveAttribute(
      "data-count",
      "0",
    );

    // 清掉搜尋要回得到三層導覽,不是卡在無結果畫面。
    await page.getByTestId("catalog-search-clear").click();
    await expect(page.getByTestId("catalog-tree")).toBeVisible();
    await expect(page.getByTestId("catalog-no-results")).toHaveCount(0);
  });

  test("點品項進入放置模式,點地板即放上該代碼的家具", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await openTo(page, "B", "B1");

    // 從搜尋結果以外的路徑(三層導覽)點選,確認兩條路徑共用同一個卡片元件。
    await page.getByTestId(`furniture-place-${COCKTAIL_TABLE}`).click();
    await expect(editor.scene).toHaveAttribute(
      "data-placing-code",
      COCKTAIL_TABLE,
    );

    const canvas = page.locator('[data-testid="venue-scene"] canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error("venue-scene canvas not visible");
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if ((await editor.furnitureCount()) === 1) break;
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(200);
      await page.mouse.down();
      await page.waitForTimeout(60);
      await page.mouse.up();
      await page.waitForTimeout(400);
    }
    await expect.poll(() => editor.furnitureCount(), { timeout: 10_000 }).toBe(1);

    // 放上去的必須是點選的那個代碼,不是同子類的另一個尺寸。
    const furniture = await editor.furniture();
    expect(furniture[0].code).toBe(COCKTAIL_TABLE);
  });

  test("尺寸不可調:目錄面板沒有任何寬高輸入框", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await openTo(page, "B", "B1");

    const panel = page.getByTestId("catalog-panel");
    // 面板裡唯一的輸入框是搜尋。多出一個 number 輸入就是尺寸被打開了 ——
    // 使用者要的是換一個型號,不是把桌子拉高(第三輪 D4)。
    await expect(panel.locator('input[type="number"]')).toHaveCount(0);
    await expect(panel.locator("input")).toHaveCount(1);
    await expect(panel.locator('input[data-testid="catalog-search"]')).toHaveCount(
      1,
    );

    // 場上也沒有縮放模式(與 venue-size-variants 同一條硬規定,兩邊各守一次)。
    await expect(page.getByTestId("furniture-mode-scale")).toHaveCount(0);
  });

  test("步驟 01 / 03 不受影響", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // 步驟 01 沒有目錄面板(家具只在步驟 02 擺),而且 2D 編輯照舊。
    await expect(page.getByTestId("catalog-panel")).toHaveCount(0);
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21 });
    expect(await editor.columnCount()).toBe(1);

    await editor.clickNextStep();
    await expect(page.getByTestId("catalog-panel")).toBeVisible();

    // 步驟 03 是唯讀場景,不該出現目錄面板。
    await editor.goToRefined();
    await expect(page.getByTestId("catalog-panel")).toHaveCount(0);

    // 回到步驟 02,面板還在、柱子也還在。
    await editor.backToPreview();
    await expect(page.getByTestId("catalog-panel")).toBeVisible();
    expect(await editor.columnCount()).toBe(1);
  });
});
