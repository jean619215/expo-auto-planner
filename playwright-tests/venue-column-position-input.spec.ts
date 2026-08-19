import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// 驗收閘:R2 柱子精確定位輸入(stories/venue-feedback-round2-draft.md T5)。
//
// 拖曳有 SNAP_M = 0.5m(50cm)吸附,輸入框刻意**不受**吸附限制 —— 拖曳要
// 快、輸入要準。
//
// 兩者怎麼共存,原本規劃時假設「拖一下就會被吸回格線」,實作時查證後發現
// 不是:translateColumn 吸附的是**位移量**而非絕對位置,所以輸入的尾數會
// 被保留、柱子以 50cm 為單位移動。這個行為比原本假設的好(精確值不會被
// 順手一拖毀掉),所以保留行為、改掉假設 —— 下面的檢查與畫面提示都照
// 實際語意寫。
//
// 預設地板是 (20,20)-(23,23),也就是 300 × 300cm。

test.describe("Column precise positioning (T5)", () => {
  test("輸入 137cm 就停在 137cm,不被吸附成 150", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21.5 });

    await editor.setColumnOffset("left", 137);

    const offsets = await editor.columnOffsetsCm();
    expect(offsets!.left).toBe(137);
  });

  test("輸入後柱子的實際座標對得上(不只是數字對)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21.5 });

    await editor.setColumnOffset("left", 137);

    const { columns } = await editor.objects();
    const column = columns[0];
    // 地板左緣 20m + 1.37m + 半個柱寬。
    expect(column.center.x).toBeCloseTo(20 + 1.37 + column.w / 2, 4);
  });

  test("設定左距後,右距自動等於 總寬 − 柱寬 − 左距", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21.5 });

    await editor.setColumnOffset("left", 137);

    const offsets = await editor.columnOffsetsCm();
    const { columns } = await editor.objects();
    const size = await editor.venueSizeCm();

    expect(offsets!.right).toBe(
      size.width - Math.round(columns[0].w * 100) - 137,
    );
  });

  test("四個方向都能輸入,上距同樣精確", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21.5 });

    await editor.setColumnOffset("top", 213);

    expect((await editor.columnOffsetsCm())!.top).toBe(213);
  });

  test("輸入右距也生效(是鏡像位置,不是另一個獨立值)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21.5 });

    await editor.setColumnOffset("right", 88);

    const offsets = await editor.columnOffsetsCm();
    expect(offsets!.right).toBe(88);
  });

  test("輸入超出場地的值被夾制,柱子不會跑出邊界", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21.5 });

    await editor.setColumnOffset("left", 99999);

    const offsets = await editor.columnOffsetsCm();
    expect(offsets!.left).toBeGreaterThanOrEqual(0);
    expect(offsets!.right).toBeGreaterThanOrEqual(0);
    expect(offsets!.left + offsets!.right).toBe(
      (await editor.venueSizeCm()).width -
        Math.round((await editor.objects()).columns[0].w * 100),
    );
  });

  test("負值被拒絕,柱子不動", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21.5 });

    const before = await editor.columnOffsetsCm();
    await editor.setColumnOffset("left", -50);

    expect((await editor.columnOffsetsCm())!.left).toBe(before!.left);
  });

  test("輸入精確值之後拖曳,位移是 50cm 的倍數且尾數被保留", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21.5 });

    await editor.setColumnOffset("left", 137);
    const before = (await editor.objects()).columns[0].center.x;

    await editor.selectTool();
    await editor.dragObjectBody({ x: before, y: 21.5 }, { x: 22.5, y: 21.5 });

    const after = (await editor.objects()).columns[0].center.x;
    expect(after).not.toBeCloseTo(before, 3);

    // 位移量是 0.5m 的倍數 —— 拖曳的吸附語意沒有被輸入功能破壞。
    const steps = (after - before) / 0.5;
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);

    // 尾數保留:37cm 的零頭還在。
    expect((await editor.columnOffsetsCm())!.left % 50).toBe(137 % 50);
  });

  test("畫面上有提示說明輸入值與拖曳吸附的關係", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21.5 });

    await expect(page.getByTestId("column-offset-hint")).toBeVisible();
  });

  test("沒選柱子時不出現輸入框", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await expect(page.getByTestId("column-offset-left-input")).toHaveCount(0);
  });
});
