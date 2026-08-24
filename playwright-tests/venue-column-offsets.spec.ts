import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// 驗收閘:R2 柱子邊界距離標註(stories/venue-feedback-round2-draft.md T4)。
//
// 回饋附的參考圖:場地 2200 × 600cm,柱子四周標出距左 1525、距右 525、
// 距上 300、距下 150。關鍵是**量邊到邊**而不是中心到邊界 —— 圖上
// 1525 + 150(柱寬) + 525 = 2200 正好是總寬,這個加總關係就是最強的
// 檢查:中心距的話加起來會多出一個柱寬。
//
// 「場地四邊」定義為地板多邊形的外接矩形。地板可以是任意多邊形,而參考圖
// 的標註方式只在矩形上有意義。

/** 允許 1cm 的取整誤差(標註取整數公分)。 */
const TOL = 1;

test.describe("Column boundary offsets (T4)", () => {
  test("選取柱子時出現四邊距離,且左距 + 柱寬 + 右距 = 場地總寬", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21.5 });

    const offsets = await editor.columnOffsetsCm();
    expect(offsets).not.toBeNull();

    const { columns } = await editor.objects();
    const column = columns[0];
    const size = await editor.venueSizeCm();

    expect(offsets!.left + Math.round(column.w * 100) + offsets!.right).toBe(
      size.width,
    );
    expect(offsets!.top + Math.round(column.h * 100) + offsets!.bottom).toBe(
      size.height,
    );
  });

  test("四邊距離的數值正確(預設 3×3m 攤位,柱子放在 21,21.5)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21.5 });

    const { columns } = await editor.objects();
    const column = columns[0];
    const offsets = await editor.columnOffsetsCm();

    // 預設地板是 (20,20)-(23,23)。左距 = 柱左緣 - 20。
    const expectedLeft = Math.round((column.center.x - column.w / 2 - 20) * 100);
    const expectedTop = Math.round((column.center.y - column.h / 2 - 20) * 100);

    expect(Math.abs(offsets!.left - expectedLeft)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(offsets!.top - expectedTop)).toBeLessThanOrEqual(TOL);
  });

  test("場地總寬高恆顯示,即使沒有選取任何東西", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    const size = await editor.venueSizeCm();
    expect(size.width).toBe(300);
    expect(size.height).toBe(300);
  });

  test("取消選取後,四邊距離消失", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21.5 });
    expect(await editor.columnOffsetsCm()).not.toBeNull();

    await editor.selectTool();
    await editor.clickAt({ x: 22.8, y: 22.8 });

    expect(await editor.selectedId()).toBe("");
    expect(await editor.columnOffsetsCm()).toBeNull();
  });

  test("拖曳柱子後,四邊距離即時更新", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21.5 });

    const before = await editor.columnOffsetsCm();

    await editor.selectTool();
    await editor.dragObjectBody({ x: 21, y: 21.5 }, { x: 22, y: 21.5 });

    const after = await editor.columnOffsetsCm();
    expect(after!.left).toBeGreaterThan(before!.left);
    expect(after!.right).toBeLessThan(before!.right);

    const { columns } = await editor.objects();
    const size = await editor.venueSizeCm();
    expect(after!.left + Math.round(columns[0].w * 100) + after!.right).toBe(
      size.width,
    );
  });

  test("選取牆或家具時不顯示四邊距離(只有柱子有)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 20.5, y: 21 }, { x: 22.5, y: 21 });
    await editor.selectTool();
    await editor.clickAt({ x: 21.5, y: 21 });

    expect(await editor.selectedType()).toBe("wall");
    expect(await editor.columnOffsetsCm()).toBeNull();
  });

  test("地板改形狀後,場地總寬高跟著外接矩形走", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // 先確認基準:預設 3×3 攤位。
    expect((await editor.venueSizeCm()).width).toBe(300);

    // 把頂點 0 (20,20) 往左拉到可編輯範圍的左緣 15(= 攤位外的 5m 邊距)。
    // 外接矩形因此從 [20,23] 變成 [15,23],寬 8m。
    // 原本這裡拉到 14 並期望 900cm —— T1 之後 14 已在可編輯範圍外,會被夾成
    // 15,期望值跟著改。守的東西沒變:總寬高跟著外接矩形走。
    await editor.dragVertexTo(0, { x: 15, y: 20 });

    const size = await editor.venueSizeCm();
    expect(size.width).toBe(800);
  });
});
