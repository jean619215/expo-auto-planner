import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { catalogItem } from "../src/lib/venue/catalog";
import { quoteFor, formatTwd } from "../src/lib/venue/quote";
import type { FurnitureItem } from "../src/lib/venue/furniture";

// 驗收閘:第三輪 T8 報價小計(stories/venue-catalog-and-quote-draft.md,決議 D6)。
//
// 要驗的是「畫圖的當下看得到累計金額」,而金額必須是**逐件加總**:同一個代碼
// 放三張就是三倍,兩種品項就是相加。這句話理所當然到不值得寫測試 —— 但 T8 的
// 破壞驗證正是「把加總改成只算第一件」,而那種錯誤在只有一件家具的畫面上完全
// 看不出來,在只有一種品項的畫面上也看不出來。所以案例刻意用兩種不同單價。
//
// **驗收條件第 3 項的數字與實際目錄不符,這裡照實際目錄走。** 故事寫的是
// 「再放一件 NT$700 → 小計 1350」,但目錄裡沒有 700 元的品項(最接近的是
// 方形展台 720)。改資料去遷就測試會讓目錄變成測試的附屬品,所以改的是測試:
// 650 + 720 = 1370。條件要守的性質原封不動 —— 兩種不同單價、總和既不等於
// 任一件也不等於任一件的兩倍,「只算第一件」「只算最後一件」「數量算錯」
// 三種壞法都躲不掉。

const TABLE = "TBL-120-75"; // 桌子,NT$650
const PLATFORM = "PLF-100-40"; // 方形展台,NT$720

/** 兩件不同單價的品項,金額差距夠大 —— 加總錯了不會剛好碰上另一個合法值。 */
const TABLE_PRICE = 650;
const PLATFORM_PRICE = 720;

async function canvasPoint(page: Page, offsetPx = { x: 0, y: 0 }) {
  const canvas = page.locator('[data-testid="venue-scene"] canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error("venue-scene canvas not visible");
  return {
    x: box.x + box.width / 2 + offsetPx.x,
    y: box.y + box.height / 2 + offsetPx.y,
  };
}

/**
 * 在步驟 02 放一件家具。
 *
 * 沿用 venue-size-variants 的重試:沒有 GPU 的環境首次進場景時 raycast 常常
 * 前幾次打空。放置成功會自動離開放置模式,所以多點幾次不會放成兩件 —— 而且
 * 件數在每一次重試前都重新確認,不是盲點。
 */
async function place(
  page: Page,
  editor: PlanEditorPage,
  code: string,
  offsetPx: { x: number; y: number } = { x: 0, y: 0 },
) {
  const before = await editor.furnitureCount();
  await editor.pickCatalogItem(code);
  await expect(editor.scene).toHaveAttribute("data-placing-code", code);

  const point = await canvasPoint(page, offsetPx);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if ((await editor.furnitureCount()) === before + 1) break;
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(200);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  await expect
    .poll(() => editor.furnitureCount(), {
      timeout: 10_000,
      message: `${code} 沒有放上去`,
    })
    .toBe(before + 1);
}

async function toStep2(editor: PlanEditorPage) {
  await editor.navigate();
  await editor.applyCustomBoothSize(20, 20);
  await editor.clickNextStep();
  await expect(editor.stepPreview).toBeVisible();
}

test.describe("Quote subtotal (T8)", () => {
  test("空場地的小計是 0", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);

    expect(await editor.quoteTotal()).toBe(0);
    expect(await editor.quoteItemCount()).toBe(0);
    // 空場地要說「還沒放」,不是只留一個 NT$ 0 讓人以為面板沒載好。
    await expect(page.getByTestId("quote-empty")).toBeVisible();
  });

  test("放一件 NT$650 的桌子 → 小計 650", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, TABLE);

    await expect.poll(() => editor.quoteTotal()).toBe(TABLE_PRICE);
    expect(await editor.quoteItemCount()).toBe(1);
  });

  test("再放一件展台 → 小計是兩件相加,不是取代", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, TABLE, { x: -60, y: 0 });
    await expect.poll(() => editor.quoteTotal()).toBe(TABLE_PRICE);

    await place(page, editor, PLATFORM, { x: 60, y: 0 });

    // 1370。等於 650 就是「只算第一件」,等於 720 就是「只算最後一件」。
    await expect
      .poll(() => editor.quoteTotal(), {
        message: "第二件沒有被加進小計",
      })
      .toBe(TABLE_PRICE + PLATFORM_PRICE);
    expect(await editor.quoteItemCount()).toBe(2);
  });

  test("刪掉其中一件,小計回到剩下那件的金額", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, TABLE, { x: -60, y: 0 });
    await place(page, editor, PLATFORM, { x: 60, y: 0 });
    await expect
      .poll(() => editor.quoteTotal())
      .toBe(TABLE_PRICE + PLATFORM_PRICE);

    // 剛放上去的那件會自動被選取(見 venue-step2-delete 的既有行為)。
    expect(await editor.sceneSelectedType()).toBe("furniture");
    await editor.clickSceneDelete();

    await expect.poll(() => editor.quoteTotal()).toBe(TABLE_PRICE);
    expect(await editor.quoteItemCount()).toBe(1);
    // 那一列要整列消失,不是留一列 0 元。
    await expect(page.getByTestId(`quote-line-${PLATFORM}`)).toHaveCount(0);
    await expect(page.getByTestId(`quote-line-${TABLE}`)).toBeVisible();
  });

  test("小計與場景裡實際存在的家具一致(拿探針交叉驗證,不是只讀畫面數字)", async ({
    page,
  }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, TABLE, { x: -70, y: -30 });
    await place(page, editor, TABLE, { x: 0, y: 30 });
    await place(page, editor, PLATFORM, { x: 70, y: -30 });

    // 三件家具但只有兩個代碼 —— 探針的摘要是依代碼歸併的,件數看 `instances`。
    await expect
      .poll(
        async () =>
          (await editor.sceneFurnitureShapes()).reduce(
            (sum, shape) => sum + shape.instances,
            0,
          ),
        { timeout: 30_000 },
      )
      .toBe(3);

    // **基準來自場景本身**:`instances` 數的是場景圖裡實際掛著的家具根 group,
    // 不是把家具陣列的長度印回 DOM。金額從那份清單獨立算一次,再跟畫面上的
    // 數字比 —— 場景少掛一件,兩邊就會對不上,而不是一起錯。
    const shapes = await editor.sceneFurnitureShapes();
    const expected = shapes.reduce(
      (sum, shape) => sum + catalogItem(shape.code)!.price * shape.instances,
      0,
    );
    expect(expected).toBe(TABLE_PRICE * 2 + PLATFORM_PRICE);
    expect(await editor.quoteTotal()).toBe(expected);
    expect(await editor.quoteItemCount()).toBe(
      shapes.reduce((sum, shape) => sum + shape.instances, 0),
    );
    // 同款兩件真的是兩件,不是被歸併掉的一件。
    expect(shapes.find((s) => s.code === TABLE)!.instances).toBe(2);
  });

  test("明細列出名稱、數量、單價、小計 —— 同款兩件併成一列且數量為 2", async ({
    page,
  }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, TABLE, { x: -70, y: -30 });
    await place(page, editor, TABLE, { x: 0, y: 30 });
    await place(page, editor, PLATFORM, { x: 70, y: -30 });
    await expect
      .poll(() => editor.quoteTotal())
      .toBe(TABLE_PRICE * 2 + PLATFORM_PRICE);

    const table = await editor.quoteLine(TABLE);
    expect(table.name).toBe(catalogItem(TABLE)!.name);
    expect(table.quantity).toBe(2);
    expect(table.unitPrice).toBe(TABLE_PRICE);
    // 小計是單價乘數量,不是單價本身 —— 這一格錯了,合計也就跟著錯。
    expect(table.subtotal).toBe(TABLE_PRICE * 2);

    const platform = await editor.quoteLine(PLATFORM);
    expect(platform.name).toBe(catalogItem(PLATFORM)!.name);
    expect(platform.quantity).toBe(1);
    expect(platform.unitPrice).toBe(PLATFORM_PRICE);
    expect(platform.subtotal).toBe(PLATFORM_PRICE);

    // 只有兩列(三件家具,同款併列)。
    await expect(page.getByTestId("quote-lines").locator("li")).toHaveCount(2);
  });

  test("加總的算術(領域層,不需瀏覽器)", () => {
    // 這一項不開瀏覽器:金額是領域知識,錯了不該等到 3D 才發現。上面的瀏覽器
    // 案例驗的是「面板有接上」,這裡驗的是「算得對」。
    const at = (code: string, id: string): FurnitureItem => ({
      id,
      code,
      center: { x: 20, y: 20 },
      rotationDeg: 0,
    });

    expect(quoteFor([]).total).toBe(0);
    expect(quoteFor([]).lines).toEqual([]);

    const one = quoteFor([at(TABLE, "a")]);
    expect(one.total).toBe(TABLE_PRICE);
    expect(one.itemCount).toBe(1);

    // 五件同款 = 五倍。逐件加總的最直接反例:任何「每個代碼只算一次」的
    // 寫法在這裡會停在 650。
    const five = quoteFor(["a", "b", "c", "d", "e"].map((id) => at(TABLE, id)));
    expect(five.total).toBe(TABLE_PRICE * 5);
    expect(five.lines).toHaveLength(1);
    expect(five.lines[0].quantity).toBe(5);

    const mixed = quoteFor([at(TABLE, "a"), at(PLATFORM, "b"), at(TABLE, "c")]);
    expect(mixed.total).toBe(TABLE_PRICE * 2 + PLATFORM_PRICE);
    expect(mixed.itemCount).toBe(3);
    // 列的順序依金額由大到小:1300 的桌子在 720 的展台前面。
    expect(mixed.lines.map((l) => l.code)).toEqual([TABLE, PLATFORM]);
    // 每一列的小計自己要對,合計才不是碰巧湊出來的。
    expect(mixed.lines.reduce((s, l) => s + l.subtotal, 0)).toBe(mixed.total);

    // 目錄查不到的代碼(舊存檔帶著已下架品項)不靜靜跳過:金額不含它,但
    // 件數含它,而且代碼要被列出來 —— 否則畫面上看不出「這張報價不完整」。
    const stale = quoteFor([at(TABLE, "a"), at("NO-SUCH-CODE", "b")]);
    expect(stale.total).toBe(TABLE_PRICE);
    expect(stale.itemCount).toBe(2);
    expect(stale.unknownCodes).toEqual(["NO-SUCH-CODE"]);
  });

  test("金額格式與目錄卡片一致", () => {
    // 兩處看到的數字要長得一樣,否則同一件桌子在目錄是 NT$650、在報價是
    // NT$ 650.00,使用者會懷疑自己看錯。
    expect(formatTwd(0)).toBe("NT$ 0");
    expect(formatTwd(650)).toBe("NT$ 650");
    expect(formatTwd(1370)).toBe("NT$ 1,370");
    expect(formatTwd(1234567)).toBe("NT$ 1,234,567");
  });
});
