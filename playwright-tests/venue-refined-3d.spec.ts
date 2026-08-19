import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { AiPanelPage } from "./pages/AiPanelPage";

// Playwright acceptance gate for「精密 3D 場景 (步驟 03)」task 1: 步驟 03
// 骨架 + 唯讀 RefinedScene(.claude/pipeline/architect-plan.md)。涵蓋
// orchestrator-output.md 的 10 條 Clarified Acceptance Criteria + edge
// cases。沿用既有慣例:3D <canvas> 對 Playwright 不透明(見
// venue-3d-scene.spec.ts / ai-panel-persistent.spec.ts 開頭註解),一律讀
// [data-testid="refined-scene"] / [data-testid="venue-scene"] 上的
// data-* 屬性斷言,不檢查畫布像素。手動 3D 編輯(放置家具)沿用
// ai-panel-persistent.spec.ts 的 canvasCenter()/clickFloor() 慣例
// (放置家具經同一條 onSceneChange 寫回頂層 state 的路徑,足以驗證 D1 的
// 「單一資料來源」保證 —— 精準拖曳 TransformControls gizmo 把手在本專案
// 目前沒有任何既有測試先例,見 playwright-tests/venue-objects.spec.ts 等
// 一律用 dragObjectBody 測 2D 物件,3D 手動編輯只有放置家具這條路徑有
// 先例)。

interface MockResponse {
  status: number;
  body: unknown;
}

async function mockAiChat(page: Page, response: MockResponse) {
  await page.route("**/api/ai/chat", async (route) => {
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: JSON.stringify(response.body),
    });
  });
}

async function mockAiConfig(page: Page) {
  await page.route("**/api/ai/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ chatCost: 10, balance: 100 }),
    });
  });
}

/** Center point of the 3D <canvas> inside [data-testid="venue-scene"]. */
async function canvasCenter(page: Page) {
  // The R3F <Canvas> starts at the HTML-default 300x150 intrinsic size and
  // only stretches to fill its `w-full` container once its internal
  // ResizeObserver fires a frame or two after mount. Clicking (or even just
  // reading boundingBox()) before that settles computes a screen point that
  // no longer matches the floor's final on-screen position/raycast once the
  // resize lands moments later, producing flaky "click missed the floor"
  // failures. Wait for the resize before computing the click point.
  await page.waitForFunction(() => {
    const el = document.querySelector<HTMLCanvasElement>(
      '[data-testid="venue-scene"] canvas',
    );
    return !!el && el.getBoundingClientRect().width > 300;
  });
  const canvas = page.locator('[data-testid="venue-scene"] canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error("venue-scene canvas not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Clicks the floor at the given screen point (see ai-panel-persistent.spec.ts). */
async function clickFloor(page: Page, point: { x: number; y: number }) {
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
}

/**
 * Places one piece of furniture on the Step 2 canvas via the sidebar tool.
 *
 * `offsetPx` shifts the click point away from the canvas center so a second
 * placement doesn't land on a furniture mesh already sitting at the center:
 * furniture meshes call `e.stopPropagation()` on click (VenueScene.tsx,
 * selection handler), so clicking on top of an existing item selects it
 * instead of reaching the floor mesh underneath and placing a new one.
 */
async function placeFurnitureOnStep2(
  page: Page,
  offsetPx: { x: number; y: number } = { x: 0, y: 0 },
) {
  await page.getByTestId("furniture-place-table").click();
  const center = await canvasCenter(page);
  await clickFloor(page, { x: center.x + offsetPx.x, y: center.y + offsetPx.y });
}

test.describe("精密 3D 場景 (步驟 03) - Task 1: wizard skeleton + read-only RefinedScene", () => {
  test("AC1: 02 下一步進入 03,3D 場景顯示、進度列標示第三步", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 30, y: 30 }, { x: 35, y: 30 });
    await editor.clickNextStep();
    await editor.goToRefined();

    await expect(editor.stepRefined).toBeVisible();
    await expect(editor.stepPreview).toHaveCount(0);
    expect(await editor.currentStep()).toBe("refined");

    const items = editor.page.locator('[data-testid="step-progress"] li');
    await expect(items).toHaveCount(3);
    const thirdItem = items.nth(2);
    await expect(thirdItem).toContainText("03");
    await expect(thirdItem).toContainText("精密 3D");
    await expect(thirdItem).toHaveClass(/text-blueprint/);
  });

  test("AC2: 上一步回到 02,場景內容(mesh count)與離開前一致", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 30, y: 30 }, { x: 35, y: 30 });
    await editor.clickNextStep();
    const wallCountBefore = await editor.sceneWallMeshCount();

    await editor.goToRefined();
    await editor.backToPreview();

    await expect(editor.stepPreview).toBeVisible();
    expect(await editor.sceneWallMeshCount()).toBe(wallCountBefore);
  });

  test("AC3: 02 手動放置家具後進 03,再回 02,家具資料不變(單一資料源)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
  // 見 venue-furniture-models.spec.ts 的同名說明:預設攤位改成 3x3m 之後,
  // 3D 相機會 fit 到實際地板,下面的像素偏移是按 fit=50 的遠距取景調的。
  // 開一塊 50x50 的場地把取景距離調回原樣。
  await editor.applyCustomBoothSize(50, 50);

    await editor.wallTool();
    await editor.drawWall({ x: 30, y: 30 }, { x: 35, y: 30 });
    await editor.clickNextStep();

    await placeFurnitureOnStep2(page);
    const furnitureAfterPlacement = await editor.editor.getAttribute(
      "data-furniture",
    );
    expect(JSON.parse(furnitureAfterPlacement ?? "[]")).toHaveLength(1);

    await editor.goToRefined();
    expect(await editor.refinedFurnitureMeshCount()).toBe(1);

    await editor.backToPreview();
    const furnitureAfterReturn = await editor.editor.getAttribute(
      "data-furniture",
    );
    expect(furnitureAfterReturn).toBe(furnitureAfterPlacement);
  });

  test("edge case 往返多次不倒退: 02 -> 03 -> 02 -> 03,兩次調整皆保留", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
  // 見 venue-furniture-models.spec.ts 的同名說明:預設攤位改成 3x3m 之後,
  // 3D 相機會 fit 到實際地板,下面的像素偏移是按 fit=50 的遠距取景調的。
  // 開一塊 50x50 的場地把取景距離調回原樣。
  await editor.applyCustomBoothSize(50, 50);

    await editor.wallTool();
    await editor.drawWall({ x: 30, y: 30 }, { x: 35, y: 30 });
    await editor.clickNextStep();

    await placeFurnitureOnStep2(page);
    await editor.goToRefined();
    expect(await editor.refinedFurnitureMeshCount()).toBe(1);

    await editor.backToPreview();
    // Offset so this click doesn't land on the furniture item already
    // placed at the canvas center (see placeFurnitureOnStep2 doc comment).
    // Kept small (30px) — see the booth-size note at the top of this test
    // for why the camera framing has to be pinned for this to be stable.
    await placeFurnitureOnStep2(page, { x: 30, y: 0 });
    await editor.goToRefined();
    expect(await editor.refinedFurnitureMeshCount()).toBe(2);

    await editor.backToPreview();
    const finalFurniture = await editor.editor.getAttribute("data-furniture");
    expect(JSON.parse(finalFurniture ?? "[]")).toHaveLength(2);
  });

  test("AC4: 唯讀 - 點擊場景中央不產生選取/gizmo,無側欄與工具列", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 30, y: 30 }, { x: 35, y: 30 });
    await editor.clickNextStep();
    await placeFurnitureOnStep2(page);
    const furnitureBefore = await editor.editor.getAttribute("data-furniture");

    await editor.goToRefined();

    expect(await editor.refinedScene.getAttribute("data-readonly")).toBe(
      "true",
    );
    await expect(
      page.locator('[data-testid="furniture-place-table"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="venue-sidebar"]')).toHaveCount(
      0,
    );
    await expect(
      page.locator('[data-testid="reset-view-button"]'),
    ).toHaveCount(0);

    const canvas = editor.refinedScene.locator("canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("refined-scene canvas not visible");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const furnitureAfter = await editor.editor.getAttribute("data-furniture");
    expect(furnitureAfter).toBe(furnitureBefore);
  });

  test("AC5: OrbitControls 可用,拖曳視角不改資料且無 console error", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 30, y: 30 }, { x: 35, y: 30 });
    await editor.clickNextStep();
    await editor.goToRefined();

    expect(await editor.refinedScene.getAttribute("data-orbit-controls")).toBe(
      "true",
    );

    const canvas = editor.refinedScene.locator("canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("refined-scene canvas not visible");
    const furnitureBefore = await editor.editor.getAttribute("data-furniture");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 - 20, {
      steps: 8,
    });
    await page.mouse.up();

    expect(pageErrors).toEqual([]);
    const furnitureAfter = await editor.editor.getAttribute("data-furniture");
    expect(furnitureAfter).toBe(furnitureBefore);
  });

  test("AC6 + AC7: AI 側欄在 03 隱藏但未卸載,對話與草稿返回 02 後保留", async ({
    page,
  }) => {
    await mockAiConfig(page);
    await mockAiChat(page, {
      status: 200,
      body: {
        content: [{ type: "text", text: "收到,已記錄你的需求。" }],
        stopReason: "end_turn",
        usage: { inputTokens: 20, outputTokens: 12, cacheReadTokens: 0 },
        balance: 90,
      },
    });

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 30, y: 30 }, { x: 35, y: 30 });
    await editor.clickNextStep();

    await ai.open();
    await ai.sendMessage("幫我加一張桌子");
    await expect(ai.lastAssistantText).toHaveText("收到,已記錄你的需求。");
    await ai.input.fill("這是尚未送出的草稿");

    await editor.goToRefined();

    await expect(ai.panel).not.toBeVisible();
    await expect(ai.toggle).not.toBeVisible();
    expect(await editor.aiPanelSlot.getAttribute("data-hidden")).toBe("true");

    await editor.backToPreview();

    await expect(ai.lastAssistantText).toHaveText("收到,已記錄你的需求。");
    await expect(ai.input).toHaveValue("這是尚未送出的草稿");
  });

  test("AC8: 03 下不顯示存檔入口", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 30, y: 30 }, { x: 35, y: 30 });
    await editor.clickNextStep();
    await editor.goToRefined();

    await expect(page.locator('[data-testid="plan-slots-button"]')).toHaveCount(
      0,
    );
  });

  test("AC9: 未產生 3D 場景時無法直達 03(to-refined-button 不存在)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    expect(await editor.sceneGenerated()).toBe(false);
    await expect(editor.toRefinedButton).toHaveCount(0);
  });

  test("edge case 空場景: 不畫任何物件直接進入 03,只有地板,無 console error", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.clickNextStep();
    await editor.goToRefined();

    await expect(editor.stepRefined).toBeVisible();
    expect(await editor.refinedWallMeshCount()).toBe(0);
    expect(await editor.refinedColumnMeshCount()).toBe(0);
    expect(await editor.refinedFurnitureMeshCount()).toBe(0);
    expect(await editor.refinedFloorVertexCount()).toBe(4);
    expect(pageErrors).toEqual([]);
  });

  test("edge case 凹多邊形地板: 02 與 03 的地板頂點數一致,兩步驟皆無 error", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // DEFAULT_FLOOR = (20,20)(30,20)(30,30)(20,30)。注意 venue-3d-scene.spec.ts
    // 慣用的 `dragVertexTo(1, {24,24})` 會產生 (20,20)(24,24)(30,30)(20,30) ——
    // 這三點共線於 y=x,是「退化凸多邊形」而非凹多邊形,無法真的觸發
    // ExtrudeGeometry 的凹多邊形三角化路徑。改拖 vertex 2 到 (24,24) 得
    // (20,20)(30,20)(24,24)(20,30),在 C 點為 reflex angle,才是真正的凹多邊形。
    await editor.dragVertexTo(2, { x: 24, y: 24 });
    expect(await editor.vertexCount()).toBe(4);

    await editor.wallTool();
    await editor.drawWall({ x: 30, y: 30 }, { x: 35, y: 30 });
    await editor.clickNextStep();
    const previewVertexCount = await editor.sceneFloorVertexCount();

    await editor.goToRefined();
    expect(await editor.refinedFloorVertexCount()).toBe(previewVertexCount);
    expect(pageErrors).toEqual([]);
  });

  test("edge case 版面寬度: 03 下不水平溢出,canvas 較 02 寬(AI 側欄隱藏)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 30, y: 30 }, { x: 35, y: 30 });
    await editor.clickNextStep();
    // The R3F <Canvas> starts at the HTML-default 300x150 intrinsic size
    // and only stretches to fill its `w-full` container once its internal
    // ResizeObserver fires a frame or two after mount — waiting for
    // step-preview's own visibility (already done inside clickNextStep's
    // button click) isn't enough. Wait for the canvas element itself to
    // grow past the default before reading its box, or the width
    // comparison below races the observer.
    await page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="venue-scene"] canvas',
      );
      return !!canvas && canvas.getBoundingClientRect().width > 300;
    });
    const previewCanvasBox = await page
      .locator('[data-testid="venue-scene"] canvas')
      .boundingBox();
    if (!previewCanvasBox) throw new Error("venue-scene canvas not visible");

    await editor.goToRefined();
    await page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="refined-scene"] canvas',
      );
      return !!canvas && canvas.getBoundingClientRect().width > 300;
    });

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);

    const refinedCanvasBox = await editor.refinedScene
      .locator("canvas")
      .boundingBox();
    if (!refinedCanvasBox) throw new Error("refined-scene canvas not visible");
    expect(refinedCanvasBox.width).toBeGreaterThan(previewCanvasBox.width);
  });
});
