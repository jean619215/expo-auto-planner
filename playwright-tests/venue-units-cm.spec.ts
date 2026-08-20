import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// 驗收閘:尺寸標註單位統一為公分(stories/venue-feedback-round2-draft.md T3)。
//
// 依台灣建築圖慣例,平面圖尺寸以公分標註。畫布上原本三種標註都用公尺
// (「10.0 m」「0.5 x 0.5 m」「3.0 m」),與後續要加的柱子邊界距離標註
// (參考圖是 1525cm 這種寫法)會變成同一張圖兩種單位。
//
// 這支只管**顯示層**。內部運算單位仍然是公尺 —— 最後一個案例就是在守這件
// 事:如果有人為了省事把幾何本身改成公分,吸附刻度、夾制邊界、3D 場景的
// 尺度會全部錯掉,而那種錯誤不會反映在標註字串上。

test.describe("Dimension labels in centimetres (T3)", () => {
  test("地板邊長標註為 300cm(預設 3×3m 攤位)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    const labels = await editor.edgeLabels();
    expect(labels.length).toBe(4);
    for (const label of labels) {
      expect(label).toBe("300cm");
    }
  });

  test("柱子尺寸標註為 50 × 50cm", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });

    expect(await editor.columnLabel()).toBe("50 × 50cm");
  });

  test("牆長標註為 300cm(畫一面 3m 的牆)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 23, y: 20 });
    await editor.selectTool();
    await editor.clickAt({ x: 21.5, y: 20 });

    expect(await editor.wallLabel()).toBe("300cm");
  });

  test("標註是整數公分,不帶小數也不帶公尺單位", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });

    const labels = [
      ...(await editor.edgeLabels()),
      await editor.columnLabel(),
    ];
    for (const label of labels) {
      expect(label).toMatch(/cm$/);
      expect(label).not.toContain(" m");
      expect(label).not.toMatch(/\.\d/);
    }
  });

  test("內部幾何仍是公尺 —— 標註換單位沒有連帶改掉運算單位", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });

    const { columns } = await editor.objects();
    // 柱子預設 COLUMN_SIZE_M = 0.5(公尺)。若有人把幾何改成公分,這裡會是 50。
    expect(columns[0].w).toBeCloseTo(0.5, 3);
    expect(columns[0].h).toBeCloseTo(0.5, 3);

    // 預設地板是 20..30 的 10m 見方,座標值仍以公尺表示。
    const verts = await editor.vertices();
    for (const v of verts) {
      expect(Math.abs(v.x)).toBeLessThanOrEqual(200);
      expect(Math.abs(v.y)).toBeLessThanOrEqual(200);
    }
  });
});
