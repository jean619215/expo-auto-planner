import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { CATALOG, catalogItem } from "../src/lib/venue/catalog";

// 驗收閘:T5 方正規格件改程序化參數化幾何
// (stories/venue-catalog-and-quote-draft.md,決議 D4)。
//
// 目錄要有「桌子 H75」與「高桌 H100」兩個品項,而一份 GLB 只有一種比例:
// 等比縮放做不出兩種正確高度,非等比拉伸又違反「匯入模型一律等比縮放」的硬
// 規定(而且拉長的桌腳很難看)。程序化造型沒有這個問題 —— 高度就是參數。
//
// 這一輪守的是「同款不同尺寸真的做得出來」,以及「該走 GLB 的仍然走 GLB、
// 而且仍然等比」。

const TABLE_LOW = "TBL-120-75";
const TABLE_HIGH = "TBL-120-100";
/** T5 之後仍是 GLB 的三種(曲面件,方箱畫不出來)。 */
const MODEL_CODES = ["CHR-45-90", "SOF-180-80", "PLT-50-120"];

async function toStep2(editor: PlanEditorPage) {
  await editor.navigate();
  await editor.applyCustomBoothSize(50, 50);
  await editor.clickNextStep();
}

async function place(
  page: Page,
  editor: PlanEditorPage,
  code: string,
  offsetPx: { x: number; y: number } = { x: 0, y: 0 },
) {
  const before = await editor.furnitureCount();
  await editor.pickCatalogItem(code);
  await expect(editor.scene).toHaveAttribute("data-placing-code", code);

  const canvas = page.locator('[data-testid="venue-scene"] canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error("venue-scene canvas not visible");
  const point = {
    x: box.x + box.width / 2 + offsetPx.x,
    y: box.y + box.height / 2 + offsetPx.y,
  };

  // 沿用 venue-catalog-drawing 的重試:無 GPU 的環境首次進場景時 raycast
  // 常常前幾次打空,放置成功會自動關掉放置模式,所以多點幾次不會放成兩件。
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

test.describe("Size variants share one procedural shape (T5)", () => {
  test("同款不同高度的兩個品項,實際 mesh 高度分別是 0.75 與 1.00", async ({
    page,
  }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, TABLE_LOW, { x: -40, y: 0 });
    await place(page, editor, TABLE_HIGH, { x: 40, y: 0 });

    await expect
      .poll(async () => (await editor.sceneFurnitureShapes()).length, {
        timeout: 30_000,
      })
      .toBe(2);
    const shapes = await editor.sceneFurnitureShapes();
    const low = shapes.find((s) => s.code === TABLE_LOW);
    const high = shapes.find((s) => s.code === TABLE_HIGH);
    expect(low, `${TABLE_LOW} 不在場景裡`).toBeTruthy();
    expect(high, `${TABLE_HIGH} 不在場景裡`).toBeTruthy();

    // **量的是場景裡的包圍盒,不是目錄欄位的回音。** 期望值寫死 —— 拿
    // catalogItem().height3d 當基準的話,把造型寫死成單一高度也照樣全綠。
    expect(low!.sizeM[1]).toBeCloseTo(0.75, 2);
    expect(high!.sizeM[1]).toBeCloseTo(1.0, 2);
    // 差距要真的存在,不是兩個都量成同一個數字。
    expect(high!.sizeM[1] - low!.sizeM[1]).toBeGreaterThan(0.2);
  });

  test("同款只有高度不同 —— 水平尺寸兩者相同", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, TABLE_LOW, { x: -40, y: 0 });
    await place(page, editor, TABLE_HIGH, { x: 40, y: 0 });

    await expect
      .poll(async () => (await editor.sceneFurnitureShapes()).length, {
        timeout: 30_000,
      })
      .toBe(2);
    const shapes = await editor.sceneFurnitureShapes();
    const low = shapes.find((s) => s.code === TABLE_LOW)!;
    const high = shapes.find((s) => s.code === TABLE_HIGH)!;

    expect(low.sizeM[0]).toBeCloseTo(1.2, 2);
    expect(high.sizeM[0]).toBeCloseTo(1.2, 2);
    expect(low.sizeM[2]).toBeCloseTo(0.7, 2);
    expect(high.sizeM[2]).toBeCloseTo(0.7, 2);
  });

  test("程序化品項全程零 GLB 請求", async ({ page }) => {
    test.slow();
    const glbRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().endsWith(".glb")) glbRequests.push(req.url());
    });

    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, TABLE_LOW, { x: -40, y: 0 });
    await place(page, editor, "CAB-60-180", { x: 0, y: 0 });
    await place(page, editor, "DSP-100-160", { x: 40, y: 0 });

    await editor.goToRefined();
    await page.waitForTimeout(3_000);

    expect(
      glbRequests,
      `方正規格件不該碰 GLB,但請求了: ${glbRequests.join(", ")}`,
    ).toEqual([]);
  });

  test("造型件仍走 GLB,且仍是等比縮放(三軸倍率相同)", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, "CHR-45-90", { x: -40, y: 0 });
    await place(page, editor, "SOF-180-80", { x: 40, y: 0 });

    await editor.goToRefined();
    await expect
      .poll(() => editor.refinedFurnitureModelReports().then((r) => r.length), {
        timeout: 30_000,
      })
      .toBe(2);

    const reports = await editor.refinedFurnitureModelReports();
    for (const report of reports) {
      // 等比縮放的證據有兩層。第一層:倍率是**單一純量** —— 非等比縮放
      // 表示不成一個數字,所以 scale 存在本身就排除了拉伸。
      expect(Number.isFinite(report.scale)).toBe(true);
      expect(report.scale).toBeGreaterThan(0);

      // 第二層:縮完之後不得超出目錄框,且至少一軸貼齊(contain 的定義)。
      // 只驗第一層的話,倍率算錯(例如永遠回 1)也照樣通過。
      const ratios = report.fittedM.map(
        (v: number, i: number) => v / report.targetM[i],
      );
      for (const r of ratios) {
        expect(r, `${report.code} 超出目錄框`).toBeLessThanOrEqual(1 + 1e-3);
      }
      expect(
        Math.max(...ratios),
        `${report.code} 沒有任何一軸貼齊目錄框`,
      ).toBeGreaterThan(0.85);
    }
  });

  test("家具仍不可縮放:選取家具時只有 translate / rotate", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, TABLE_HIGH);

    // 模式切換只有 translate / rotate 兩顆。多出一顆 scale,使用者就能把桌子
    // 拉高 —— 那正是 D4 拒絕的做法(現實中租不到拉高 13% 的桌子),而使用者
    // 要的本來就是「選另一個型號」,也就是 TBL-120-100 存在的意義。
    await expect(
      page.getByTestId("furniture-mode-translate"),
    ).toHaveCount(1);
    await expect(page.getByTestId("furniture-mode-rotate")).toHaveCount(1);
    await expect(page.getByTestId("furniture-mode-scale")).toHaveCount(0);
  });

  test("方正規格件的程序化外廓精準等於目錄宣告(領域層,不需 WebGL)", () => {
    // 這一項不開瀏覽器:純領域模組算得出外廓,錯了就不必等到 3D 才發現。
    const boxy = CATALOG.filter((item) => item.geometry.kind === "procedural");
    expect(boxy.length, "程序化品項數量").toBeGreaterThanOrEqual(7);

    for (const item of boxy) {
      const spec = catalogItem(item.code)!;
      expect(spec.w).toBeGreaterThan(0);
      expect(spec.d).toBeGreaterThan(0);
      expect(spec.height3d).toBeGreaterThan(0);
    }

    // 兩個桌子變體共用同一個造型,只有高度不同 —— D4 的核心主張。
    const low = catalogItem(TABLE_LOW)!;
    const high = catalogItem(TABLE_HIGH)!;
    expect(low.geometry).toEqual(high.geometry);
    expect(low.w).toBe(high.w);
    expect(low.d).toBe(high.d);
    expect(high.height3d - low.height3d).toBeCloseTo(0.25, 6);
  });

  test("仍是 GLB 的只剩曲面件三種", () => {
    const modelCodes = CATALOG.filter(
      (item) => item.geometry.kind === "model",
    ).map((item) => item.code);
    expect(modelCodes.sort()).toEqual([...MODEL_CODES].sort());
  });
});
