import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// Playwright acceptance gate for 場地白模產生器 (階段一) Task 4 & 5:
// 依平面圖資料建立 3D 白模 (Three.js + react-three-fiber), plus the Task 5
// 2-step wizard flow (Step 1 編輯平面圖 -> 下一步 -> Step 2 3D預覽 ->
// 返回編輯) and OrbitControls. Covers the Clarified Acceptance Criteria in
// .claude/pipeline/orchestrator-output.md (Task 4 & Task 5 specs). The
// WebGL <canvas> rendered by react-three-fiber is opaque to Playwright
// (same constraint as the Konva <canvas>), so every scenario reads state
// from data-* attributes on the plan-editor wrapper and on
// [data-testid="venue-scene"] (see PlanEditorPage's Task 4/5 accessors)
// rather than inspecting canvas pixels. Actual camera drag/rotate/zoom
// behavior is manual-only (see manual-tests/venue-plan-editor.md Task 5).

test.describe("Venue Plan Editor - Task 4 & 5: 3D whitebox scene + step wizard", () => {
  test("default state: next-step button visible and disabled, no scene mounted, Step 1 active", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await expect(editor.nextStepButton).toBeVisible();
    await expect(editor.nextStepButton).toBeDisabled();
    await expect(editor.scene).toHaveCount(0);
    expect(await editor.sceneGenerated()).toBe(false);
    await expect(editor.stepEdit).toBeVisible();
    await expect(editor.stepPreview).toHaveCount(0);
  });

  test("button becomes enabled after adding one wall", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });

    await expect(editor.nextStepButton).toBeEnabled();
  });

  test("clicking 下一步 mounts the scene with mesh counts matching current 2D state and advances to Step 2", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });

    await editor.clickNextStep();

    await expect(editor.scene).toHaveCount(1);
    expect(await editor.sceneGenerated()).toBe(true);
    expect(await editor.sceneWallMeshCount()).toBe(1);
    expect(await editor.sceneColumnMeshCount()).toBe(0);
    expect(await editor.sceneFloorVertexCount()).toBe(4);
    await expect(editor.stepEdit).toHaveCount(0);
    await expect(editor.stepPreview).toBeVisible();
    expect(await editor.scene.getAttribute("data-orbit-controls")).toBe(
      "true",
    );
  });

  test("regenerating after an edit rebuilds the scene from scratch (replace, not append)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.clickNextStep();
    const firstGeneration = await editor.generationCount();

    await editor.clickBackToEdit();
    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });
    await editor.clickNextStep();

    expect(await editor.generationCount()).toBe(firstGeneration + 1);
    expect(await editor.sceneWallMeshCount()).toBe(1);
    expect(await editor.sceneColumnMeshCount()).toBe(1);
    await expect(editor.stepPreview).toBeVisible();
  });

  test("deleting all walls/columns back to floor-only disables the button but leaves the existing scene's data attributes intact", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.clickNextStep();
    const generationBefore = await editor.generationCount();

    await editor.clickBackToEdit();
    await editor.clickAt({ x: 7.5, y: 5 });
    await editor.pressDelete();

    expect(await editor.wallCount()).toBe(0);
    expect(await editor.columnCount()).toBe(0);
    await expect(editor.nextStepButton).toBeDisabled();
    // Existing generated scene's data attributes are left as-is, not
    // retroactively cleared just because the button is now disabled — the
    // prior generation simply can't be re-viewed without re-enabling and
    // clicking 下一步 again.
    expect(await editor.sceneGenerated()).toBe(true);
    expect(await editor.generationCount()).toBe(generationBefore);
  });

  test("single click on 下一步 atomically transitions both generation and step together", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });

    const before = await editor.generationCount();
    await editor.clickNextStep();

    expect(await editor.generationCount()).toBe(before + 1);
    await expect(editor.stepPreview).toBeVisible();
    await expect(editor.stepEdit).toHaveCount(0);
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
    await editor.clickNextStep();

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

  // --- Task 5: 2-step wizard --------------------------------------------

  test("back-to-edit returns to Step 1 with 2D state fully intact", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });

    const wallCountBefore = await editor.wallCount();
    const columnCountBefore = await editor.columnCount();
    const objectsBefore = await editor.objects();

    await editor.clickNextStep();
    await expect(editor.stepPreview).toBeVisible();
    await expect(editor.stepEdit).toHaveCount(0);

    await editor.clickBackToEdit();
    await expect(editor.stepEdit).toBeVisible();
    await expect(editor.stepPreview).toHaveCount(0);

    expect(await editor.wallCount()).toBe(wallCountBefore);
    expect(await editor.columnCount()).toBe(columnCountBefore);
    expect(await editor.objects()).toEqual(objectsBefore);
  });

  test("toggling back and forth without edits still regenerates on next-step", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.clickNextStep();
    const firstGeneration = await editor.generationCount();

    await editor.clickBackToEdit();
    await editor.clickNextStep();

    expect(await editor.generationCount()).toBe(firstGeneration + 1);
  });

  test("OrbitControls marker present when Step 2 is active", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.clickNextStep();

    expect(await editor.orbitControlsPresent()).toBe(true);
  });

  // --- QA regression (loop iteration 1): stale selection + bubbling
  // keydown while Step 2 is mounted must never delete 2D state -------------

  test("pressing Delete while Step 2 is active (after clicking the 3D canvas) does not delete the previously-selected wall", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // Draw one wall; it becomes auto-selected (selectedObject set).
    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    const wallCountBefore = await editor.wallCount();
    const objectsBefore = await editor.objects();

    await editor.clickNextStep();
    await expect(editor.stepPreview).toBeVisible();

    // Method A: click the 3D canvas, as if starting to orbit the camera —
    // the single most natural first action in Step 2.
    const sceneBox = await editor.scene.boundingBox();
    if (!sceneBox) throw new Error("venue-scene not visible");
    await page.mouse.click(
      sceneBox.x + sceneBox.width / 2,
      sceneBox.y + sceneBox.height / 2,
    );
    await page.keyboard.press("Delete");

    await editor.clickBackToEdit();
    await expect(editor.stepEdit).toBeVisible();

    expect(await editor.wallCount()).toBe(wallCountBefore);
    expect(await editor.objects()).toEqual(objectsBefore);
  });

  test("pressing Delete while Step 2 is active (after focusing 返回編輯) does not delete the previously-selected wall", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    const wallCountBefore = await editor.wallCount();
    const objectsBefore = await editor.objects();

    await editor.clickNextStep();
    await expect(editor.stepPreview).toBeVisible();

    // Method B: focus (not click) the 返回編輯 button — isolates the
    // mechanism to "focus lands inside the wrapper's DOM subtree while in
    // Step 2," independent of any canvas interaction.
    await editor.backToEditButton.focus();
    await page.keyboard.press("Delete");

    await editor.clickBackToEdit();
    await expect(editor.stepEdit).toBeVisible();

    expect(await editor.wallCount()).toBe(wallCountBefore);
    expect(await editor.objects()).toEqual(objectsBefore);
  });
});
