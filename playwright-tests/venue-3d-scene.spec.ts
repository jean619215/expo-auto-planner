import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// Playwright acceptance gate for 場地白模產生器 (階段一) Task 4:
// 依平面圖資料建立 3D 白模 (Three.js + react-three-fiber).
// Covers the Clarified Acceptance Criteria in
// .claude/pipeline/orchestrator-output.md (Task 4 spec). The WebGL <canvas>
// rendered by react-three-fiber is opaque to Playwright (same constraint as
// the Konva <canvas>), so every scenario reads state from data-* attributes
// on the plan-editor wrapper and on [data-testid="venue-scene"] (see
// PlanEditorPage's Task 4 accessors) rather than inspecting canvas pixels.

test.describe("Venue Plan Editor - Task 4 3D whitebox scene", () => {
  test("default state: generate button visible and disabled, no scene mounted", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await expect(editor.generateButton).toBeVisible();
    await expect(editor.generateButton).toBeDisabled();
    await expect(editor.scene).toHaveCount(0);
    expect(await editor.sceneGenerated()).toBe(false);
  });

  test("button becomes enabled after adding one wall", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });

    await expect(editor.generateButton).toBeEnabled();
  });

  test("clicking generate mounts the scene with mesh counts matching current 2D state", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });

    await editor.clickGenerate3D();

    await expect(editor.scene).toHaveCount(1);
    expect(await editor.sceneGenerated()).toBe(true);
    expect(await editor.sceneWallMeshCount()).toBe(1);
    expect(await editor.sceneColumnMeshCount()).toBe(0);
    expect(await editor.sceneFloorVertexCount()).toBe(4);
  });

  test("editing the 2D plan after generation does not change the already-rendered scene", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.clickGenerate3D();

    expect(await editor.sceneWallMeshCount()).toBe(1);
    expect(await editor.sceneColumnMeshCount()).toBe(0);

    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });

    // 2D state now has a column, but the already-rendered scene must not
    // live-sync — it still reflects the pre-edit snapshot.
    expect(await editor.columnCount()).toBe(1);
    expect(await editor.sceneWallMeshCount()).toBe(1);
    expect(await editor.sceneColumnMeshCount()).toBe(0);
  });

  test("regenerating after an edit rebuilds the scene from scratch (replace, not append)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.clickGenerate3D();
    const firstGeneration = await editor.generationCount();

    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });
    await editor.clickGenerate3D();

    expect(await editor.generationCount()).toBe(firstGeneration + 1);
    expect(await editor.sceneWallMeshCount()).toBe(1);
    expect(await editor.sceneColumnMeshCount()).toBe(1);
  });

  test("deleting all walls/columns back to floor-only disables the button but leaves the existing scene", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.clickGenerate3D();

    await expect(editor.scene).toHaveCount(1);

    await editor.clickAt({ x: 7.5, y: 5 });
    await editor.pressDelete();

    expect(await editor.wallCount()).toBe(0);
    expect(await editor.columnCount()).toBe(0);
    await expect(editor.generateButton).toBeDisabled();
    // Existing generated scene is left as-is, not retroactively cleared.
    await expect(editor.scene).toHaveCount(1);
    expect(await editor.sceneWallMeshCount()).toBe(1);
  });

  test("rapid double-click does not duplicate meshes", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });

    const before = await editor.generationCount();
    await Promise.all([
      editor.generateButton.click(),
      editor.generateButton.click(),
    ]);

    await expect(editor.scene).toHaveCount(1);
    expect(await editor.generationCount()).toBe(before + 2);
    expect(await editor.sceneWallMeshCount()).toBe(1);
    expect(await editor.sceneColumnMeshCount()).toBe(0);
  });

  test("concave floor polygon generates without crashing", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // Drag the top-right corner inward to produce a concave/dart
    // quadrilateral, same gesture as venue-plan-editor.spec.ts AC8.
    await editor.dragVertexTo(1, { x: 24, y: 24 });
    expect(await editor.vertexCount()).toBe(4);

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.clickGenerate3D();

    await expect(editor.scene).toHaveCount(1);
    expect(await editor.sceneFloorVertexCount()).toBe(4);
    expect(pageErrors).toEqual([]);
  });

  test("no hydration-mismatch console errors on fresh page load", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    const editor = new PlanEditorPage(page);
    await editor.navigate();

    const hydrationErrors = consoleErrors.filter((text) =>
      /hydrat/i.test(text),
    );
    expect(hydrationErrors).toEqual([]);
  });
});
