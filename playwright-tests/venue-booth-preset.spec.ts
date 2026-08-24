import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// 驗收閘:R1 展位尺寸 preset(stories/venue-feedback-round2-draft.md T6)。
//
// 回饋:「一開始的預設場景,展場絕大多數的都是 3*3 / 3*6 / 3*9 / 6*6」。
// 預設地板因此改成 3×3(最常見的單位攤位),並提供四個 preset 與自訂長寬。
//
// 換尺寸會讓原本擺在外圍的物件落到場地外,所以有一道確認 —— 使用者要先
// 知道有幾件會被搬動才按下去。這裡的檢查同時守「有超出才問」與「沒超出
// 就別煩人」兩邊。

test.describe("Booth size presets (T6)", () => {
  test("預設場景是 3×3m 的方形攤位", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    expect(await editor.vertexCount()).toBe(4);
    const size = await editor.venueSizeCm();
    expect(size.width).toBe(300);
    expect(size.height).toBe(300);
  });

  test("四個 preset 都能套用,地板變成對應的矩形", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    for (const [w, h] of [
      [3, 6],
      [3, 9],
      [6, 6],
      [3, 3],
    ] as [number, number][]) {
      await editor.applyBoothPreset(w, h);
      const size = await editor.venueSizeCm();
      expect(size.width).toBe(w * 100);
      expect(size.height).toBe(h * 100);
      expect(await editor.vertexCount()).toBe(4);
    }
  });

  test("自訂長寬 4×7 生效", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.applyCustomBoothSize(4, 7);

    const size = await editor.venueSizeCm();
    expect(size.width).toBe(400);
    expect(size.height).toBe(700);
  });

  test("換到較大尺寸時視圖跟著 fit(縮放比例改變)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    const before = await editor.stageScale();
    await editor.applyBoothPreset(6, 6);
    const after = await editor.stageScale();

    expect(after).not.toBeCloseTo(before, 3);
  });

  test("有 2 件物件會超出時,跳確認並說出件數", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.applyBoothPreset(6, 6);

    // 換過 preset 之後視圖會 fit 到攤位上,遠一點的座標點不到 —— 先重置視圖。
    await editor.clickZoomReset();
    // 兩根柱子放在 6×6 的可編輯範圍([15,31])外圈。縮回 3×3 之後範圍只剩
    // [15,28],兩根都落在外面。
    //
    // 不能放在 25 那一帶:攤位外那 5m 邊距是合法的暫存區,25 在 3×3 的範圍
    // 裡面,不會被判定為超出 —— 那是邊距該有的行為,不是這一項要驗的東西。
    await editor.columnTool();
    await editor.placeColumn({ x: 30, y: 30 });
    await editor.columnTool();
    await editor.placeColumn({ x: 29.5, y: 29.5 });
    expect((await editor.objects()).columns.length).toBe(2);

    await editor.clickBoothPreset(3, 3);

    await expect(editor.boothSizeConfirmDialog).toBeVisible();
    expect(await editor.boothOutsideCount()).toBe(2);
  });

  test("取消確認後,尺寸與物件都不動", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.applyBoothPreset(6, 6);
    await editor.clickZoomReset();
    await editor.columnTool();
    await editor.placeColumn({ x: 30, y: 30 });

    const sizeBefore = await editor.venueSizeCm();
    const centerBefore = (await editor.objects()).columns[0].center;

    await editor.clickBoothPreset(3, 3);
    await editor.cancelBoothSize();

    expect(await editor.venueSizeCm()).toEqual(sizeBefore);
    expect((await editor.objects()).columns[0].center).toEqual(centerBefore);
  });

  test("確認後尺寸改變,超出的物件被夾回可編輯範圍內", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.applyBoothPreset(6, 6);
    await editor.clickZoomReset();
    await editor.columnTool();
    await editor.placeColumn({ x: 30, y: 30 });

    await editor.clickBoothPreset(3, 3);
    await editor.acceptBoothSize();

    expect((await editor.venueSizeCm()).width).toBe(300);

    // 夾進**可編輯範圍**(攤位 + 5m 邊距 = [15,28]),不是夾進攤位本身。
    // 夾進攤位會把刻意放在邊距暫存區的東西一起吸回去。
    // 邊界寫死,不讀 `data-plan-area` —— 讀實作自己回報的值會讓實作壞掉時
    // 兩邊一起漂移,守衛就形同虛設(T1 破壞驗證實測過)。
    const AREA_MIN_M = 15;
    const AREA_MAX_M = 28;
    const column = (await editor.objects()).columns[0];

    expect(column.center.x - column.w / 2).toBeGreaterThanOrEqual(
      AREA_MIN_M - 1e-6,
    );
    expect(column.center.x + column.w / 2).toBeLessThanOrEqual(
      AREA_MAX_M + 1e-6,
    );
    expect(column.center.y - column.h / 2).toBeGreaterThanOrEqual(
      AREA_MIN_M - 1e-6,
    );
    expect(column.center.y + column.h / 2).toBeLessThanOrEqual(
      AREA_MAX_M + 1e-6,
    );
    // 真的被移動過(原本在 30,30)。
    expect(column.center.x).toBeLessThan(30);
  });

  test("沒有物件會超出時,不跳確認,直接套用", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.clickBoothPreset(6, 6);

    await expect(editor.boothSizeConfirmDialog).toHaveCount(0);
    expect((await editor.venueSizeCm()).width).toBe(600);
  });
});
